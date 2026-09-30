// Shared PO-number generator for the supplier marketplace.
//
// Extracted so the auto-reorder service (Phase D #77) and the merchant
// PO-create endpoint can produce identically-formatted numbers with the
// same retry pattern on uniqueness collisions.

import { randomBytes } from "crypto";

// 32-char alphabet — excludes look-alike chars (0/O, I/1) to avoid
// ambiguity when merchants read a PO number aloud on the phone.
export const PO_SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generate one candidate PO number. Format: `PO-YYYY-XXXX`.
 * 4 chars from a 32-char alphabet ≈ 1M possible suffixes per year per
 * supplier — collision probability is negligible below thousands/year.
 */
export function generatePoNumberCandidate(): string {
  const year = new Date().getUTCFullYear();
  const bytes = randomBytes(4);
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += PO_SUFFIX_ALPHABET[bytes[i] % PO_SUFFIX_ALPHABET.length];
  }
  return `PO-${year}-${suffix}`;
}

const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Try up to MAX_ATTEMPTS candidate numbers, catching P2002 collisions on
 * the (supplier_tenant_id, po_number) unique index. Returns whatever the
 * `create` callback returns.
 *
 * The callback receives a fresh candidate PO number on each attempt and
 * must call `prisma.purchaseOrder.create({ data: { poNumber, ... } })`
 * (or the equivalent within a transaction).
 */
export async function createPoWithUniqueNumber<T>(
  create: (poNumber: string) => Promise<T>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<T> {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt < maxAttempts) {
    attempt++;
    const poNumber = generatePoNumberCandidate();
    try {
      return await create(poNumber);
    } catch (err: any) {
      lastError = err;
      if (err?.code === "P2002" && err?.meta?.target?.includes?.("po_number")) {
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("Failed to allocate a unique PO number");
}

