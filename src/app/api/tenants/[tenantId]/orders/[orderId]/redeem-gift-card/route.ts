// POST /api/tenants/[tenantId]/orders/[orderId]/redeem-gift-card
//   Body: { code: string, amount?: number }
//   Apply a gift card as (partial or full) payment against an order.
//   - amount defaults to min(cardBalance, orderTotalRemaining).
//   - Creates a Payment row (provider="gift_card") and a REDEEM ledger entry.
//   - Marks order paid+confirmed only if the full total is now covered.
//
// This is a cash-equivalent operation so it lives under the order path
// alongside the existing /payment endpoint rather than under gift-cards.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { deductInventoryForOrder } from "@/lib/recipe-deducter";
import { normalizeGiftCardCode } from "@/lib/gift-card-code";

type Params = { params: Promise<{ tenantId: string; orderId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, orderId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const codeRaw = String(body?.code || "").trim();
    const requestedAmount: number | undefined =
      typeof body?.amount === "number" ? body.amount : undefined;

    if (!codeRaw) {
      return NextResponse.json(
        { error: "Gift card code is required" },
        { status: 400 }
      );
    }

    const code = normalizeGiftCardCode(codeRaw);

    // Load order + card + already-applied payments so we know how much of
    // the total is still outstanding.
    const order = await prisma.order.findFirst({
      where: { id: orderId, location: { tenantId } },
      select: {
        id: true,
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

    const card = await prisma.giftCard.findFirst({
      where: { tenantId, code },
    });
    if (!card) {
      return NextResponse.json(
        { error: "Gift card not found or invalid" },
        { status: 404 }
      );
    }
    if (card.status !== "ACTIVE") {
      return NextResponse.json(
        { error: `This card is ${card.status.toLowerCase()}` },
        { status: 400 }
      );
    }
    if (card.balance <= 0) {
      return NextResponse.json(
        { error: "This card has no remaining balance" },
        { status: 400 }
      );
    }
    if (card.expiresAt && new Date(card.expiresAt) < new Date()) {
      // Flip the status while we're here so it doesn't get offered again
      await prisma.giftCard.update({
        where: { id: card.id },
        data: { status: "EXPIRED" },
      });
      return NextResponse.json({ error: "This card has expired" }, { status: 400 });
    }
    if (card.currency !== order.currency) {
      return NextResponse.json(
        {
          error: `Card is in ${card.currency}, order is in ${order.currency}`,
        },
        { status: 400 }
      );
    }

    const alreadyPaid = order.payments.reduce((s, p) => s + p.amount, 0);
    const outstanding = Math.max(0, order.total - alreadyPaid);
    if (outstanding <= 0) {
      return NextResponse.json(
        { error: "Order is already fully paid" },
        { status: 400 }
      );
    }

    // Cap redemption at whichever is smaller: what the card holds vs.
    // what the order still owes. Honour the operator's requested amount
    // only when it fits inside both.
    const cap = Math.min(card.balance, outstanding);
    const applyAmount =
      requestedAmount && requestedAmount > 0
        ? Math.min(requestedAmount, cap)
        : cap;

    if (applyAmount <= 0) {
      return NextResponse.json(
        { error: "Nothing to redeem" },
        { status: 400 }
      );
    }

    const newCardBalance = card.balance - applyAmount;
    const fullyCovers = alreadyPaid + applyAmount >= order.total;

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          provider: "gift_card",
          providerRef: card.code,
          amount: applyAmount,
          currency: order.currency,
          status: "COMPLETED",
          method: "GIFT_CARD",
          completedAt: new Date(),
          metadata: {
            giftCardId: card.id,
            giftCardCodeLast4: card.code.slice(-4),
          },
        },
      });

      const updatedCard = await tx.giftCard.update({
        where: { id: card.id },
        data: {
          balance: newCardBalance,
          status: newCardBalance === 0 ? "REDEEMED" : "ACTIVE",
        },
      });

      await tx.giftCardTransaction.create({
        data: {
          giftCardId: card.id,
          orderId: order.id,
          paymentId: payment.id,
          type: "REDEEM",
          amount: -applyAmount, // debit
          balanceAfter: newCardBalance,
          performedById: auth.context.membership.id,
          notes: `Redeemed against order`,
        },
      });

      const updatedOrder = fullyCovers
        ? await tx.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: "COMPLETED",
              paymentMethod: "GIFT_CARD",
              ...((order.status === "NEW" ||
                order.status === "PENDING_PAYMENT") && {
                status: "CONFIRMED",
              }),
            },
            select: {
              id: true,
              status: true,
              paymentStatus: true,
              total: true,
            },
          })
        : { id: order.id, status: order.status, paymentStatus: "PARTIAL", total: order.total };

      return { payment, updatedCard, updatedOrder };
    });

    // Deduct recipe ingredients if the gift-card redemption is what tipped
    // the order into fully-paid state. Best-effort — never blocks or fails.
    if (fullyCovers) {
      deductInventoryForOrder(
        prisma,
        order.id,
        auth.context.membership.id
      ).catch((err) =>
        console.error(
          `[redeem-gift-card] recipe deduct failed for ${order.id}:`,
          err?.message || err
        )
      );
    }

    return NextResponse.json({
      success: true,
      applied: applyAmount,
      remainingOnOrder: Math.max(0, order.total - alreadyPaid - applyAmount),
      remainingOnCard: newCardBalance,
      cardStatus: result.updatedCard.status,
      order: result.updatedOrder,
    });
  } catch (error: any) {
    console.error("[redeem-gift-card] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to redeem gift card" },
      { status: 500 }
    );
  }
}
