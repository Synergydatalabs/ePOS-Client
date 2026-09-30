// POST /api/tenants/[tenantId]/payments/stripe/checkout-session
//
// Create a Stripe Checkout Session for an order. Returns the hosted
// checkout URL the operator hands to the customer (via SMS / email / QR /
// on-screen QR). Customer opens it → pays on Stripe → webhook fires →
// order marked paid.
//
// Body: { orderId }
//
// Response: { success, url, sessionId, expiresAt, orderId }
//
// Auth: caller must belong to the tenantId in the URL. The
// getActiveProvider lookup ensures the tenant actually has a STRIPE
// provider configured under the CARD capability.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";
import {
  createCheckoutSession,
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
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // Verify caller belongs to this tenant.
  const membership = await prisma.tenantMembership.findFirst({
    where: { userId: session.user.id, tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load the order + its tenant + currency.
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      location: { tenantId },
    },
    select: {
      id: true,
      displayNumber: true,
      orderNumber: true,
      total: true,
      currency: true,
      paymentStatus: true,
      customerEmail: true,
      payments: {
        where: { status: "COMPLETED" },
        select: { amount: true },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const alreadyPaid = order.payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, order.total - alreadyPaid);
  if (outstanding <= 0) {
    return NextResponse.json(
      { error: "Order is already fully paid" },
      { status: 400 }
    );
  }

  // Resolve Stripe provider for this tenant. Stripe hosted checkout is
  // an ECOMMERCE-capability integration (distinct from CARD which is
  // card-present via a paired terminal). This means a tenant can run
  // GP terminal on CARD AND Stripe link on ECOMMERCE simultaneously.
  const provider = await getActiveProvider({ tenantId, capability: "ECOMMERCE" });
  if (!provider || provider.processor !== "STRIPE") {
    return NextResponse.json(
      {
        error: "Stripe is not configured for this tenant.",
        code: "STRIPE_NOT_CONFIGURED",
      },
      { status: 400 }
    );
  }
  const credentials = provider.credentials as unknown as StripeCredentials;

  // Build return URLs — Stripe redirects the customer back to us after pay.
  const origin =
    request.headers.get("origin") ||
    (request.headers.get("host") ? `https://${request.headers.get("host")}` : "") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "";
  const successUrl = `${origin}/pay/order/${order.id}?stripe=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/pay/order/${order.id}?stripe=cancel`;

  try {
    const result = await createCheckoutSession({
      credentials,
      orderId: order.id,
      amountCents: outstanding,
      currency: order.currency,
      orderNumber: order.displayNumber ?? order.orderNumber,
      customerEmail: order.customerEmail,
      successUrl,
      cancelUrl,
      extraMetadata: {
        tenantId,
      },
    });
    return NextResponse.json({
      success: true,
      url: result.url,
      sessionId: result.id,
      expiresAt: result.expiresAt,
      orderId: order.id,
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
      { error: (err as Error)?.message ?? "Checkout session failed" },
      { status: 500 }
    );
  }
}
