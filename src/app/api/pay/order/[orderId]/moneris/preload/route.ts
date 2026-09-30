// POST /api/pay/order/[orderId]/moneris/preload
//
// Public — no auth. Called from /pay/order/[orderId] when the customer
// lands after scanning the staff phone's QR. Mints a fresh Moneris
// Checkout ticket; the client then loads chkt_v1.00.js and calls
// monerisCheckout.startCheckout(ticket).
//
// Gating:
//   • Order must exist
//   • Not already fully paid (returns 409 → client flips to paid view)
//   • Not cancelled
//   • Total must be > 0
//
// Credentials strategy: platform env vars (same as PO). Per-tenant MCO
// creds via TenantPaymentProvider will land as a follow-up — same
// getMcoCredentialsFromEnv() interface, no downstream changes needed.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createPreload, getMcoCredentialsFromEnv, McoApiError } from "@/lib/moneris-checkout";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        displayNumber: true,
        total: true,
        currency: true,
        status: true,
        paymentStatus: true,
        payments: {
          where: { status: "COMPLETED" },
          select: { amount: true },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.paymentStatus === "COMPLETED") {
      return NextResponse.json(
        { error: "This order has already been paid.", code: "ALREADY_PAID" },
        { status: 409 }
      );
    }
    if (order.status === "CANCELLED") {
      return NextResponse.json(
        { error: "This order was cancelled.", code: "CANCELLED" },
        { status: 410 }
      );
    }

    const alreadyPaid = order.payments.reduce((s, p) => s + p.amount, 0);
    const outstanding = Math.max(0, order.total - alreadyPaid);
    if (outstanding <= 0) {
      return NextResponse.json(
        { error: "This order has no outstanding balance.", code: "ALREADY_PAID" },
        { status: 409 }
      );
    }

    let credentials;
    try {
      credentials = getMcoCredentialsFromEnv();
    } catch (err) {
      console.error("[MCO-PRELOAD-ORDER] Credentials missing:", err);
      return NextResponse.json(
        { error: "Moneris Checkout is not configured on this environment." },
        { status: 503 }
      );
    }

    // Moneris rejects a repeated order_no on the same store even if the
    // prior attempt was never completed. Append a ms-suffix so page
    // reload / back-nav / retry always gets a fresh number.
    const baseRef = order.displayNumber
      ? `ORD-${order.displayNumber}`
      : `ORD-${order.id.slice(0, 8).toUpperCase()}`;
    const uniqueOrderNo = `${baseRef}-${Date.now().toString().slice(-8)}`.slice(0, 24);

    const result = await createPreload({
      credentials,
      amountCents: outstanding,
      orderNo: uniqueOrderNo,
      dynamicDescriptor: order.orderNumber.slice(0, 22),
      // No cart — MCO shows broken-image icons for cart items lacking a
      // valid `url` field, and we don't ship product photos to Moneris.
      // The amount + descriptor are enough context on the widget.
    });

    return NextResponse.json({
      success: true,
      ticket: result.ticket,
      scriptUrl: result.scriptUrl,
      environment: result.environment,
      amountCents: outstanding,
      currency: order.currency,
      displayNumber: order.displayNumber,
    });
  } catch (err) {
    if (err instanceof McoApiError) {
      console.error("[MCO-PRELOAD-ORDER] Moneris rejected preload", {
        message: err.message,
        raw: err.raw,
      });
      return NextResponse.json(
        { error: `Moneris rejected the preload: ${err.message}` },
        { status: 502 }
      );
    }
    console.error("[MCO-PRELOAD-ORDER] Unexpected error", err);
    return NextResponse.json(
      { error: (err as Error).message || "Preload failed" },
      { status: 500 }
    );
  }
}
