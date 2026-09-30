// POST /api/mobile/orders/[orderId]/refund
//
// Refund an order across all its completed payments, dispatching per
// processor. A9.2 (2026-08-18) full-processor scope:
//   • cash              → local write only
//   • gp_uci            → refundBill(lane, amount, gpTrnId) — async, GP
//                         webhook updates the Refund row when settled
//   • moneris_terminal  → refundOnTerminal(credentials, originalOrderId,
//                         amount) — SYNC, blocks ~90s while customer taps
//                         the same card on the terminal
//   • moneris_checkout  → BLOCKED. Moneris Checkout has no programmatic
//                         refund API. Merchant must refund via the
//                         Moneris portal.
//
// Body: { reason? }
//
// Semantics: full-order refund. If any payment can't be refunded (e.g.
// MCO), the entire request is blocked so the user knows to handle it
// externally. Partial / per-payment refunds via web POS.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";
import { refundBill } from "@/lib/gp-uci";
// 2026-09-08: import direct from client.ts + types.ts instead of the
// @/lib/moneris barrel. The barrel re-export of `refundOnTerminal` was
// tripping Next.js's Webpack build with "Attempted import error:
// 'refundOnTerminal' is not exported from '@/lib/moneris'" even though
// TypeScript resolved it fine. Direct imports side-step the tree-shake
// analysis entirely.
import { refundOnTerminal as monerisRefundOnTerminal } from "@/lib/moneris/client";
import { MonerisApiError, type MonerisCredentials } from "@/lib/moneris/types";

export const dynamic = "force-dynamic";

