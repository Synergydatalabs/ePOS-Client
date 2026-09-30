// ============================================================================
// Stripe client wrapper.
//
// A single place that builds a per-tenant Stripe SDK instance from decrypted
// credentials, and exposes the three operations we need for BYO Stripe:
//   • createCheckoutSession — hosted checkout URL for an order (customer pays)
//   • createRefund          — refund a completed charge
//   • verifyWebhookEvent    — validate signature + parse an inbound webhook body
//
// One SDK instance per (secretKey, tenantId) is cheap — Stripe SDK is
// stateless per-instance and holds no persistent connections. We build a
// new instance per request to avoid credential leakage across tenants.
// ============================================================================

import Stripe from "stripe";
import {
  STRIPE_API_VERSION,
  STRIPE_PROVIDER_LABEL,
} from "./constants";
import {
  StripeApiError,
  StripeConfigError,
  type StripeCheckoutSessionResult,
  type StripeCredentials,
  type StripeRefundResult,
} from "./types";

/**
 * Build a Stripe SDK instance from a tenant's decrypted credentials.
 * Throws StripeConfigError if the secretKey is missing / malformed —
 * callers should surface a "processor misconfigured" error to the operator
 * rather than swallow the exception.
 */
export function buildStripeClient(credentials: StripeCredentials): Stripe {
  const key = credentials.secretKey;
  // Accept both standard secret keys (sk_…) and restricted keys (rk_…).
  // Restricted keys are the recommended way to scope a leaked-key blast
  // radius — a supplier who provisions `rk_test_…` with only Checkout
  // Sessions Write + Payment Intents Read + Refunds Write can plug it in
  // without granting us full account access.
  if (!key || !(key.startsWith("sk_") || key.startsWith("rk_"))) {
    throw new StripeConfigError(
      "Stripe secretKey is missing or malformed — expected sk_live_… / sk_test_… / rk_live_… / rk_test_…"
    );
  }
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    // Nice to have in logs — tells Stripe which client made the call.
    appInfo: {
      name: "iTap POS",
      version: "1.0.0",
    },
  });
}

// ---------------------------------------------------------------------------
// Checkout Session — Stripe-hosted pay page
// ---------------------------------------------------------------------------

export interface CreateCheckoutSessionInput {
  credentials: StripeCredentials;
  /** Our order id — round-tripped in metadata for webhook correlation. */
  orderId: string;
  /** Amount in the currency's minor unit (cents). */
  amountCents: number;
  /** ISO currency code — lowercase per Stripe convention ("cad"). */
  currency: string;
  /** Optional order display number ("#127") for the checkout page title. */
  orderNumber?: string | number | null;
  /** Optional customer email to pre-fill on the Stripe form. */
  customerEmail?: string | null;
  /** URL Stripe redirects to on successful payment. */
  successUrl: string;
  /** URL Stripe redirects to on customer cancel. */
  cancelUrl: string;
  /** Optional metadata — merged with our defaults. */
  extraMetadata?: Record<string, string>;
}

/**
 * Create a Stripe Checkout Session for a POS/e-commerce order. Returns the
 * hosted URL to hand to the customer.
 *
 * Stripe Checkout automatically supports card, Apple Pay, and Google Pay
 * depending on merchant's Stripe Dashboard settings — no extra code needed
 * on our side. Digital wallets show when the customer's device supports
 * them.
 */
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<StripeCheckoutSessionResult> {
  const stripe = buildStripeClient(input.credentials);

  const productName = input.orderNumber
    ? `Order #${input.orderNumber}`
    : `Order ${input.orderId.slice(0, 8)}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"], // Stripe auto-enables wallets on top
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            product_data: {
              name: productName,
              description: input.orderNumber
                ? `${STRIPE_PROVIDER_LABEL} payment for Order #${input.orderNumber}`
                : undefined,
            },
            unit_amount: input.amountCents,
          },
          quantity: 1,
        },
      ],
      customer_email: input.customerEmail || undefined,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // Metadata is echoed on the webhook body — this is how we correlate
      // the paid session back to our order row without needing to store the
      // session id on the order.
      metadata: {
        orderId: input.orderId,
        ...(input.extraMetadata ?? {}),
      },
      // Store metadata on the PaymentIntent too so refund webhooks (which
      // arrive on the charge, not the checkout session) can also find us.
      payment_intent_data: {
        metadata: {
          orderId: input.orderId,
          ...(input.extraMetadata ?? {}),
        },
      },
    });

    if (!session.url) {
      throw new StripeApiError(
        "Stripe returned a session with no URL — check account activation.",
        "no_session_url",
        session
      );
    }

    return {
      id: session.id,
      url: session.url,
      orderId: input.orderId,
      expiresAt: new Date((session.expires_at ?? 0) * 1000).toISOString(),
    };
  } catch (err) {
    if (err instanceof StripeApiError || err instanceof StripeConfigError) throw err;
    const message =
      err instanceof Error ? err.message : "Unknown Stripe error";
    const code =
      (err as { code?: string })?.code ??
      (err as { type?: string })?.type ??
      "checkout_session_failed";
    throw new StripeApiError(message, code, err);
  }
}

