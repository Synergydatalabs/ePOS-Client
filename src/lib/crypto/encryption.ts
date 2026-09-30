// ============================================================================
// src/lib/crypto/encryption.ts
// AES-256-GCM symmetric encryption for storing sensitive tenant credentials
// (Meta access tokens, app secrets, webhook verify tokens).
//
// Storage format (single string column):
//   v1.<iv-base64>.<authTag-base64>.<ciphertext-base64>
//
// Versioned so we can rotate algorithm/key later without breaking existing
// rows. Parsers reject any unknown version.
//
// Master key: env var META_CREDENTIAL_ENC_KEY must be a base64-encoded
// 32-byte random value. Generate once for prod with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Then set in .env.production and rotate via re-encrypt migration.
// ============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32; // 256-bit
const IV_BYTES = 12;  // GCM standard
const FORMAT_VERSION = "v1";

let cachedKey: Buffer | null = null;

/**
 * Returns the 32-byte master key as a Buffer. Throws if the env var is
 * missing or malformed (in prod). In dev, falls back to a stable
 * derived key with a loud warning so the app still boots without
 * crashing tests that don't touch encryption.
 */
function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.META_CREDENTIAL_ENC_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "META_CREDENTIAL_ENC_KEY is not set. Generate with: " +
          "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
      );
    }
    // Dev fallback — stable so encrypted rows survive across restarts,
    // but obviously NOT secure. Big console warning each boot.
    console.warn(
      "⚠️  META_CREDENTIAL_ENC_KEY not set — using dev fallback key. " +
        "DO NOT use in production. Encrypted rows will only be readable " +
        "with this same fallback key."
    );
    cachedKey = Buffer.from(
      "ZGV2LWZhbGxiYWNrLWtleS1ub3Qtc2VjdXJlLTAxMjM0NTY3OA==",
      "base64"
    ).subarray(0, KEY_BYTES);
    return cachedKey;
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new Error("META_CREDENTIAL_ENC_KEY is not valid base64.");
  }
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `META_CREDENTIAL_ENC_KEY must decode to exactly ${KEY_BYTES} bytes; got ${buf.length}.`
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * Encrypts a UTF-8 string. Returns a single self-describing token:
 *   v1.<iv>.<authTag>.<ciphertext>   (all base64)
 *
 * Safe for direct storage in a TEXT column. Pass null/empty through unchanged
 * (so we don't accidentally store an "encrypted empty string" sentinel).
 */
export function encryptString(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Decrypts a token produced by encryptString. Throws on any tampering,
 * unknown version, or wrong key. Pass null/empty through unchanged.
 */
export function decryptString(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) {
    throw new Error("Encrypted token is malformed (expected 4 parts).");
  }
  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported encrypted token version: ${version}`);
  }
  const key = getMasterKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Detects whether a stored value is already encrypted (vs. a legacy
 * plaintext from before encryption was rolled out). Useful for one-shot
 * migration scripts.
 */
export function isEncryptedToken(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  return parts.length === 4 && parts[0] === FORMAT_VERSION;
}

/**
 * Returns a masked preview of a secret for safe display in admin UIs
 * (e.g., "EAAB...x9k2", "twil...4eaf"). NEVER pass a decrypted token
 * back to the browser in full — show this instead.
 */
export function maskSecret(value: string | null | undefined, keep = 4): string {
  if (!value) return "";
  if (value.length <= keep * 2) return "•".repeat(value.length);
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
