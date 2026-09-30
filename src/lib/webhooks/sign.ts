// Phase I #5 (2026-09-14): HMAC signing for outbound webhooks.
//
// Stripe-style scheme: `X-Payment-Signature: t=<unix_timestamp>,v1=<hmac_sha256>`.
// The signed payload is `<timestamp>.<request_body>` so a captured
// request can't be replayed at a different time without the signature
// mismatching. Partners verify:
//
//   const [t, v1] = parseSigHeader(req.headers['x-payment-signature']);
//   const expected = HMAC_SHA256(secret, `${t}.${req.rawBody}`);
//   assert(timingSafeEqual(v1, expected));
//   assert(now() - t < 300);  // reject old replays
//
// Rotating a secret is safe: the partner keeps accepting both old and
// new for a rollover window (they call us on rotation, we advise
// double-verify for 24h). Not automated for v1 — Regenerate button
// just replaces the row and the partner re-syncs.

import { createHmac, randomBytes } from "crypto";

export interface WebhookSignature {
  header: string;      // full `X-Payment-Signature` value
  timestamp: number;   // unix seconds — for logging + debugging
}

/**
 * Sign a rendered webhook body with the endpoint's HMAC secret.
 * Returns the fully-formed header value the partner will verify.
 */
export function signWebhook(secret: string, body: string): WebhookSignature {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${timestamp}.${body}`;
  const v1 = createHmac("sha256", secret).update(payload).digest("hex");
  return {
    header: `t=${timestamp},v1=${v1}`,
    timestamp,
  };
}

/**
 * Cryptographically strong 32-byte secret, base64url-encoded, prefixed
 * so it's identifiable in logs. `whsec_` matches Stripe's convention —
 * partners are already used to spotting it. ~43 chars after the prefix.
 */
export function generateWebhookSecret(): string {
  const raw = randomBytes(32).toString("base64url");
  return `whsec_${raw}`;
}
