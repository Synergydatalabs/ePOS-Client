// POST /api/tenants/[tenantId]/marketplace/orders/[orderId]/regenerate-payment-link
//
// Re-runs the same payment-link generation that fires at PO-submit time —
// useful when:
//   • The supplier assigned (or switched) a processor AFTER the PO was
//     submitted, so the PO landed with no link.
//   • The original link failed (paymentLinkFailureNote is set).
//   • The link expired and the merchant wants a fresh one.
//
// Idempotent: writes a new link URL + reference and clears the failure
// note. Does NOT invalidate the previous link reference — if the payment
// was already captured against it, the webhook still reconciles.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { getProvider } from "@/lib/payment-providers";
import { kybDecryptJson } from "@/lib/kyb-crypto";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  const { tenantId, orderId } = await params;

  const auth = await validateRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.context.tenantId !== tenantId) {
    return NextResponse.json({ error: "Tenant mismatch" }, { status: 403 });
  }

  // 1) Load PO and verify ownership
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      poNumber: true,
      merchantTenantId: true,
      supplierTenantId: true,
      totalCents: true,
      currency: true,
      paymentStatus: true,
    },
  });
  if (!po || po.merchantTenantId !== tenantId) {
    return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  }
  if (po.paymentStatus === "PAID") {
    return NextResponse.json(
      { error: "PO is already paid — no need to regenerate the link" },
      { status: 409 }
    );
  }

  // 2) Pick the supplier's active provider — same ECOMMERCE-first lookup
  //    the PO submit endpoint uses, so the two paths stay in sync.
  const activeProcessor =
    (await prisma.tenantPaymentProvider.findFirst({
      where: {
        tenantId: po.supplierTenantId,
        capability: "ECOMMERCE",
        status: "ACTIVE",
      },
      select: {
        id: true,
        processor: true,
        externalMid: true,
        credentialsEnc: true,
      },
    })) ??
    (await prisma.tenantPaymentProvider.findFirst({
      where: {
        tenantId: po.supplierTenantId,
        capability: "CARD",
        status: "ACTIVE",
      },
      select: {
        id: true,
        processor: true,
        externalMid: true,
        credentialsEnc: true,
      },
    }));

  if (!activeProcessor) {
    return NextResponse.json(
      {
        error:
          "This supplier has no ACTIVE ECOMMERCE or CARD provider assigned. " +
          "Assign one via the admin UI first, then regenerate.",
      },
      { status: 400 }
    );
  }

  // 3) Mint the link (same shape as the PO-submit path)
  let credentials: Record<string, unknown> = {};
  try {
    const decrypted = kybDecryptJson<Record<string, unknown>>(activeProcessor.credentialsEnc);
    if (decrypted && typeof decrypted === "object") {
      credentials = decrypted;
    }
  } catch (err) {
    console.warn(
      `[PO-REGEN] Per-supplier creds for ${po.poNumber} could not be decrypted; passing empty bag to ${activeProcessor.processor}:`,
      (err as Error).message
    );
  }

  try {
    const client = getProvider(activeProcessor.processor);
    const link = await client.createPaymentLink({
      purchaseOrderId: po.id,
      poNumber: po.poNumber,
      amountCents: po.totalCents,
      currency: po.currency,
      description: `PO ${po.poNumber}`,
      payerEmail: auth.context.membership.email || undefined,
      returnUrl: `${process.env.NEXT_PUBLIC_BASE_URL || ""}/dashboard/admin/marketplace/orders/${po.id}`,
      webhookUrl: `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/webhooks/payment/${activeProcessor.processor.toLowerCase()}`,
      credentials,
      externalMid: activeProcessor.externalMid,
    });

    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        paymentLinkUrl: link.url,
        paymentLinkReference: link.reference,
        paymentLinkExpiresAt: link.expiresAt,
        paymentLinkFailureNote: null,
      },
    });

    console.log(
      `[PO-REGEN] Payment link regenerated for ${po.poNumber}: ref=${link.reference}, processor=${activeProcessor.processor}`
    );

    return NextResponse.json({
      success: true,
      paymentLinkUrl: link.url,
      paymentLinkReference: link.reference,
      processor: activeProcessor.processor,
    });
  } catch (err: any) {
    const note = String(err?.message || err).slice(0, 500);
    console.error(`[PO-REGEN] Link generation failed for ${po.poNumber}:`, note);
    await prisma.purchaseOrder
      .update({ where: { id: po.id }, data: { paymentLinkFailureNote: note } })
      .catch(() => {});
    return NextResponse.json(
      { error: `Link generation failed: ${note}` },
      { status: 502 }
    );
  }
}