const LOCAL_PROVIDERS = new Set(["cash", "online", "gift_card"]);
const UNREFUNDABLE_PROVIDERS = new Set(["moneris_checkout"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => ({}));
  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 250)
      : null;

  const order = await prisma.order.findFirst({
    where: { id: orderId, locationId: ctx.ctx.locationId },
    select: {
      id: true,
      paymentStatus: true,
      total: true,
      currency: true,
      location: { select: { tenantId: true } },
      payments: {
        select: {
          id: true,
          amount: true,
          provider: true,
          method: true,
          status: true,
          providerRef: true,
          refunds: {
            where: { status: { in: ["COMPLETED", "PENDING", "PROCESSING"] } },
            select: { amount: true },
          },
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const completedPayments = order.payments.filter((p) => p.status === "COMPLETED");
  if (completedPayments.length === 0) {
    return NextResponse.json(
      { error: "This order has no completed payments to refund" },
      { status: 400 }
    );
  }

  // Pre-flight: reject the WHOLE order if any payment is un-refundable via
  // mobile. Prevents partial refund state where cash gets refunded but MCO
  // gets stuck manual.
  const mcoPayments = completedPayments.filter((p) =>
    UNREFUNDABLE_PROVIDERS.has((p.provider ?? "").toLowerCase())
  );
  if (mcoPayments.length > 0) {
    return NextResponse.json(
      {
        error:
          "This order was paid via Moneris Checkout (customer QR). MCO refunds must be issued through your Moneris merchant portal — the mobile app can't refund them programmatically.",
        code: "MCO_REFUND_NOT_SUPPORTED",
      },
      { status: 409 }
    );
  }

  const anyRefundable = completedPayments.some((p) => {
    const already = p.refunds.reduce((s, r) => s + r.amount, 0);
    return already < p.amount;
  });
  if (!anyRefundable) {
    return NextResponse.json(
      { error: "This order has already been refunded" },
      { status: 409 }
    );
  }

  // Look up card provider ONCE if there's any card payment. Avoids
  // per-payment cache-miss + decrypt overhead.
  const hasCardPayment = completedPayments.some((p) => {
    const method = (p.provider ?? "").toLowerCase();
    return !LOCAL_PROVIDERS.has(method);
  });
  const cardProvider = hasCardPayment
    ? await getActiveProvider({
        tenantId: order.location.tenantId,
        capability: "CARD",
      })
    : null;

  // Iterate + dispatch per payment. Non-transactional overall because GP is
  // async and Moneris terminal is a synchronous blocking network call —
  // wrapping everything in a single $transaction would hold row locks for
  // 60+ seconds. Instead we do each dispatch + write serially. Partial
  // failure returns the results-so-far so operator can retry the remainder.
  const results: RefundLegResult[] = [];
  let refundedTotal = 0;

  for (const payment of completedPayments) {
    const alreadyRefunded = payment.refunds.reduce((s, r) => s + r.amount, 0);
    const remaining = payment.amount - alreadyRefunded;
    if (remaining <= 0) continue; // already fully refunded

    const providerCode = (payment.provider ?? "").toLowerCase();

    try {
      if (LOCAL_PROVIDERS.has(providerCode)) {
        await refundLocalPayment({
          orderId: order.id,
          payment,
          amount: remaining,
          reason,
          tenantId: order.location.tenantId,
          locationId: ctx.ctx.locationId,
          performedByMemberId: ctx.ctx.session.memberId,
        });
      } else if (providerCode === "gp_uci") {
        await refundGpPayment({
          payment,
          amount: remaining,
          reason,
          performedByMemberId: ctx.ctx.session.memberId,
          credentials: (cardProvider?.credentials as Record<string, string>) || {},
        });
      } else if (providerCode === "moneris_terminal") {
        await refundMonerisTerminalPayment({
          payment,
          amount: remaining,
          reason,
          originalOrderId: order.id,
          performedByMemberId: ctx.ctx.session.memberId,
          credentials: (cardProvider?.credentials as unknown as MonerisCredentials) ?? null,
        });
      } else {
        throw new Error(
          `Unknown payment provider "${providerCode}" — cannot refund from mobile`
        );
      }

      results.push({ paymentId: payment.id, provider: providerCode, refunded: remaining, ok: true });
      refundedTotal += remaining;
    } catch (err: any) {
      console.error(
        `[mobile refund] payment ${payment.id} (${providerCode}) failed:`,
        err?.message || err
      );
      results.push({
        paymentId: payment.id,
        provider: providerCode,
        refunded: 0,
        ok: false,
        error: err?.message || "Refund failed",
      });
      // Continue with the next payment — a GP failure shouldn't block a
      // cash tender's refund.
    }
  }

  // Recompute Order.paymentStatus based on refunded vs paid totals.
  const totalPaid = completedPayments.reduce((s, p) => s + p.amount, 0);
  const totalRefundedAfter = completedPayments.reduce((s, p) => {
    const already = p.refunds.reduce((rs, r) => rs + r.amount, 0);
    const thisLegRefunded = results.find((r) => r.paymentId === p.id && r.ok)?.refunded ?? 0;
    return s + Math.min(p.amount, already + thisLegRefunded);
  }, 0);

  const nextPaymentStatus =
    totalRefundedAfter >= totalPaid && totalRefundedAfter > 0
      ? "REFUNDED"
      : totalRefundedAfter > 0
      ? "PARTIALLY_REFUNDED"
      : order.paymentStatus;

  if (nextPaymentStatus !== order.paymentStatus) {
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: nextPaymentStatus },
    });
  }

  const anyFailure = results.some((r) => !r.ok);
  const anySuccess = results.some((r) => r.ok);

  return NextResponse.json({
    success: anySuccess && !anyFailure,
    partial: anySuccess && anyFailure,
    refunded: refundedTotal,
    currency: order.currency,
    paymentStatus: nextPaymentStatus,
    results,
  });
}

// ---------------------------------------------------------------------------
// Per-provider refund helpers
// ---------------------------------------------------------------------------

interface RefundLegResult {
  paymentId: string;
  provider: string;
  refunded: number;
  ok: boolean;
  error?: string;
}

interface CommonRefundArgs {
  payment: {
    id: string;
    amount: number;
    provider: string | null;
    method: string | null;
    providerRef: string | null;
  };
  amount: number;
  reason: string | null;
  performedByMemberId: string;
}

/**
 * Local cash / online / gift-card refund — no processor call, just write
 * the Refund row + flip Payment.status + log CashMovement for cash.
 */
async function refundLocalPayment(args: CommonRefundArgs & {
  orderId: string;
  tenantId: string;
  locationId: string;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.refund.create({
      data: {
        paymentId: args.payment.id,
        amount: args.amount,
        reason: args.reason,
        status: "COMPLETED",
        completedAt: new Date(),
        initiatedById: args.performedByMemberId,
      },
    });
    await tx.payment.update({
      where: { id: args.payment.id },
      data: { status: "REFUNDED" },
    });

    // Cash → log against open drawer session (subtracts from drawer count).
    if ((args.payment.provider ?? "").toLowerCase() === "cash") {
      const openDrawer = await tx.cashDrawerSession.findFirst({
        where: { tenantId: args.tenantId, locationId: args.locationId, status: "OPEN" },
        select: { id: true },
      });
      if (openDrawer) {
        await tx.cashMovement.create({
          data: {
            sessionId: openDrawer.id,
            type: "REFUND",
            amount: -args.amount,
            orderId: args.orderId,
            paymentId: args.payment.id,
            performedById: args.performedByMemberId,
            reason: args.reason ?? `Refund payment ${args.payment.id.slice(0, 8)}`,
          },
        });
      }
    }
  });
}

