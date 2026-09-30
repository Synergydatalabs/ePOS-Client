// ============================================
// UCI — Webhook signature verification
// HMAC-SHA256 of raw body with the webhook secret
// Signature carried in a header TBD (commonly X-GP-Signature).
// ============================================

import crypto from "crypto";
import { getUciConfig } from "./constants";

/**
 * Verify an incoming UCI webhook signature.
 *
 * @param rawBody - The *raw* request body (as received, before JSON.parse)
 * @param signatureHeader - Value of the signature header (e.g. X-GP-Signature)
 * @returns true if signature matches, false otherwise
 */
export function verifyUciWebhook(rawBody: string, signatureHeader: string | null): boolean {
  const { webhookSecret } = getUciConfig();

  if (!webhookSecret) {
    console.warn("[UCI WEBHOOK] GLOBALPAY_UCI_WEBHOOK_SECRET is not set — rejecting webhook");
    return false;
  }
  if (!signatureHeader) {
    console.warn("[UCI WEBHOOK] No signature header provided");
    return false;
  }

  // Strip common prefixes like "sha256=" if GP uses that convention
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");

  // Constant-time comparison to avoid timing attacks
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
