// POST /api/tenants/[tenantId]/orders/[orderId]/payment/refund
//
// Refunds a completed payment, in full or partial. For card payments this
// calls GP UCI's REFUND action against the original TRN; the customer needs
// to re-present the same card on the terminal (GP requirement, manager-
// authorized). For cash/online we just record the refund row and update
// the Payment status — there's nothing to issue at GP.
//
// The POS history page (handleRefund in pos/history/page.tsx) already calls
// this path; until now it was 404'ing and silently failing.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { refundBill } from "@/lib/gp-uci";
import { generateGiftCardCode } from "@/lib/gift-card-code";

type Params = { params: Promise<{ tenantId: string; orderId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { tenantId, orderId } = await params;

  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const body = await request.json().catch(() => ({}));
  const { paymentId, amount, reason, refundTo } = body as {
    paymentId?: string;
    amount?: number; // cents
    reason?: string;
    // Where the money should go:
    //   'ORIGINAL' (default) — back to the original payment method
    //   'GIFT_CARD'          — issue a new gift card for the refund amount
    refundTo?: "ORIGINAL" | "GIFT_CARD";
  };

  if (!paymentId) {
    return NextResponse.json(
      { error: "paymentId is required" },
      { status: 400 }
    );
  }
  if (typeof amount !== "number" || amount <= 0) {
    return NextResponse.json(
      { error: "amount (in cents) is required and must be > 0" },
      { status: 400 }
    );
  }

  // Find the payment + any prior refunds so we can validate the headroom.
  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      orderId,
      order: { location: { tenantId } },
    },
    select: {
      id: true,
      provider: true,
      method: true,
      status: true,
      amount: true,
      providerRef: true,
      refunds: { select: { amount: true, status: true } },
    },
  });

  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (
    payment.status === "CANCELLED" ||
    payment.status === "FAILED" ||
    payment.status === "REFUNDED"
  ) {
    return NextResponse.json(
      {
        error: `Cannot refund a payment in ${payment.status} state`,
      },
      { status: 409 }
    );
  }

  // Sum existing refunds that already counted (COMPLETED or PENDING) so we
  // don't oversend the total refund amount above the original payment.
  const alreadyRefunded = payment.refunds
    .filter((r) => r.status !== "FAILED" && r.status !== "CANCELLED")
    .reduce((sum, r) => sum + r.amount, 0);

  if (alreadyRefunded + amount > payment.amount) {
    return NextResponse.json(
      {
        error: `Refund would exceed payment total. Available: ${
          payment.amount - alreadyRefunded
        } cents.`,
      },
      { status: 400 }
    );
  }

  const method = (payment.method || payment.provider || "").toLowerCase();
  // gift_card, cash, online: nothing to send to the acquirer — we settle
  // entirely in our DB. Gift-card-out is also local (we're issuing a new
  // card, not talking to a PSP).
  const isLocalOnly =
    method === "cash" ||
    method === "online" ||
    method === "gift_card" ||
    refundTo === "GIFT_CARD";

  let gpRefundResponse: { gpBillId: string; rawResponse: unknown } | null = null;

  if (!isLocalOnly) {
    // Pull the original AUTHORIZE's TRN + terminal lane to scope the REFUND.
    // We look at the most recent terminal_transactions row tied to this
    // payment_id with a non-null GP TRN.
    const txnRows: Array<{
      gp_transaction_id: string | null;
      uci_lane: string | null;
    }> = await prisma.$queryRawUnsafe(
      `SELECT tt.gp_transaction_id, t.uci_lane
         FROM terminal_transactions tt
         LEFT JOIN terminals t ON tt.terminal_id = t.id
        WHERE tt.payment_id = $1::uuid
          AND tt.gp_transaction_id IS NOT NULL
        ORDER BY tt.sent_at DESC
        LIMIT 1`,
      paymentId
    );

    const trnId = txnRows[0]?.gp_transaction_id || payment.providerRef;
    const lane = txnRows[0]?.uci_lane;

    if (!trnId) {
      return NextResponse.json(
        {
          error:
            "No GP transaction reference recorded for this payment — cannot route REFUND to GP.",
        },
        { status: 422 }
      );
    }
    if (!lane) {
      return NextResponse.json(
        {
          error:
            "Terminal lane is missing for this payment — cannot route REFUND to GP.",
        },
        { status: 422 }
      );
    }

    try {
      const gpResp = await refundBill(lane, amount, trnId);
      gpRefundResponse = gpResp;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[PAYMENT REFUND] GP REFUND failed:", message);
      return NextResponse.json(
        { error: `GP REFUND failed: ${message}`, source: "gp" },
        { status: 502 }
      );
    }
  }

  // Local DB: insert Refund row, advance Payment status, and update the
  // Order's paymentStatus. When ALL payments on the order are fully
  // refunded the order flips to REFUNDED; when any payment has a refund
  // but the order isn't fully unwound, it's PARTIALLY_REFUNDED.
  const newTotalRefunded = alreadyRefunded + amount;
  const fullyRefunded = newTotalRefunded >= payment.amount;

  // For gift-card refunds we mint a new GiftCard as the "payout".
  // Doing it inside the transaction guarantees the card only appears if
  // the refund row also lands.
  let issuedGiftCardCode: string | null = null;
  let issuedGiftCardId: string | null = null;

  const refund = await prisma.$transaction(async (tx) => {
    const r = await tx.refund.create({
      data: {
        paymentId: payment.id,
        amount,
        reason: reason || null,
        status: "COMPLETED",
        providerRef: gpRefundResponse?.gpBillId || null,
        initiatedById: auth.context.membership.id,
        completedAt: new Date(),
      },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
      },
    });

    // Auto-log a REFUND cash movement if this is a cash refund and there's
    // an OPEN drawer at the order's location. Only applies when refundTo
    // is ORIGINAL and the underlying payment was cash — GIFT_CARD refunds
    // move value into a new gift card, not out of the drawer.
    if (
      (refundTo || "ORIGINAL") === "ORIGINAL" &&
      method === "cash"
    ) {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { locationId: true, displayNumber: true, orderNumber: true },
      });
      if (order) {
        const openDrawer = await tx.cashDrawerSession.findFirst({
          where: { tenantId, locationId: order.locationId, status: "OPEN" },
          select: { id: true },
        });
        if (openDrawer) {
          await tx.cashMovement.create({
            data: {
              sessionId: openDrawer.id,
              type: "REFUND",
              amount: -amount, // out of drawer
              orderId,
              paymentId: payment.id,
              performedById: auth.context.membership.id,
              reason: `Refund for order ${order.displayNumber || order.orderNumber}`,
            },
          });
        }
      }
    }

    if (refundTo === "GIFT_CARD") {
      // Attempt up to 5 codes in case of a (vanishingly unlikely) unique
      // collision. Mirrors the gift-card issue flow.
      let created = null as null | { id: string; code: string };
      for (let i = 0; i < 5 && !created; i++) {
        const code = generateGiftCardCode();
        try {
          const gc = await tx.giftCard.create({
            data: {
              tenantId,
              code,
              type: "DIGITAL",
              initialAmount: amount,
              balance: amount,
              currency: (await tx.order.findUnique({
                where: { id: orderId },
                select: { currency: true },
              }))?.currency || "CAD",
              issuedById: auth.context.membership.id,
              transactions: {
                create: {
                  type: "ISSUE",
                  amount,
                  balanceAfter: amount,
                  performedById: auth.context.membership.id,
                  notes: `Refund from order ${orderId.slice(0, 8)}${reason ? ` — ${reason}` : ""}`,
                },
              },
            },
            select: { id: true, code: true },
          });
          created = gc;
        } catch (err: any) {
          if (err?.code !== "P2002") throw err;
        }
      }
      if (!created) {
        throw new Error("Could not generate unique gift card code for refund");
      }
      issuedGiftCardCode = created.code;
      issuedGiftCardId = created.id;
    }

    // Recompute order-level refund state across ALL payments (not just this
    // one) so multi-tender orders show the right status.
    const allPayments = await tx.payment.findMany({
      where: { orderId },
      select: {
        amount: true,
        refunds: {
          where: { status: { notIn: ["FAILED", "CANCELLED"] } },
          select: { amount: true },
        },
      },
    });
    const orderTotalPaid = allPayments.reduce((s, p) => s + p.amount, 0);
    const orderTotalRefunded = allPayments.reduce(
      (s, p) => s + p.refunds.reduce((rs, rf) => rs + rf.amount, 0),
      0
    );
    const orderPaymentStatus =
      orderTotalRefunded >= orderTotalPaid && orderTotalPaid > 0
        ? "REFUNDED"
        : orderTotalRefunded > 0
          ? "PARTIALLY_REFUNDED"
          : undefined;
    if (orderPaymentStatus) {
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: orderPaymentStatus },
      });
    }

    return r;
  });

  return NextResponse.json({
    success: true,
    refund: {
      id: refund.id,
      amount: refund.amount,
      status: refund.status,
      providerRef: refund.providerRef,
      refundedRemotely: !isLocalOnly,
    },
    paymentStatus: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
    giftCard: issuedGiftCardCode
      ? { id: issuedGiftCardId, code: issuedGiftCardCode, balance: amount }
      : undefined,
  });
}
