// Encrypts OAuth tokens at rest so a DB dump alone can't be used to
// impersonate our merchants against QBO / Xero / etc.
//
// AES-256-GCM with a random 12-byte IV per record. Ciphertext format:
//   base64( iv || authTag || ciphertext )
//
// Key comes from env INTEGRATION_ENC_KEY as a hex string (64 chars =
// 32 bytes). On dev without a key set, we deliberately fall back to a
// static placeholder so schema tests work — this is logged loudly and
// MUST NEVER be used in production.

import crypto from "crypto";

const DEV_FALLBACK_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_ENC_KEY || "";
  if (hex.length !== 64) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "INTEGRATION_ENC_KEY must be set to a 64-char hex string in production"
      );
    }
    // Dev-only fallback — warn on every call so it never sneaks into a
    // deployed build without notice.
    // eslint-disable-next-line no-console
    console.warn(
      "[integration-crypto] Using DEV fallback key — set INTEGRATION_ENC_KEY for production"
    );
    return Buffer.from(DEV_FALLBACK_KEY, "hex");
  }
  return Buffer.from(hex, "hex");
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptToken(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  try {
    const raw = Buffer.from(ciphertext, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const key = getKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  } catch (e) {
    console.error("[integration-crypto] Failed to decrypt token:", e);
    return null;
  }
}
