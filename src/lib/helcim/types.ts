// ============================================================================
// Helcim integration — types.
//
// 2026-10-09: BYO per-tenant Helcim account. Credentials shape stored
// (encrypted) in TenantPaymentProvider.credentialsEnc when
// processor = HELCIM. Mirrors the StripeCredentials pattern.
// ============================================================================

/**
 * Per-tenant Helcim credentials.
 *
 * - `apiToken`       — Helcim portal → Settings → API Access. Server-side
 *                      only, used to sign REST calls (initialize session,
 *                      refunds).
 * - `webhookVerifier`— HMAC key auto-generated when the webhook is created
 *                      in Settings → Integrations → Webhooks. Used to verify
 *                      inbound webhook signatures.
 * - `accountName`    — Human label shown in admin ("Synergy Data Labs 893").
 * - `environment`    — "test" or "live". Drives the base URL + lets us
 *                      show the right mode badge.
 */
export interface HelcimCredentials {
  apiToken: string;
  webhookVerifier: string;
  accountName?: string;
  environment: "test" | "live";
}

/**
 * HelcimPay.js initialize-session response. We ask Helcim to mint a
 * checkout token on the server, then hand that token to the browser.
 * The browser loads HelcimPay.js and calls appendHelcimPayIframe(token).
 */
export interface HelcimPayInitializeResponse {
  checkoutToken: string;
  secretToken: string;
}

/**
 * Narrowed subset of the webhook payload we actually read.
 * Helcim's full payload is richer; we don't type what we ignore.
 */
export interface HelcimWebhookEvent {
  id: string; // event id
  type: string; // "cardTransaction", "transactionSuccess", "transactionRefunded", "transactionFailed"
  data?: {
    transactionId?: string | number;
    invoiceNumber?: string;
    customerCode?: string;
    amount?: string | number;
    currency?: string;
    status?: string;
  };
}
