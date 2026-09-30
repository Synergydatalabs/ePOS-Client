// Shared helper: mark an order fully paid or partially paid, write a
// Payment row, log CashMovement if applicable, and fire recipe deduction.
//
// Used by:
//   • /api/mobile/orders/[id]/payment (CASH tender — direct call)
//   • /api/pay/order/[id]/moneris/verify (MCO tender — after server-side
//     receipt lookup confirms Moneris approved)
//
// Extracted so the two entry points can't drift. Same transaction shape
// as the web POS's own tenant-scoped payment route.

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { deductInventoryForOrder } from "@/lib/recipe-deducter";

export interface ApplyPaymentInput {
  orderId: string;
  /** UPPERCASE. e.g. "CASH", "CARD", "INTERAC", "MONERIS_CHECKOUT". */
  method: string;
  /** Cents actually collected for THIS tender. */
  applied: number;
  /** For CASH: cents tendered by customer. For CARD/other: same as applied. */
  tendered: number;
  /** For CASH: cents to return. 0 for CARD. */
  change: number;
  /** Optional processor reference (e.g. Moneris transactionNo, receipt id). */
  processorReference?: string | null;
  /** Optional card metadata for card-based tenders. */
  cardType?: string | null;
  panMasked?: string | null;
  /** Staff who took the payment. Null for anonymous MCO pay-page flows. */
  performedByMemberId?: string | null;
  /** Free-form extras merged into Payment.metadata (e.g. approvalCode). */
  extraMetadata?: Record<string, unknown>;
}

export interface ApplyPaymentResult {
  payment: { id: string; amount: number };
  order: {
    id: string;
    orderNumber: string;
    displayNumber: number | null;
    status: string;
    paymentStatus: string;
    total: number;
    paidAt: Date | null;
  };
  applied: number;
  change: number;
  remaining: number;
  fullyCovers: boolean;
}

/**
 * Apply a payment tender to an order. Idempotency-friendly caller (the
 * caller is expected to have already run gating: outstanding > 0, order
 * exists, etc.) — this function just performs the mutation atomically.
 */
export async function applyMobileOrderPayment(
  input: ApplyPaymentInput
): Promise<ApplyPaymentResult> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      displayNumber: true,
      orderType: true,
      tableId: true,
      total: true,
      currency: true,
      status: true,
      paymentStatus: true,
      locationId: true,
      location: { select: { tenantId: true } },
      payments: {
        where: { status: "COMPLETED" },
        select: { amount: true },
      },
    },
  });
  if (!order) throw new Error(`Order ${input.orderId} not found`);

  const alreadyPaid = order.payments.reduce((s, p) => s + p.amount, 0);
  const cumulativeAfter = alreadyPaid + input.applied;
  const fullyCovers = cumulativeAfter >= order.total;

  const method = input.method.toUpperCase();
  const providerLower = method.toLowerCase();

  const metadata: Prisma.InputJsonValue = {
    tenderedCents: input.tendered,
    change: input.change,
    source: input.performedByMemberId ? "mobile" : "public-pay-page",
    ...(input.processorReference ? { processorReference: input.processorReference } : {}),
    ...(input.cardType ? { cardType: input.cardType } : {}),
    ...(input.panMasked ? { panMasked: input.panMasked } : {}),
    ...(input.extraMetadata ?? {}),
  };

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: providerLower,
        amount: input.applied,
        currency: order.currency,
        status: "COMPLETED",
        method: providerLower,
        completedAt: new Date(),
        providerRef: input.processorReference ?? null,
        metadata,
      },
    });

    // Cash: log against any open drawer session at this location so the
    // drawer reconciles at close. Skip for card-based tenders (they don't
    // physically add to the drawer).
    if (method === "CASH" && input.performedByMemberId) {
      const openDrawer = await tx.cashDrawerSession.findFirst({
        where: {
          tenantId: order.location.tenantId,
          locationId: order.locationId,
          status: "OPEN",
        },
        select: { id: true },
      });
      if (openDrawer) {
        await tx.cashMovement.create({
          data: {
            sessionId: openDrawer.id,
            type: "PAYMENT",
            amount: input.applied,
            orderId: order.id,
            paymentId: payment.id,
            performedById: input.performedByMemberId,
            reason: `Order ${order.displayNumber || order.orderNumber}`,
          },
        });
      }
    }

    const updated = fullyCovers
      ? await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: "COMPLETED",
            paymentMethod: method,
            paidAt: new Date(),
            ...((order.status === "NEW" || order.status === "PENDING_PAYMENT") && {
              status: "CONFIRMED",
            }),
          },
          select: {
            id: true,
            orderNumber: true,
            displayNumber: true,
            status: true,
            paymentStatus: true,
            total: true,
            paidAt: true,
          },
        })
      : {
          id: order.id,
          orderNumber: order.orderNumber,
          displayNumber: order.displayNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          total: order.total,
          paidAt: null,
        };

    // A6 (2026-08-18): auto-release the table on full payment for dine-in
    // orders. Only when THIS payment fully closes the order AND the table
    // has no OTHER active orders (guest ordering may have split across
    // multiple orders on one table — don't free the table if another is
    // still open).
    if (fullyCovers && order.orderType === "DINE_IN" && order.tableId) {
      const otherOpen = await tx.order.count({
        where: {
          tableId: order.tableId,
          id: { not: order.id },
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
      });
      if (otherOpen === 0) {
        // Flip only from OCCUPIED. Leave RESERVED / CLEANING / BLOCKED
        // alone so an explicit host action isn't blown away.
        await tx.table.updateMany({
          where: { id: order.tableId, status: "OCCUPIED" },
          data: { status: "AVAILABLE" },
        });
      }
    }

    return { payment, updated };
  });

  // Fire-and-forget stock deduction on full payment. Mirrors web POS.
  if (fullyCovers) {
    deductInventoryForOrder(
      prisma,
      order.id,
      input.performedByMemberId ?? "system"
    ).catch((err) =>
      console.error(
        `[mark-mobile-order-paid] recipe deduct failed for ${order.id}:`,
        err?.message || err
      )
    );
  }

  return {
    payment: { id: result.payment.id, amount: result.payment.amount },
    order: result.updated,
    applied: input.applied,
    change: input.change,
    remaining: Math.max(0, order.total - cumulativeAfter),
    fullyCovers,
  };
}
