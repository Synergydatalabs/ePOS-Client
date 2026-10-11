// =============================================================================
// Zero-decimal currency helpers.
//
// Some currencies (KRW, JPY, VND, etc.) have no sub-unit — there's no "cent"
// or "paise". Our DB stores every amount in "internal cents" uniformly, so
// a ₩1,000 charge is stored as 100000. That keeps all monetary math (totals,
// surcharges, refunds, reporting) in one representation across every tenant.
//
// But forcing API callers to think in "cents" for a currency that has no
// sub-unit is confusing — Korean devs expect `amount: 1000` to mean ₩1,000.
// So the API boundary converts:
//
//   On INPUT  (API caller → us): native units × 100 for zero-decimal currencies
//   On OUTPUT (us → API caller + webhooks): internal cents ÷ 100 for same
//
// For currencies with real sub-units (USD/CAD/EUR/INR/GBP/…) the amount
// stays as-is on the wire — API caller sends/receives cents directly,
// because that matches how everyone thinks about USD charges ($10 = 1000c).
// =============================================================================

/**
 * Currencies with no sub-unit. The international standard is in ISO 4217
 * list "Minor unit = 0". Keep this list in sync with the identical set in
 * src/lib/paddle/client.ts (which uses it to format Paddle API amounts).
 */
export const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", // Japanese yen
  "KRW", // South Korean won
  "VND", // Vietnamese dong
  "CLP", // Chilean peso
  "ISK", // Icelandic krona
  "UGX", // Ugandan shilling
  "RWF", // Rwandan franc
  "XOF", // West African CFA franc
  "XAF", // Central African CFA franc
  "PYG", // Paraguayan guarani
  "DJF", // Djiboutian franc
  "GNF", // Guinean franc
  "KMF", // Comorian franc
  "MGA", // Malagasy ariary
  "BIF", // Burundian franc
  "XPF", // CFP franc
]);

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase());
}

/**
 * Convert an API-caller-supplied amount into our internal cents
 * representation. For zero-decimal currencies, the caller supplies the
 * amount in native units (₩1,000 → 1000) and we multiply by 100 so our
 * internal storage keeps the uniform "cents" shape (₩1,000 → 100000c).
 *
 * For currencies with sub-units, the caller already supplied cents
 * (e.g. $10 → 1000c) — pass through unchanged.
 */
export function apiAmountToInternalCents(
  apiAmount: number,
  currency: string
): number {
  if (isZeroDecimalCurrency(currency)) {
    return Math.round(apiAmount * 100);
  }
  return Math.round(apiAmount);
}

/**
 * Convert an internal-cents amount into the "API-caller-friendly" value we
 * put in API responses and webhook payloads. Inverse of
 * apiAmountToInternalCents.
 *
 * For zero-decimal: 100000c (₩1,000 internal) → 1000 (native ₩1,000)
 * For sub-unit:     1000c   ($10.00 internal) → 1000 (API cents unchanged)
 */
export function internalCentsToApiAmount(
  internalCents: number,
  currency: string
): number {
  if (isZeroDecimalCurrency(currency)) {
    return Math.round(internalCents / 100);
  }
  return Math.round(internalCents);
}
