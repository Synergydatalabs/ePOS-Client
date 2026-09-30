// ============================================================================
// Stripe integration — types.
//
// Credentials shape matches what we store (encrypted) in
// TenantPaymentProvider.credentialsEnc when processor = STRIPE. If the
// shape changes, update the tapapp-admin credential-validation schema
// (Moneris 1a pattern) to keep the two apps in sync.
// ============================================================================

/**
 * Per-tenant Stripe credentials. BYO model — merchant provides their own
 * account keys via tapapp-admin (or direct SQL until admin UI ships).
 *
 * - `secretKey`         — sk_live_… (or sk_test_… in sandbox). Server-side only.
 * - `publishableKey`    — pk_live_… . Safe to hand to the client if we ever
 *                        need Elements/Payment Element on our own pages.
 * - `webhookSecret`     — whsec_… . Used to verify inbound webhook signatures.
 * - `accountName`       — optional label to show in admin ("Cafe X — Prod").
 */
export interface StripeCredentials {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  accountName?: string;
}

/**
 * Narrowed subset of the Stripe Checkout Session we actually consume.
 * The SDK returns a much richer object — we intentionally don't type
 * the fields we don't read, so a Stripe field addition doesn't force
 * a rebuild.
 */
export interface StripeCheckoutSessionResult {
  /** cs_test_… or cs_live_… */
  id: string;
  /** Hosted checkout URL to hand to the customer. */
  url: string;
  /** Order id we passed in — echoed back for correlation. */
  orderId: string;
  /** ISO expiry timestamp. Stripe defaults to 24h. */
  expiresAt: string;
}

export interface StripeRefundResult {
  id: string;
  /** In minor units (cents). */
  amount: number;
  status: string; // succeeded | pending | failed | canceled | requires_action
  currency: string;
  chargeId: string;
}

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

export class StripeApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}
