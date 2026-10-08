// POST /api/supplier/payment-links — create a new payment link (supplier auth)
// GET  /api/supplier/payment-links — list this supplier's links (supplier auth)
//
// Phase I #1 (2026-09-08). Supplier portal calls these to manage its links.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import {
  createPaymentLink,
  listPaymentLinks,
  type CreatePaymentLinkInput,
} from "@/lib/payment-link.service";

// 2026-10-08: build the share-URL base from the request's own host when
// possible, so white-label tenant portals (indianbeans.com, oreugo.ca)
// generate links on their own apex instead of a hardcoded hub URL.
// Falls back to NEXT_PUBLIC_APP_URL / hub.synergydatalabs.com if the
// request somehow has no host header (shouldn't happen in prod via
// the ALB, but defensive).
function resolvePublicBase(request: NextRequest): string {
  const hostHeader = request.headers.get("host");
  if (hostHeader) {
    // Guess the scheme: honour x-forwarded-proto when the ALB sets it,
    // else default to https (prod) / http (localhost).
    const proto =
      request.headers.get("x-forwarded-proto") ||
      (hostHeader.startsWith("localhost") || hostHeader.startsWith("127.") ? "http" : "https");
    return `${proto}://${hostHeader}`;
  }
  const envBase =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_MARKETING_URL ||
    "https://hub.synergydatalabs.com";
  return envBase.replace(/\/+$/, "");
}

async function requireSupplier(request: NextRequest) {
  const session = await getPartnerSession(request);
  if (!session) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { id: true, businessType: true, name: true, currency: true },
  });
  if (!tenant || tenant.businessType !== "supplier") {
    return { ok: false as const, response: NextResponse.json({ error: "Not a supplier tenant" }, { status: 403 }) };
  }
  return { ok: true as const, session, tenant };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplier(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const status = url.searchParams.get("status") || undefined;
    const productId = url.searchParams.get("productId") || undefined;
    const partnerRef = url.searchParams.get("partnerRef") || undefined;

    const links = await listPaymentLinks(auth.tenant.id, {
      status,
      productId,
      partnerRef,
    });

    // 2026-10-08: use the request's own host when generating the
    // share URL so white-label tenants (indianbeans.com, oreugo.ca,
    // etc) get links on their own apex instead of hub.synergydatalabs.
    // The /l/<slug> slug works on every host that routes to tap-app,
    // so the choice of host only affects what the supplier sees in
    // their portal and copies to their customers.
    const publicBase = resolvePublicBase(request);

    return NextResponse.json({
      success: true,
      links: links.map((l) => ({
        ...l,
        publicUrl: `${publicBase}/l/${l.shortSlug}`,
      })),
    });
  } catch (err: any) {
    console.error("[PAYMENT-LINKS] GET error:", err);
    return NextResponse.json({ error: "Failed to load payment links" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSupplier(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();

    // Whitelist the fields we accept + build the service input. The service
    // layer validates the combinations (mode/interval, qty min/max/default,
    // product-ownership) so we just pass through cleaned values here.
    const input: CreatePaymentLinkInput = {
      supplierTenantId: auth.tenant.id,
      productId: body.productId ?? null,
      nickname: typeof body.nickname === "string" ? body.nickname : "",
      mode: body.mode === "subscription" ? "subscription" : "one_time",
      interval: body.interval ?? null,
      intervalCount: typeof body.intervalCount === "number" ? body.intervalCount : 1,
      unitAmountCents:
        typeof body.unitAmountCents === "number" ? Math.round(body.unitAmountCents) : null,
      currency: typeof body.currency === "string" ? body.currency : auth.tenant.currency ?? "CAD",
      qtyLocked: typeof body.qtyLocked === "boolean" ? body.qtyLocked : true,
      qtyDefault: typeof body.qtyDefault === "number" ? Math.floor(body.qtyDefault) : 1,
      qtyMin: typeof body.qtyMin === "number" ? Math.floor(body.qtyMin) : 1,
      qtyMax: typeof body.qtyMax === "number" ? Math.floor(body.qtyMax) : null,
      // Phase I #12 (2026-09-22): editable amount
      amountLocked: typeof body.amountLocked === "boolean" ? body.amountLocked : true,
      amountMinCents:
        typeof body.amountMinCents === "number" ? Math.floor(body.amountMinCents) : null,
      amountMaxCents:
        typeof body.amountMaxCents === "number" ? Math.floor(body.amountMaxCents) : null,
      partnerRef: body.partnerRef ?? null,
      partnerDisplayName: body.partnerDisplayName ?? null,
      partnerLogoUrl: body.partnerLogoUrl ?? null,
      redirectUrl: body.redirectUrl ?? null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      maxUses: typeof body.maxUses === "number" ? Math.floor(body.maxUses) : null,
      requireName: typeof body.requireName === "boolean" ? body.requireName : true,
      requirePhone: typeof body.requirePhone === "boolean" ? body.requirePhone : false,
      requireCompany: typeof body.requireCompany === "boolean" ? body.requireCompany : false,
      descriptionOverride: body.descriptionOverride ?? null,
      notifyEmails: typeof body.notifyEmails === "string" ? body.notifyEmails : null,
      // Phase I #5 v2 (2026-09-14): per-link webhook fields.
      webhookUrl: typeof body.webhookUrl === "string" ? body.webhookUrl : null,
      webhookSecret: typeof body.webhookSecret === "string" ? body.webhookSecret : null,
      webhookTemplate: typeof body.webhookTemplate === "string" ? body.webhookTemplate : null,
      webhookEvents: Array.isArray(body.webhookEvents) ? body.webhookEvents : undefined,
      webhookContentType: typeof body.webhookContentType === "string" ? body.webhookContentType : undefined,
      webhookEnabled: typeof body.webhookEnabled === "boolean" ? body.webhookEnabled : undefined,
      customSlug: body.customSlug ?? null,
      createdByMembershipId: auth.session.memberId ?? null,
    };

    if (!input.nickname.trim()) {
      return NextResponse.json({ error: "Nickname is required" }, { status: 400 });
    }

    const link = await createPaymentLink(input);

    const publicBase = resolvePublicBase(request);
    return NextResponse.json({
      success: true,
      link,
      publicUrl: `${publicBase}/l/${link.shortSlug}`,
    });
  } catch (err: any) {
    console.error("[PAYMENT-LINKS] POST error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create payment link" },
      { status: 400 }
    );
  }
}