// ---------------------------------------------------------------------------
// Payment Intent — embedded Elements checkout (Phase I #2a, 2026-09-08)
//
// createCheckoutSession above returns a Stripe-hosted URL and redirects the
// customer to stripe.com. createPaymentIntent below is the ELEMENTS flow —
// the customer stays on hub.synergydatalabs.com the whole time; card
// entry is a Stripe iframe embedded on our page.
//
// PCI compliance model is identical: card data never touches our server;
// the iframe posts directly to Stripe. We stay at PCI SAQ-A either way.
// ---------------------------------------------------------------------------

export interface CreatePaymentIntentInput {
  credentials: StripeCredentials;
  /** Our order/invoice id — round-tripped in metadata for webhook correlation. */
  orderId: string;
  /** Amount in the currency's minor unit (cents). */
  amountCents: number;
  /** ISO currency code — lowercase per Stripe convention ("cad"). */
  currency: string;
  /** Optional customer email for the receipt. */
  customerEmail?: string | null;
  /** Optional description shown in the Stripe dashboard. */
  description?: string;
  /** Optional metadata — merged with our defaults (orderId always added). */
  extraMetadata?: Record<string, string>;
  /**
   * When false, we do NOT set receipt_email on the PaymentIntent. Stripe
   * only sends its own receipt email when this field is populated (plus
   * dashboard opt-in), so leaving it null suppresses Stripe receipts.
   * Defaults to true. API-created invoices pass false so the partner
   * can send their own transactional email.
   */
  sendReceipt?: boolean;
}

export interface StripePaymentIntentResult {
  /** pi_… */
  id: string;
  /** client_secret to hand to the browser for Elements.confirm. */
  clientSecret: string;
  /** Publishable key echoed so the client doesn't need a separate call. */
  publishableKey: string;
  /** Order id we passed in — echoed for correlation. */
  orderId: string;
}

export async function createPaymentIntent(
  input: CreatePaymentIntentInput
): Promise<StripePaymentIntentResult> {
  const stripe = buildStripeClient(input.credentials);

  try {
    const sendReceipt = input.sendReceipt !== false; // default true
    const intent = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      // automatic_payment_methods enables card + Apple Pay + Google Pay +
      // Link automatically per the merchant's Stripe Dashboard config —
      // same one-liner used by Stripe's official Elements docs.
      automatic_payment_methods: { enabled: true },
      // Phase I #9 (2026-09-19): only set receipt_email when the caller
      // wants Stripe to send its own receipt. API-created invoices set
      // sendReceipt=false so the partner controls transactional email.
      receipt_email: sendReceipt ? input.customerEmail || undefined : undefined,
      description: input.description,
      // Metadata is echoed on every webhook body for this intent — this is
      // how the webhook route correlates the paid intent back to our
      // invoice row without needing to store the intent id up-front.
      metadata: {
        orderId: input.orderId,
        ...(input.extraMetadata ?? {}),
      },
    });

    if (!intent.client_secret) {
      throw new StripeApiError(
        "Stripe returned a PaymentIntent with no client_secret — cannot render Elements.",
        "no_client_secret",
        intent
      );
    }

    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      publishableKey: input.credentials.publishableKey,
      orderId: input.orderId,
    };
  } catch (err) {
    if (err instanceof StripeApiError || err instanceof StripeConfigError) throw err;
    const message = err instanceof Error ? err.message : "Unknown Stripe error";
    const code =
      (err as { code?: string })?.code ??
      (err as { type?: string })?.type ??
      "payment_intent_failed";
    throw new StripeApiError(message, code, err);
  }
}

// ---------------------------------------------------------------------------
// Phase I #11 (2026-09-19) — Server-side confirm with a browser-tokenized
// payment method. Used by the tokenized-forward Payments API pattern:
// partner's frontend uses Stripe.js to tokenize the card (browser →
// Stripe direct), forwards the pm_… token through their server to us,
// and we confirm on the tenant's Stripe with server_side_confirmation.
//
// Returns the confirmed PaymentIntent so the caller can distinguish
// succeeded / requires_action (3DS) / failed synchronously without
// waiting for a webhook round-trip.
// ---------------------------------------------------------------------------

export interface ChargeWithTokenInput {
  credentials: StripeCredentials;
  orderId: string;
  amountCents: number;
  currency: string;
  paymentMethodId: string;      // pm_… from stripe.createPaymentMethod on browser
  customerEmail?: string | null;
  description?: string;
  extraMetadata?: Record<string, string>;
  /**
   * URL Stripe redirects the customer to after a 3DS challenge. When
   * omitted we set `automatic_payment_methods: { enabled: true, allow_redirects: 'never' }`
   * which lets Stripe reject payment methods that would require redirect.
   * Card + Apple Pay + Google Pay + 3DS-via-modal work either way.
   */
  returnUrl?: string;
  sendReceipt?: boolean;
}

export interface ChargeWithTokenResult {
  id: string;                          // pi_…
  status: "succeeded" | "requires_action" | "requires_payment_method" | "processing" | "canceled" | string;
  clientSecret: string | null;
  publishableKey: string;
  amountReceivedCents: number;         // may differ from requested on partial capture
  failureCode: string | null;
  failureMessage: string | null;
}