/**
 * GP UCI refund — call refundBill with the original TRN id + terminal lane.
 * refundBill is async (returns DVC ack); we optimistically mark the Refund
 * row COMPLETED with providerRef=gpBillId. The GP webhook confirms the
 * actual settlement later; if it declines, ops would need to reconcile
 * manually (rare, and matches web POS behaviour).
 */
async function refundGpPayment(args: CommonRefundArgs & {
  credentials: Record<string, string>;
}) {
  const gpTransactionId = args.payment.providerRef;
  if (!gpTransactionId) {
    throw new Error(
      "GP payment has no transaction reference on file — cannot refund. Use the web POS instead."
    );
  }

  // Look up the terminal + its uci_lane via the original uci_bills row.
  // Refund goes back through the same lane so the customer's terminal
  // slip aligns with the sale.
  const uciBill: Array<{ uci_lane: string | null; terminal_id: string }> =
    await prisma.$queryRawUnsafe(
      `SELECT t.uci_lane, ub.terminal_id
       FROM uci_bills ub
       LEFT JOIN terminals t ON t.id = ub.terminal_id
       WHERE ub.gp_bill_id = $1 OR ub.gp_transaction_id = $1
       ORDER BY ub.created_at DESC
       LIMIT 1`,
      gpTransactionId
    );

  const lane = uciBill[0]?.uci_lane;
  if (!lane) {
    throw new Error(
      "GP payment has no terminal on file — cannot refund. Use the web POS instead."
    );
  }

  const gpResponse = await refundBill(lane, args.amount, gpTransactionId);

  await prisma.$transaction(async (tx) => {
    await tx.refund.create({
      data: {
        paymentId: args.payment.id,
        amount: args.amount,
        reason: args.reason,
        status: "COMPLETED",
        completedAt: new Date(),
        providerRef: gpResponse.gpBillId,
        initiatedById: args.performedByMemberId,
      },
    });
    await tx.payment.update({
      where: { id: args.payment.id },
      data: { status: "REFUNDED" },
    });
  });
}

/**
 * Moneris DX8000 terminal refund — synchronous. The customer must tap the
 * SAME card on the terminal. This blocks the request for ~15-90 seconds
 * while the terminal processes. On approval we write the Refund row.
 */
async function refundMonerisTerminalPayment(args: CommonRefundArgs & {
  originalOrderId: string;
  credentials: MonerisCredentials | null;
}) {
  if (!args.credentials || !args.credentials.store_id || !args.credentials.api_token) {
    throw new Error(
      "Moneris credentials are not configured — cannot refund via terminal."
    );
  }

  let result;
  try {
    result = await monerisRefundOnTerminal({
      credentials: args.credentials,
      originalOrderId: args.originalOrderId,
      amountCents: args.amount,
    });
  } catch (err: any) {
    if (err instanceof MonerisApiError) {
      throw new Error(`Moneris rejected the refund: ${err.message}`);
    }
    throw err;
  }

  if (!result.approved) {
    throw new Error(result.message || "Moneris terminal declined the refund");
  }

  await prisma.$transaction(async (tx) => {
    await tx.refund.create({
      data: {
        paymentId: args.payment.id,
        amount: args.amount,
        reason: args.reason,
        status: "COMPLETED",
        completedAt: new Date(),
        providerRef: result.cloudTicket ?? result.idempotencyKey,
        initiatedById: args.performedByMemberId,
      },
    });
    await tx.payment.update({
      where: { id: args.payment.id },
      data: { status: "REFUNDED" },
    });
  });
}
