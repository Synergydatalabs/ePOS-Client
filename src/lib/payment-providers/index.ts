// Payment provider abstraction.
//
// Every processor (GP / Moneris / Stripe / …) implements the same tiny
// interface so the PO-create endpoint doesn't have to care WHICH provider
// is active for a given supplier — it just asks for a payment link and
// stores whatever URL + reference come back.
//
// Real GP integration lives in gp-provider.ts. Until it's actually
// wired to GP's Hosted Payment Page API, the exported `getProvider()`
// returns the mock provider for every processor so the whole PO flow
// works end-to-end. Swap the return value inside getProvider() when GP
// (or Moneris, or Stripe) is ready.

import type { PaymentProcessor } from "@prisma/client";
import { MockProvider } from "./mock-provider";
import { GpProvider } from "./gp-provider";
import { MonerisCheckoutProvider } from "./moneris-checkout-provider";

// --- Types shared by every provider ------------------------------------

export interface CreatePaymentLinkParams {
  /** PO id — used as our idempotency handle */
  purchaseOrderId: string;
  /** Human-readable PO number, shown on the checkout page */
  poNumber: string;
  /** Amount in the currency's smallest unit (cents) */
  amountCents: number;
  /** ISO currency code, e.g. "CAD" */
  currency: string;
  /** Optional short description shown to the payer */
  description?: string;
  /** Payer email — pre-fills the checkout form when available */
  payerEmail?: string;
  /**
   * URL the processor sends the payer back to after payment. The
   * merchant-side PO detail page is the natural destination.
   */
  returnUrl: string;
  /**
   * Where processor webhooks should POST. Same for every PO on this
   * provider — we route to the PO from the reference id in the body.
   */
  webhookUrl: string;
  /**
   * Decrypted per-supplier credentials (shape depends on processor):
   *   GP:      { app_id, app_key, account_name? }
   *   MONERIS: { store_id, api_token }
   *   STRIPE:  { access_token, stripe_user_id? }
   */
  credentials: Record<string, unknown>;
  /** Supplier's processor MID / store id / account id */
  externalMid: string;
}

export interface CreatePaymentLinkResult {
  /** Hosted checkout URL to share with the merchant */
  url: string;
  /**
   * Processor's own transaction / order id. We store this on the PO so
   * incoming webhooks can find the right PO row (see #68).
   */
  reference: string;
  /** When the URL stops being valid */
  expiresAt: Date;
}

export interface PaymentProviderClient {
  readonly processor: PaymentProcessor;
  createPaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult>;
}

// --- Factory ------------------------------------------------------------

/**
 * Returns the provider implementation for a given processor code.
 *
 * MVP: returns a MockProvider for every processor. Behavior is identical
 * to the real thing (creates a link, returns a reference + expiry) but
 * the link points at a platform-hosted mock checkout page rather than a
 * processor-hosted one. Merchant can still "pay" on the mock page and
 * exercise the webhook path.
 *
 * When each real provider is ready, uncomment its branch below.
 */
export function getProvider(processor: PaymentProcessor): PaymentProviderClient {
  switch (processor) {
    case "GP":
      return new GpProvider();
    case "MONERIS":
      return new MonerisCheckoutProvider();
    // case "STRIPE":
    //   return new StripeProvider();   // future
    default:
      return new MockProvider(processor);
  }
}

// Re-export for callers that want direct access to a specific impl
// (unit tests, admin tooling, etc.). Prefer `getProvider(code)` in
// application code.
export { MockProvider } from "./mock-provider";
export { GpProvider } from "./gp-provider";