export async function chargeWithToken(
  input: ChargeWithTokenInput
): Promise<ChargeWithTokenResult> {
  const stripe = buildStripeClient(input.credentials);
  const sendReceipt = input.sendReceipt !== false;
  try {
    const intent = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      payment_method: input.paymentMethodId,
      confirm: true,
      // `off_session: false` = customer is present (an on-session
      // transaction). Lets Stripe handle 3DS via modal in the browser.
      off_session: false,
      // If no return_url, disable redirect-only payment methods so we
      // stay synchronous. With return_url set we allow them.
      ...(input.returnUrl
        ? { return_url: input.returnUrl }
        : { automatic_payment_methods: { enabled: true, allow_redirects: "never" as const } }),
      receipt_email: sendReceipt ? input.customerEmail || undefined : undefined,
      description: input.description,
      metadata: {
        orderId: input.orderId,
        ...(input.extraMetadata ?? {}),
      },
    });

    return {
      id: intent.id,
      status: intent.status,
      clientSecret: intent.client_secret,
      publishableKey: input.credentials.publishableKey,
      amountReceivedCents: intent.amount_received ?? 0,
      failureCode: intent.last_payment_error?.code ?? null,
      failureMessage: intent.last_payment_error?.message ?? null,
    };
  } catch (err) {
    // Stripe throws for hard failures (declined, invalid pm, etc). Map
    // the error into a soft failure result so the endpoint can return
    // 200 with { status: "requires_payment_method", failure_message } —
    // downstream partner code stays simple.
    if (err instanceof StripeApiError || err instanceof StripeConfigError) throw err;
    const anyErr = err as {
      code?: string;
      message?: string;
      raw?: { payment_intent?: { id?: string; status?: string; client_secret?: string | null } };
      payment_intent?: { id?: string; status?: string; client_secret?: string | null };
    };
    const pi = anyErr.payment_intent || anyErr.raw?.payment_intent;
    return {
      id: pi?.id ?? "",
      status: pi?.status ?? "requires_payment_method",
      clientSecret: pi?.client_secret ?? null,
      publishableKey: input.credentials.publishableKey,
      amountReceivedCents: 0,
      failureCode: anyErr.code ?? "charge_failed",
      failureMessage: anyErr.message ?? "Card could not be charged",
    };
  }
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

export interface CreateRefundInput {
  credentials: StripeCredentials;
  /** Either a Charge id (ch_…) or a PaymentIntent id (pi_…) — Stripe accepts both. */
  chargeOrIntentId: string;
  /** Refund amount in cents. Omit for a full refund. */
  amountCents?: number;
  reason?: "requested_by_customer" | "duplicate" | "fraudulent";
  /** Optional metadata — echoed on the charge.refunded webhook. */
  metadata?: Record<string, string>;
}

export async function createRefund(
  input: CreateRefundInput
): Promise<StripeRefundResult> {
  const stripe = buildStripeClient(input.credentials);

  const params: Stripe.RefundCreateParams = {
    reason: input.reason ?? "requested_by_customer",
    metadata: input.metadata,
  };
  if (input.amountCents !== undefined && input.amountCents > 0) {
    params.amount = input.amountCents;
  }
  // Stripe accepts either — pass whichever we have.
  if (input.chargeOrIntentId.startsWith("ch_")) {
    params.charge = input.chargeOrIntentId;
  } else {
    params.payment_intent = input.chargeOrIntentId;
  }

  try {
    const refund = await stripe.refunds.create(params);
    return {
      id: refund.id,
      amount: refund.amount,
      status: refund.status ?? "unknown",
      currency: refund.currency,
      chargeId: typeof refund.charge === "string" ? refund.charge : refund.charge?.id ?? "",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error";
    const code =
      (err as { code?: string })?.code ??
      (err as { type?: string })?.type ??
      "refund_failed";
    throw new StripeApiError(message, code, err);
  }
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * Verify a raw webhook body against the tenant's Stripe signing secret.
 * Returns the parsed Stripe.Event on success — callers switch on event.type.
 *
 * IMPORTANT: pass the RAW request body (Buffer or string), not JSON.parse'd.
 * Stripe recomputes the HMAC over the exact bytes and it will fail if the
 * body was re-serialized.
 */
export function verifyWebhookEvent(args: {
  rawBody: string | Buffer;
  signatureHeader: string;
  webhookSecret: string;
}): Stripe.Event {
  if (!args.webhookSecret) {
    throw new StripeConfigError("Missing webhookSecret for signature verification");
  }
  // constructEvent doesn't need an api key — it's a pure crypto check.
  const stripe = new Stripe("sk_verify_only_placeholder", {
    apiVersion: STRIPE_API_VERSION,
  });
  try {
    return stripe.webhooks.constructEvent(
      args.rawBody,
      args.signatureHeader,
      args.webhookSecret
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signature verification failed";
    throw new StripeApiError(message, "invalid_signature", err);
  }
}
