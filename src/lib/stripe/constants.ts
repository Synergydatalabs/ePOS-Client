// ============================================================================
// Stripe integration — constants.
//
// Pin the API version so a mid-day Stripe SDK bump doesn't silently change
// our request/response shape. Update deliberately.
// ============================================================================

/**
 * Pinned Stripe API version. When we upgrade the `stripe` npm package
 * to a newer major, bump this AFTER verifying our webhook handlers and
 * checkout session shapes still parse.
 */
export const STRIPE_API_VERSION = "2024-06-20" as const;

/** Webhook events we care about (merchant-side flow). */
export const STRIPE_EVENTS = {
  CHECKOUT_COMPLETED: "checkout.session.completed",
  PAYMENT_FAILED: "payment_intent.payment_failed",
  CHARGE_REFUNDED: "charge.refunded",
} as const;

/** Human-readable processor label surfaced on receipts + DSR. */
export const STRIPE_PROVIDER_LABEL = "Stripe";
