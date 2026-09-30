// HMAC-SHA256 signature verification for processor webhooks.
//
// Every real processor (GP, Moneris, Stripe, …) signs its outbound
// webhooks so we can prove the payload came from them and hasn't been
// tampered with. Without verification, ANYONE who guesses a PO id +
// reference could POST a fake "payment succeeded" event and mark the
// PO paid. This helper prevents that.
//
// Constant-time comparison via `timingSafeEqual` to defeat timing attacks
// (attacker learns nothing from how quickly we reject a bad signature).

import { createHmac, timingSafeEqual } from "crypto";

export type SignatureAlgorithm = "sha256" | "sha512";

/**
 * Verifies that `computedSignature(rawBody, secret)` matches the
 * signature the processor sent. Returns true on a match.
 *
 * `providedSignature` accepts either the raw hex/base64 hash OR a
 * "prefixed" form like "sha256=abc123..." — some processors send the
 * algorithm name as a prefix. We strip common prefixes automatically.
 */
export function verifyHmacSignature(params: {
  rawBody: string | Buffer;
  secret: string;
  providedSignature: string | null | undefined;
  algorithm?: SignatureAlgorithm;
  encoding?: "hex" | "base64";
}): boolean {
  const {
    rawBody,
    secret,
    providedSignature,
    algorithm = "sha256",
    encoding = "hex",
  } = params;

  if (!providedSignature || !secret) return false;

  // Normalize the provided signature — strip "sha256=" / "sha512=" / "hmac="
  // prefixes if present. Different processors format the header differently.
  const cleaned = String(providedSignature)
    .trim()
    .replace(/^(sha256|sha512|hmac)=/i, "");

  if (!cleaned) return false;

  const bodyBuf =
    typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const computed = createHmac(algorithm, secret).update(bodyBuf).digest(encoding);

  // Both buffers must be the same length for timingSafeEqual — different
  // lengths mean the signatures can't match anyway, so return false without
  // running the comparison (avoids a throw from timingSafeEqual).
  const providedBuf = Buffer.from(cleaned, encoding);
  const computedBuf = Buffer.from(computed, encoding);
  if (providedBuf.length !== computedBuf.length) return false;

  return timingSafeEqual(providedBuf, computedBuf);
}
