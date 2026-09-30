// Volume-tier pricing resolver.
//
// A tier says "at qty ≥ minQty, unit price becomes unitPriceCents".
// Suppliers can define any number of tiers per product (or per variant).
// At order time we pick the tier with the HIGHEST minQty ≤ qty — that's
// the "best" tier for the buyer, matching how B2B pricing sheets work.
//
// If no tier applies (qty below the smallest tier), the caller falls back
// to the product/variant default price.
//
// Used by both cart preview (client → API surface) and PO create
// (authoritative server-side pricing).

export interface PriceTier {
  minQty: number;
  unitPriceCents: number;
}

export interface ResolvedTier {
  tier: PriceTier;
  // Next tier the buyer could reach (bigger discount).
  nextTier?: PriceTier;
  // Qty they need to add to reach the next tier.
  qtyToNextTier?: number;
}

/**
 * Given an ordered qty and a list of tiers, returns:
 *   - the tier that applies (highest minQty ≤ qty), or null if none
 *   - the NEXT unreached tier + how many more units to reach it, if any
 *
 * Tiers are sorted internally — callers can pass them in any order.
 */
export function resolveBestTier(
  qty: number,
  tiers: PriceTier[]
): ResolvedTier | null {
  if (qty <= 0 || tiers.length === 0) return null;

  // Sort ascending by minQty. Duplicates would be a data bug (unique
  // index in DB should catch it), but if two tiers share a minQty we
  // pick the lower price silently — better UX than an error.
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);

  let bestIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].minQty <= qty) bestIdx = i;
    else break;
  }
  if (bestIdx < 0) {
    // Below all tiers — no tier applies, but tell the caller about the
    // smallest unreached tier so the UI can nudge the buyer.
    return {
      tier: { minQty: 0, unitPriceCents: 0 }, // sentinel — caller should ignore
      nextTier: sorted[0],
      qtyToNextTier: sorted[0].minQty - qty,
    };
  }

  const best = sorted[bestIdx];
  const next = sorted[bestIdx + 1];
  return {
    tier: best,
    nextTier: next,
    qtyToNextTier: next ? next.minQty - qty : undefined,
  };
}

/**
 * Convenience — the effective per-unit price for a given qty against a
 * base price + optional tiers. Returns the base if no tier applies.
 * This is the single call sites use when they just want the number.
 */
export function effectiveUnitPriceCents(
  qty: number,
  basePriceCents: number,
  tiers: PriceTier[] | null | undefined
): number {
  if (!tiers || tiers.length === 0) return basePriceCents;
  const resolved = resolveBestTier(qty, tiers);
  // resolveBestTier returns a "below all tiers" sentinel with minQty=0;
  // guard against using that as if it were a real tier.
  if (!resolved || resolved.tier.minQty === 0) return basePriceCents;
  return resolved.tier.unitPriceCents;
}
