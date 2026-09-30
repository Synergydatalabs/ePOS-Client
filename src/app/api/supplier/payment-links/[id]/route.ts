// GET    /api/supplier/payment-links/[id] — detail (with product + usage count)
// PATCH  /api/supplier/payment-links/[id] — update editable fields
// DELETE /api/supplier/payment-links/[id] — disable (soft, keeps history)
//
// Phase I #1 (2026-09-08). Supplier auth required. Deleting is a soft
// disable (status='disabled') — we never hard-delete a link because
// existing invoices reference it for attribution.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import {
  getPaymentLink,
  updatePaymentLink,
  disablePaymentLink,
  type UpdatePaymentLinkInput,
} from "@/lib/payment-link.service";

async function requireSupplier(request: NextRequest) {
  const session = await getPartnerSession(request);
  if (!session) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { id: true, businessType: true, name: true },
  });
  if (!tenant || tenant.businessType !== "supplier") {
    return { ok: false as const, response: NextResponse.json({ error: "Not a supplier tenant" }, { status: 403 }) };
  }
  return { ok: true as const, session, tenant };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSupplier(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;

    const link = await getPaymentLink(auth.tenant.id, id);
    if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const publicBase =
      process.env.NEXT_PUBLIC_APP_URL || "https://hub.synergydatalabs.com";
    return NextResponse.json({
      success: true,
      link,
      publicUrl: `${publicBase.replace(/\/+$/, "")}/l/${link.shortSlug}`,
    });
  } catch (err: any) {
    console.error("[PAYMENT-LINKS] GET [id] error:", err);
    return NextResponse.json({ error: "Failed to load payment link" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSupplier(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const body = await request.json();

    const input: UpdatePaymentLinkInput = {};
    if (typeof body.nickname === "string") input.nickname = body.nickname;
    if (typeof body.status === "string") input.status = body.status as "active" | "disabled";
    if (body.unitAmountCents === null || typeof body.unitAmountCents === "number") {
      input.unitAmountCents = body.unitAmountCents;
    }
    // Phase I (2026-09-19): currency was missing from the update path —
    // edits that changed the currency silently reverted on reload.
    if (typeof body.currency === "string" && body.currency.trim()) {
      input.currency = body.currency;
    }
    if (typeof body.qtyLocked === "boolean") input.qtyLocked = body.qtyLocked;
    if (typeof body.qtyDefault === "number") input.qtyDefault = Math.floor(body.qtyDefault);
    if (typeof body.qtyMin === "number") input.qtyMin = Math.floor(body.qtyMin);
    if (body.qtyMax === null || typeof body.qtyMax === "number") {
      input.qtyMax = body.qtyMax == null ? null : Math.floor(body.qtyMax);
    }
    // Phase I #12 (2026-09-22): editable amount
    if (typeof body.amountLocked === "boolean") input.amountLocked = body.amountLocked;
    if (body.amountMinCents === null || typeof body.amountMinCents === "number") {
      input.amountMinCents =
        body.amountMinCents == null ? null : Math.floor(body.amountMinCents);
    }
    if (body.amountMaxCents === null || typeof body.amountMaxCents === "number") {
      input.amountMaxCents =
        body.amountMaxCents == null ? null : Math.floor(body.amountMaxCents);
    }
    if (body.partnerRef === null || typeof body.partnerRef === "string") {
      input.partnerRef = body.partnerRef;
    }
    if (body.partnerDisplayName === null || typeof body.partnerDisplayName === "string") {
      input.partnerDisplayName = body.partnerDisplayName;
    }
    if (body.partnerLogoUrl === null || typeof body.partnerLogoUrl === "string") {
      input.partnerLogoUrl = body.partnerLogoUrl;
    }
    if (body.redirectUrl === null || typeof body.redirectUrl === "string") {
      input.redirectUrl = body.redirectUrl;
    }
    if (body.expiresAt === null) input.expiresAt = null;
    else if (typeof body.expiresAt === "string") input.expiresAt = new Date(body.expiresAt);
    if (body.maxUses === null || typeof body.maxUses === "number") {
      input.maxUses = body.maxUses == null ? null : Math.floor(body.maxUses);
    }
    if (typeof body.requireName === "boolean") input.requireName = body.requireName;
    if (typeof body.requirePhone === "boolean") input.requirePhone = body.requirePhone;
    if (typeof body.requireCompany === "boolean") input.requireCompany = body.requireCompany;
    if (body.descriptionOverride === null || typeof body.descriptionOverride === "string") {
      input.descriptionOverride = body.descriptionOverride;
    }
    if (body.notifyEmails === null || typeof body.notifyEmails === "string") {
      input.notifyEmails = body.notifyEmails;
    }

    // Phase I #5 v2 (2026-09-14): per-link webhook fields. null clears
    // the value, string sets it; anything else = don't touch.
    if (body.webhookUrl === null || typeof body.webhookUrl === "string") {
      input.webhookUrl = body.webhookUrl;
    }
    if (body.webhookSecret === null || typeof body.webhookSecret === "string") {
      input.webhookSecret = body.webhookSecret;
    }
    if (body.webhookTemplate === null || typeof body.webhookTemplate === "string") {
      input.webhookTemplate = body.webhookTemplate;
    }
    if (Array.isArray(body.webhookEvents)) {
      input.webhookEvents = body.webhookEvents;
    }
    if (typeof body.webhookContentType === "string") {
      input.webhookContentType = body.webhookContentType;
    }
    if (typeof body.webhookEnabled === "boolean") {
      input.webhookEnabled = body.webhookEnabled;
    }

    const updated = await updatePaymentLink(auth.tenant.id, id, input);
    return NextResponse.json({ success: true, link: updated });
  } catch (err: any) {
    console.error("[PAYMENT-LINKS] PATCH [id] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update payment link" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSupplier(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;

    const disabled = await disablePaymentLink(auth.tenant.id, id);
    return NextResponse.json({ success: true, link: disabled });
  } catch (err: any) {
    console.error("[PAYMENT-LINKS] DELETE [id] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to disable payment link" },
      { status: 400 }
    );
  }
}
