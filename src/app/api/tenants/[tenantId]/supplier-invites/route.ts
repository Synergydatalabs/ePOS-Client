// GET  /api/tenants/[tenantId]/supplier-invites — list invites this tenant sent
// POST /api/tenants/[tenantId]/supplier-invites — create + email a new invite
//
// Phase 8 (2026-07-30) — Supplier Marketplace, merchant-side entry point.
// The supplier only sees this data via the accept-by-token endpoints; this
// route is exclusively for the inviting merchant.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { addDays } from "date-fns";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { sendSupplierInviteEmail } from "@/lib/email";

const INVITE_EXPIRY_DAYS = 14;

// GET — list invites for the merchant. Includes PENDING + recently-resolved
// so the merchant can see history without a separate archive tab.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "TENANT_ADMIN");
    if (!auth.success) return auth.response;

    const invites = await prisma.supplierInvite.findMany({
      where: { fromTenantId: tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        email: true,
        companyName: true,
        contactName: true,
        phone: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        acceptedTenantId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, invites });
  } catch (error: any) {
    console.error("[SUPPLIER-INVITES] List error:", error);
    return NextResponse.json({ error: "Failed to load invites" }, { status: 500 });
  }
}

// POST — create + email a new invite.
// Body: { email, companyName?, contactName?, phone?, message?, localSupplierId? }
// If localSupplierId is set, the invite is linked to an existing Supplier row;
// on acceptance that row's linkedTenantId flips to the new supplier tenant.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "TENANT_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const email = String(body.email || "").toLowerCase().trim();
    const companyName = body.companyName?.trim() || null;
    const contactName = body.contactName?.trim() || null;
    const phone = body.phone?.trim() || null;
    const message = body.message?.trim() || null;
    const localSupplierId = body.localSupplierId || null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    // Guard: don't allow a merchant to fire off duplicate PENDING invites to
    // the same email. If they need to re-send, they should cancel the old one
    // first (or we can re-issue on demand — later enhancement).
    const existing = await prisma.supplierInvite.findFirst({
      where: { fromTenantId: tenantId, email, status: "PENDING" },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A pending invite for this email already exists. Cancel it first if you'd like to re-send." },
        { status: 409 }
      );
    }

    // If a localSupplierId was passed, sanity-check it belongs to this tenant.
    // Prevents a merchant from stapling their invite onto another tenant's
    // Supplier row.
    if (localSupplierId) {
      const localSupplier = await prisma.supplier.findFirst({
        where: { id: localSupplierId, tenantId },
        select: { id: true },
      });
      if (!localSupplier) {
        return NextResponse.json(
          { error: "Local supplier not found or doesn't belong to this tenant" },
          { status: 404 }
        );
      }
    }

    // Get merchant's business name for the email — no need to expose full
    // settings; just the display name.
    const merchantTenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    if (!merchantTenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // 32 random bytes → 64-char hex string. Enough entropy to be unguessable
    // for a URL that gates account creation.
    const token = randomBytes(32).toString("hex");
    const expiresAt = addDays(new Date(), INVITE_EXPIRY_DAYS);

    const invite = await prisma.supplierInvite.create({
      data: {
        fromTenantId: tenantId,
        fromMembershipId: auth.context.membership.id,
        email,
        companyName,
        contactName,
        phone,
        message,
        token,
        expiresAt,
        localSupplierId,
      },
    });

    // Send email. Fire-and-forget-with-log: if SES fails we don't roll back
    // the invite (the merchant can resend / cancel) — they still see the
    // pending row in their UI and get a toast about the email delivery.
    // Fall back to the request's own origin when NEXT_PUBLIC_BASE_URL
    // isn't set — otherwise the acceptUrl becomes `/supplier/accept/...`
    // which is useless for the merchant to copy + share out-of-band.
    const originFromRequest = request.headers.get("origin") || "";
    const acceptUrl = `${process.env.NEXT_PUBLIC_BASE_URL || originFromRequest}/supplier/accept/${token}`;

    const merchantContactName = [auth.context.membership.firstName, auth.context.membership.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || undefined;

    let emailDelivered = true;
    let emailError: string | null = null;
    try {
      await sendSupplierInviteEmail({
        to: email,
        acceptUrl,
        merchantBusinessName: merchantTenant.name,
        merchantContactName,
        supplierCompanyName: companyName || undefined,
        personalMessage: message || undefined,
        expiresAt,
      });
    } catch (err: any) {
      emailDelivered = false;
      emailError = err?.message || "SES send failed";
      console.error("[SUPPLIER-INVITES] Email send failed for", email, err);
    }

    return NextResponse.json({
      success: true,
      invite: {
        id: invite.id,
        email: invite.email,
        companyName: invite.companyName,
        status: invite.status,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
      },
      // Always return the acceptUrl — the client uses it to render a
      // copy-to-clipboard fallback when SES delivery fails so the
      // merchant can still share the link out-of-band.
      acceptUrl,
      emailDelivered,
      emailError,
    });
  } catch (error: any) {
    console.error("[SUPPLIER-INVITES] Create error:", error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}
