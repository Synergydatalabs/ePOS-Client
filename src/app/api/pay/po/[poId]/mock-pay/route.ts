// POST /api/pay/po/[poId]/mock-pay
// Public — no auth. Called by the mock checkout page when the payer
// clicks "Pay". Marks the PO as paid.
//
// Auth model: the payer must provide the ?ref= that matches the PO's
// payment_link_reference. Without a match, we 404. Same gating as the
// GET endpoint — anyone with the link can pay (the whole point of a
// payment link), but nobody without it can enumerate.
//
// This is the MOCK path. When the real GP webhook lands in #68, it will
// use markPoAsPaid() the exact same way — the state transition + email
// notifications live in one place, so the two paths can't diverge.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { markPoAsPaid } from "@/lib/marketplace-po-payment";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ poId: string }> }
) {
  try {
    const { poId } = await params;
    const body = await request.json().catch(() => ({}));
    const ref = body.ref?.trim();

    if (!ref) {
      return NextResponse.json({ error: "Missing reference" }, { status: 400 });
    }

    // Verify the ref binds to this PO. Also short-circuits invalid PO
    // ids without leaking whether they exist.
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: poId, paymentLinkReference: ref },
      select: {
        id: true,
        paymentStatus: true,
        paymentLinkExpiresAt: true,
        totalCents: true,
      },
    });
    if (!po) {
      return NextResponse.json({ error: "Invalid payment link" }, { status: 404 });
    }

    // Reject if the link has expired. Idempotent: already-paid POs
    // still return success below.
    if (po.paymentStatus !== "PAID") {
      if (po.paymentLinkExpiresAt && po.paymentLinkExpiresAt < new Date()) {
        return NextResponse.json(
          { error: "This payment link has expired." },
          { status: 410 }
        );
      }
    }

    const result = await markPoAsPaid({
      purchaseOrderId: po.id,
      paidAmountCents: po.totalCents,
      paidMethod: "mock-card",
    });

    console.log(
      `[PUBLIC-PAY] Mock pay ${result.wasFreshTransition ? "captured" : "idempotent"} for PO ${result.purchaseOrder.poNumber}`
    );

    return NextResponse.json({
      success: true,
      paymentStatus: result.purchaseOrder.paymentStatus,
      wasFreshTransition: result.wasFreshTransition,
    });
  } catch (error: any) {
    console.error("[PUBLIC-PAY] mock-pay error:", error);
    return NextResponse.json({ error: "Payment failed" }, { status: 500 });
  }
}
