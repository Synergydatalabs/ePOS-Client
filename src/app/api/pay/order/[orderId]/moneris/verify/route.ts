// POST /api/pay/order/[orderId]/moneris/verify
//
// Public — no auth. Called from /pay/order/[orderId] after Moneris
// Checkout fires its `payment_complete` callback. We NEVER trust the
// client's "payment succeeded" claim — this endpoint does a server-to-
// server receipt lookup via the MCO receipt API, then (on approval)
// marks the order paid via the shared applyMobileOrderPayment() helper.
//
// Idempotent — applyMobileOrderPayment checks cumulative COMPLETED
// payments, and this route short-circuits when order.paymentStatus is
// already COMPLETED. So a double-fire of the callback (browser back
// button, refresh, network retry) doesn't create duplicate Payment rows.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { fetchReceipt, getMcoCredentialsFromEnv, McoApiError } from "@/lib/moneris-checkout";
import { applyMobileOrderPayment } from "@/lib/mark-mobile-order-paid";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const ticket = String(body.ticket || "").trim();
    if (!ticket) {
      return NextResponse.json({ error: "Missing ticket" }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        total: true,
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

    // Fast path — already fully paid. The MCO callback often fires twice
    // (widget completion + widget close) and we don't want to hit Moneris
    // receipt endpoint on the second call.
    if (order.paymentStatus === "COMPLETED") {
      return NextResponse.json({
        success: true,
        alreadyPaid: true,
        paymentStatus: "COMPLETED",
      });
    }

    let credentials;
    try {
      credentials = getMcoCredentialsFromEnv();
    } catch (err) {
      console.error("[MCO-VERIFY-ORDER] Credentials missing:", err);
      return NextResponse.json(
        { error: "Moneris Checkout is not configured on this environment." },
        { status: 503 }
      );
    }

    // Server-to-server receipt lookup — the ONLY source of truth for
    // approval. The JS `payment_complete` callback only means "widget
    // closed"; approved vs declined only comes from here.
    const receipt = await fetchReceipt({ credentials, ticket });

    if (!receipt.approved) {
      console.log(
        `[MCO-VERIFY-ORDER] Order ${order.orderNumber} not approved (statusCode=${receipt.responseCode}, ${receipt.message})`
      );
      return NextResponse.json({
        success: false,
        approved: false,
        message: receipt.message,
        responseCode: receipt.responseCode,
      });
    }

    // Approved. Apply payment via shared helper. amountCents from the
    // receipt is authoritative — usually matches outstanding but Moneris
    // is the source of truth on what was actually charged.
    const alreadyPaid = order.payments.reduce((s, p) => s + p.amount, 0);
    const outstanding = Math.max(0, order.total - alreadyPaid);
    const applied = Math.min(receipt.amountCents ?? outstanding, outstanding);

    const result = await applyMobileOrderPayment({
      orderId: order.id,
      method: "MONERIS_CHECKOUT",
      applied,
      tendered: applied,
      change: 0,
      processorReference: receipt.transactionNo ?? ticket,
      cardType: receipt.cardType ?? null,
      panMasked: receipt.panMasked ?? null,
      performedByMemberId: null, // customer-driven, no staff attribution
      extraMetadata: {
        approvalCode: receipt.approvalCode,
        responseCode: receipt.responseCode,
      },
    });

    console.log(
      `[MCO-VERIFY-ORDER] Order ${order.orderNumber} ${
        result.fullyCovers ? "fully paid" : "partial applied"
      } via MCO (auth ${receipt.approvalCode})`
    );

    return NextResponse.json({
      success: true,
      approved: true,
      paymentStatus: result.order.paymentStatus,
      applied: result.applied,
      remaining: result.remaining,
      approvalCode: receipt.approvalCode,
      cardType: receipt.cardType,
      panMasked: receipt.panMasked,
    });
  } catch (err) {
    if (err instanceof McoApiError) {
      console.error("[MCO-VERIFY-ORDER] Moneris rejected receipt lookup", {
        message: err.message,
        raw: err.raw,
      });
      return NextResponse.json(
        { error: `Moneris receipt lookup failed: ${err.message}` },
        { status: 502 }
      );
    }
    console.error("[MCO-VERIFY-ORDER] Unexpected error", err);
    return NextResponse.json(
      { error: (err as Error).message || "Verification failed" },
      { status: 500 }
    );
  }
}
