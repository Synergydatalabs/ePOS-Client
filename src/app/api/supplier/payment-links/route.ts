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

    const publicBase =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_MARKETING_URL?.replace(/\/+$/, "") ||
      "https://hub.synergydatalabs.com";

    return NextResponse.json({
      success: true,
      links: links.map((l) => ({
        ...l,
        publicUrl: `${publicBase.replace(/\/+$/, "")}/l/${l.shortSlug}`,
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

    const publicBase =
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://hub.synergydatalabs.com";
    return NextResponse.json({
      success: true,
      link,
      publicUrl: `${publicBase.replace(/\/+$/, "")}/l/${link.shortSlug}`,
    });
  } catch (err: any) {
    console.error("[PAYMENT-LINKS] POST error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create payment link" },
      { status: 400 }
    );
  }
}
