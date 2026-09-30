// POST /api/webhooks/payment/stripe
//
// Stripe webhook handler. Verifies signature per-tenant, then dispatches
// on event type:
//
//   checkout.session.completed     → mark order paid + write Payment row
//   charge.refunded                → write Refund entry (or mark payment refunded)
//   payment_intent.payment_failed  → log for debugging
//
// Tenant resolution:
//   Stripe events don't carry a tenantId natively. We stuff `metadata.tenantId`
//   onto every Checkout Session + PaymentIntent when we create them, so this
//   handler can look it up on the way in. For refund events that don't come
//   with our metadata (e.g. merchant refunded from Stripe dashboard), we fall
//   back to looking up the Payment row by providerRef.
//
// IMPORTANT: this route reads the RAW request body (Buffer) because Stripe's
// signature verification recomputes HMAC over the exact bytes. Next.js's
// default JSON parsing would corrupt this — hence the `export const runtime`
// bit and manual arrayBuffer read below.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyWebhookEvent, type StripeCredentials } from "@/lib/stripe";
import { STRIPE_EVENTS } from "@/lib/stripe/constants";
import { kybDecryptJson } from "@/lib/kyb-crypto";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";
// Force Node runtime — we need raw body for HMAC verification, and the
// Edge runtime buffers differently.
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe-Signature header" },
      { status: 400 }
    );
  }

  const rawBody = Buffer.from(await request.arrayBuffer());

  // We don't know which tenant yet — but we can peek at the unverified
  // payload to find the metadata.tenantId, then look up that tenant's
  // webhookSecret and RE-verify against the raw body.
  //
  // This is safe because:
  //   1. We only trust the event AFTER signature verification succeeds
  //   2. A malicious sender picking a random tenantId will still fail
  //      signature verification (they don't have that tenant's secret)
  let unverifiedTenantId: string | null = null;
  try {
    const peek = JSON.parse(rawBody.toString("utf8"));
    const obj = peek?.data?.object;
    // Look for tenantId in a few plausible spots:
    //   • checkout.session.completed → session.metadata.tenantId
    //   • charge.refunded            → charge.metadata.tenantId
    //   • payment_intent events with expanded intent → intent.metadata.tenantId
    const direct = obj?.metadata?.tenantId ?? null;
    const nestedIntent =
      obj?.payment_intent && typeof obj.payment_intent === "object"
        ? obj.payment_intent?.metadata?.tenantId ?? null
        : null;
    unverifiedTenantId = direct ?? nestedIntent;
  } catch {
    // Malformed body — signature check will fail anyway, return 400 below.
  }

  // Locate the Stripe provider row. If we peeked a tenantId, look up that
  // one; otherwise fall back to matching by charge/intent id via existing
  // Payment.providerRef (dashboard-initiated refunds).
  let providerRow:
    | {
        tenantId: string;
        credentialsEnc: unknown;
      }
    | null = null;

  if (unverifiedTenantId) {
    const row = await prisma.tenantPaymentProvider.findFirst({
      where: {
        tenantId: unverifiedTenantId,
        processor: "STRIPE",
        status: "ACTIVE",
      },
      select: { tenantId: true, credentialsEnc: true },
    });
    providerRow = row;
  }

  if (!providerRow) {
    // Fallback: dashboard-initiated refund — no metadata. Look up the
    // Payment row by any Stripe reference in the body.
    const peek = JSON.parse(rawBody.toString("utf8"));
    const obj = peek?.data?.object;
    const chargeId = obj?.id ?? obj?.charge ?? null;
    if (chargeId) {
      const payment = await prisma.payment.findFirst({
        where: {
          provider: { in: ["stripe", "STRIPE"] },
          providerRef: chargeId,
        },
        select: { order: { select: { location: { select: { tenantId: true } } } } },
      });
      const tenantId = payment?.order?.location?.tenantId ?? null;
      if (tenantId) {
        providerRow = await prisma.tenantPaymentProvider.findFirst({
          where: { tenantId, processor: "STRIPE", status: "ACTIVE" },
          select: { tenantId: true, credentialsEnc: true },
        });
      }
    }
  }

  if (!providerRow) {
    console.warn("[stripe webhook] no matching tenant provider — rejecting");
    return NextResponse.json({ error: "Unknown tenant" }, { status: 404 });
  }

  let credentials: StripeCredentials;
  try {
    credentials = kybDecryptJson<StripeCredentials>(providerRow.credentialsEnc);
  } catch (err) {
    console.error("[stripe webhook] credential decrypt failed:", err);
    return NextResponse.json({ error: "Credential decrypt failed" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookEvent({
      rawBody,
      signatureHeader: signature,
      webhookSecret: credentials.webhookSecret,
    });
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
  }

  // ------------------- Event dispatch -------------------

  try {
    switch (event.type) {
      case STRIPE_EVENTS.CHECKOUT_COMPLETED: {
        await handleCheckoutCompleted(event, providerRow.tenantId);
        break;
      }
      case STRIPE_EVENTS.CHARGE_REFUNDED: {
        await handleChargeRefunded(event);
        break;
      }
      case STRIPE_EVENTS.PAYMENT_FAILED: {
        const pi = event.data.object as Stripe.PaymentIntent;
        console.warn(
          `[stripe webhook] payment_intent.payment_failed id=${pi.id} order=${pi.metadata?.orderId ?? "?"} error=${pi.last_payment_error?.message ?? "unknown"}`
        );
        break;
      }
      default:
        // Unhandled event types are fine — Stripe delivers many that we
        // don't care about. Return 200 so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] dispatch failed:", err);
    return NextResponse.json({ error: (err as Error)?.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(event: Stripe.Event, tenantId: string) {
  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.orderId;
  if (!orderId) {
    console.warn("[stripe webhook] checkout.session.completed with no orderId metadata — skipping");
    return;
  }

  // Amount paid + PaymentIntent id (used later for refunds).
  const amountCents = session.amount_total ?? 0;
  const currency = (session.currency ?? "cad").toLowerCase();
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const order = await prisma.order.findFirst({
    where: { id: orderId, location: { tenantId } },
    select: {
      id: true,
      total: true,
      status: true,
      paymentStatus: true,
      payments: {
        where: { status: "COMPLETED" },
        select: { amount: true },
      },
    },
  });
  if (!order) {
    console.warn(`[stripe webhook] order ${orderId} not found for tenant ${tenantId}`);
    return;
  }

  // Idempotency: if the Payment row already exists for this session, skip.
  const existing = await prisma.payment.findFirst({
    where: { providerRef: paymentIntentId ?? session.id },
    select: { id: true },
  });
  if (existing) {
    console.log(`[stripe webhook] payment already recorded (id=${existing.id})`);
    return;
  }

  const cumulativeAfter = order.payments.reduce((s, p) => s + p.amount, 0) + amountCents;
  const fullyCovers = cumulativeAfter >= order.total;

  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: "stripe",
        method: "stripe",
        amount: amountCents,
        currency: currency.toUpperCase(),
        status: "COMPLETED",
        completedAt: new Date(),
        providerRef: paymentIntentId ?? session.id,
        metadata: {
          stripeSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,
          customerEmail: session.customer_details?.email ?? null,
          source: "stripe-webhook",
        },
      },
    });

    if (fullyCovers) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: "COMPLETED",
          paymentMethod: "STRIPE",
          paidAt: new Date(),
          ...(order.status === "NEW" || order.status === "PENDING_PAYMENT"
            ? { status: "CONFIRMED" }
            : {}),
        },
      });
    }
  });

  console.log(
    `[stripe webhook] recorded payment for order=${orderId} amount=${amountCents} intent=${paymentIntentId}`
  );
}

async function handleChargeRefunded(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;

  // Find our Payment row by paymentIntentId (preferred) or charge id.
  const payment = await prisma.payment.findFirst({
    where: {
      provider: { in: ["stripe", "STRIPE"] },
      OR: [
        paymentIntentId ? { providerRef: paymentIntentId } : {},
        { providerRef: charge.id },
      ].filter((c) => Object.keys(c).length > 0),
    },
    select: { id: true, orderId: true, amount: true },
  });
  if (!payment) {
    console.warn(`[stripe webhook] charge.refunded but no matching payment found (charge=${charge.id})`);
    return;
  }

  const refundedTotal = charge.amount_refunded; // cumulative on the charge
  const fullyRefunded = refundedTotal >= payment.amount;

  // Mark the payment status. Idempotent — same event may fire twice.
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
      refundedAmount: refundedTotal,
      updatedAt: new Date(),
    },
  });

  console.log(
    `[stripe webhook] refund applied payment=${payment.id} refundedTotal=${refundedTotal} fully=${fullyRefunded}`
  );
}
