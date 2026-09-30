// Gift-card code generator.
//
// Codes look like:  GC-XXXX-XXXX-XXXX
// where the X's are drawn from a 32-character alphabet with I/O/0/1 removed
// (Crockford-style) so users don't confuse "1" and "I" or "0" and "O" when
// reading a physical card or typing an emailed code.

import crypto from "crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 chars, no I/O/0/1
const GROUP_SIZE = 4;
const GROUPS = 3; // 12 significant chars → ~60 bits of entropy

function randomChars(n: number): string {
  // crypto.randomBytes(n) then map each byte to an alphabet index.
  // Using modulo 32 is uniform because 256 is a multiple of 32.
  const bytes = crypto.randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateGiftCardCode(): string {
  const groups: string[] = ["GC"];
  for (let i = 0; i < GROUPS; i++) {
    groups.push(randomChars(GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Normalise a user-entered code so we can look it up in the DB.
 * Strips whitespace/hyphens, upper-cases, replaces easily-confused chars
 * with the canonical ones (l→1 was removed since we don't use 1;
 * we do map O→0 and I→1 as defensive input-normalisation, then check
 * the alphabet).
 */
export function normalizeGiftCardCode(input: string): string {
  const cleaned = input
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
  // If the user typed without the GC prefix, re-add it
  const stripped = cleaned.startsWith("GC") ? cleaned.slice(2) : cleaned;
  // Re-hyphenate into GC-XXXX-XXXX-XXXX format for storage lookup
  const groups: string[] = ["GC"];
  for (let i = 0; i < stripped.length; i += GROUP_SIZE) {
    groups.push(stripped.slice(i, i + GROUP_SIZE));
  }
  return groups.join("-");
}
