// ============================================================================
// Helcim integration — constants.
// ============================================================================

/**
 * Helcim's REST API lives at a single production host; the "test mode"
 * toggle is set on each HelcimPay.js config in the portal, so the SAME
 * host serves both. We still carry an environment flag per credential
 * so our UI can show the mode badge and prevent accidental live tests.
 */
export const HELCIM_API_BASE = "https://api.helcim.com/v2";

/**
 * HelcimPay.js SDK — loaded from Helcim's CDN into the browser.
 * This script registers `window.appendHelcimPayIframe(checkoutToken)`
 * which opens the hosted payment modal.
 */
export const HELCIM_PAY_SCRIPT_URL = "https://secure.helcim.app/helcim-pay/services/start.js";

/**
 * Event types we handle from inbound webhooks. Keep this list in sync
 * with the webhook config in the Helcim portal.
 */
export const HELCIM_WEBHOOK_EVENTS = [
  "transactionSuccess",
  "transactionFailed",
  "transactionRefunded",
] as const;

export type HelcimWebhookEventType = (typeof HELCIM_WEBHOOK_EVENTS)[number];
