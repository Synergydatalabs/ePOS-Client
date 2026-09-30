// Cash discount / dual pricing helper.
//
// Two legally-common patterns:
//   SURCHARGE — displayed prices are the CASH price. Card customers pay
//               an extra X% at checkout.
//   DISCOUNT  — displayed prices are the CARD price. Cash customers get
//               an X% discount at checkout.
//
// Both patterns share the same fields (percent + mode). This helper
// takes the base pre-adjustment total and returns the amount payable
// for cash vs. card, plus a "delta" so callers can render "Save $X"
// or "+$X card fee" copy without recomputing.
//
// All amounts are in cents. Percent is 0..15 (enforced by DB CHECK).
// Cash-adjacent methods (INTERAC / debit) count as CASH for adjustment
// purposes since they typically carry a flat, low fee — merchants
// usually don't surcharge these.

export interface CashDiscountConfig {
  enabled: boolean;
  percent: number; // 0..15
  mode: "SURCHARGE" | "DISCOUNT";
  label?: string | null;
}

export interface AdjustedTotals {
  cashTotal: number; // what a cash customer pays
  cardTotal: number; // what a card customer pays
  cashDelta: number; // cardTotal - cashTotal (always >= 0)
  surchargeApplied: number; // amount added to base (SURCHARGE mode, non-cash)
  cashDiscountApplied: number; // amount removed from base (DISCOUNT mode, cash)
}

export function computeAdjustedTotals(
  baseTotal: number,
  config: CashDiscountConfig
): AdjustedTotals {
  if (
    !config.enabled ||
    !config.percent ||
    config.percent <= 0 ||
    baseTotal <= 0
  ) {
    return {
      cashTotal: baseTotal,
      cardTotal: baseTotal,
      cashDelta: 0,
      surchargeApplied: 0,
      cashDiscountApplied: 0,
    };
  }

  const pct = config.percent / 100;
  // Round half-away-from-zero so the sum matches the receipt every time.
  const delta = Math.round(baseTotal * pct);

  if (config.mode === "DISCOUNT") {
    // Displayed prices are the card price → cash pays LESS.
    return {
      cashTotal: baseTotal - delta,
      cardTotal: baseTotal,
      cashDelta: delta,
      surchargeApplied: 0,
      cashDiscountApplied: delta,
    };
  }
  // SURCHARGE: displayed prices are the cash price → card pays MORE.
  return {
    cashTotal: baseTotal,
    cardTotal: baseTotal + delta,
    cashDelta: delta,
    surchargeApplied: delta,
    cashDiscountApplied: 0,
  };
}

/**
 * Which payment methods are treated as "cash" for adjustment purposes.
 * INTERAC / debit is included because it usually carries a flat
 * per-transaction fee (~$0.05) rather than the 2–3% card interchange
 * that cash-discount programs exist to offset.
 */
const CASH_LIKE_METHODS = new Set([
  "CASH",
  "cash",
  "INTERAC",
  "interac",
  "GIFT_CARD", // gift cards were pre-paid — no processing fee at redemption
  "gift_card",
]);

export function isCashLikeMethod(method: string): boolean {
  return CASH_LIKE_METHODS.has(method);
}

/**
 * Given the resolved method + base total, pick the total the customer
 * actually pays and return the adjustment amounts to stamp on the order.
 */
export function resolvePaymentTotal(
  method: string,
  baseTotal: number,
  config: CashDiscountConfig
): {
  total: number;
  surchargeAmount: number;
  cashDiscountAmount: number;
  cashDiscountReason?: string;
} {
  const t = computeAdjustedTotals(baseTotal, config);
  if (isCashLikeMethod(method)) {
    return {
      total: t.cashTotal,
      surchargeAmount: 0,
      cashDiscountAmount: t.cashDiscountApplied,
      cashDiscountReason:
        t.cashDiscountApplied > 0
          ? `${config.label || "Cash discount"} ${config.percent}%`
          : undefined,
    };
  }
  return {
    total: t.cardTotal,
    surchargeAmount: t.surchargeApplied,
    cashDiscountAmount: 0,
  };
}
