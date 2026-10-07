// Paddle webhook signature verification.
//
// Paddle sends the `Paddle-Signature` header in the form:
//   ts=<unix_seconds>;h1=<hex_hmac_sha256>
//
// The signed payload is `<ts>:<raw_body>`. We recompute HMAC-SHA256
// with PADDLE_WEBHOOK_SECRET and compare in constant time.
//
// Reject when:
//   - header is missing or malformed
//   - timestamp is more than 5 minutes old (replay guard)
//   - HMAC mismatch
//
// The caller MUST pass the raw request body, not JSON.parse'd — the
// signature is over the exact bytes Paddle sent.

import crypto from "crypto";
import { getPaddleConfig } from "./constants";

export interface PaddleWebhookVerifyResult {
  ok: boolean;
  reason?: string;
}

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

export function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null
): PaddleWebhookVerifyResult {
  const config = getPaddleConfig();
  if (!config.webhookSecret) {
    return { ok: false, reason: "PADDLE_WEBHOOK_SECRET not set" };
  }
  if (!signatureHeader) {
    return { ok: false, reason: "missing Paddle-Signature header" };
  }

  // Parse "ts=123;h1=abc" into a plain map.
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((p) => {
      const idx = p.indexOf("=");
      return idx === -1 ? [p, ""] : [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
    })
  );

  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) {
    return { ok: false, reason: "malformed signature header" };
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: "non-numeric timestamp" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > MAX_SIGNATURE_AGE_SECONDS) {
    return { ok: false, reason: "signature too old (replay guard)" };
  }

  const expected = crypto
    .createHmac("sha256", config.webhookSecret)
    .update(`${ts}:${rawBody}`, "utf8")
    .digest("hex");

  // timingSafeEqual throws on length mismatch — guard first.
  if (expected.length !== h1.length) {
    return { ok: false, reason: "signature length mismatch" };
  }
  const ok = crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(h1, "utf8")
  );
  return ok ? { ok: true } : { ok: false, reason: "HMAC mismatch" };
}
