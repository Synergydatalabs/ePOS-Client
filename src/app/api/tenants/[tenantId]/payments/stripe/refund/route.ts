// POST /api/tenants/[tenantId]/payments/stripe/refund
//
// Refund a Stripe payment for an order. Called by the dashboard refund UI
// (or the mobile refund endpoint when the tenant's active card provider
// is Stripe). Full or partial supported.
//
// Body: { orderId, paymentId?, amountCents?, reason? }
//   • paymentId (our internal Payment.id) — used to find the Stripe
//     charge/intent id from Payment.providerRef. Optional if the order
//     has exactly one Stripe payment.
//   • amountCents — refund amount. Defaults to the full payment amount.
//   • reason — passed to Stripe as-is: requested_by_customer | duplicate | fraudulent

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";
import {
  createRefund,
  StripeApiError,
  StripeConfigError,
  type StripeCredentials,
} from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tenantId } = await params;
  const body = await request.json().catch(() => ({}));
  const orderId = typeof body.orderId === "string" ? body.orderId : null;
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : null;
  const requestedAmount = Number.isFinite(Number(body.amountCents))
    ? Math.floor(Number(body.amountCents))
    : null;
  const reason =
    body.reason === "duplicate" || body.reason === "fraudulent"
      ? (body.reason as "duplicate" | "fraudulent")
      : "requested_by_customer";

  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // Membership check.
  const membership = await prisma.tenantMembership.findFirst({
    where: { userId: session.user.id, tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Locate the Stripe payment on this order.
  const order = await prisma.order.findFirst({
    where: { id: orderId, location: { tenantId } },
    select: {
      id: true,
      currency: true,
      payments: {
        where: {
          status: "COMPLETED",
          provider: { in: ["stripe", "STRIPE"] },
          ...(paymentId ? { id: paymentId } : {}),
        },
        orderBy: { completedAt: "desc" },
        select: {
          id: true,
          amount: true,
          providerRef: true,
          metadata: true,
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const payment = order.payments[0];
  if (!payment) {
    return NextResponse.json(
      { error: "No Stripe payment found on this order" },
      { status: 404 }
    );
  }

  // The providerRef stores the Stripe charge/intent id we captured on the
  // checkout.session.completed webhook.
  const chargeOrIntentId = payment.providerRef;
  if (!chargeOrIntentId) {
    return NextResponse.json(
      { error: "Stripe reference missing on payment — can't dispatch refund" },
      { status: 400 }
    );
  }

  const provider = await getActiveProvider({ tenantId, capability: "ECOMMERCE" });
  if (!provider || provider.processor !== "STRIPE") {
    return NextResponse.json(
      { error: "Stripe is not configured for this tenant.", code: "STRIPE_NOT_CONFIGURED" },
      { status: 400 }
    );
  }
  const credentials = provider.credentials as unknown as StripeCredentials;

  const amount = requestedAmount ?? payment.amount;
  if (amount <= 0 || amount > payment.amount) {
    return NextResponse.json(
      { error: `Refund amount must be between 1 and ${payment.amount} cents` },
      { status: 400 }
    );
  }

  try {
    const refund = await createRefund({
      credentials,
      chargeOrIntentId,
      amountCents: amount,
      reason,
      metadata: { orderId: order.id, paymentId: payment.id, tenantId },
    });
    // Note: we DON'T write the Refund row here — that happens on the
    // charge.refunded webhook. This guarantees the same code path fires
    // for both API-initiated refunds and merchant-initiated refunds
    // from the Stripe dashboard. Avoids double-writes.
    return NextResponse.json({
      success: true,
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
      currency: refund.currency,
    });
  } catch (err) {
    if (err instanceof StripeConfigError) {
      return NextResponse.json(
        { error: err.message, code: "STRIPE_CONFIG" },
        { status: 500 }
      );
    }
    if (err instanceof StripeApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code ?? "STRIPE_API" },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: (err as Error)?.message ?? "Refund failed" },
      { status: 500 }
    );
  }
}
