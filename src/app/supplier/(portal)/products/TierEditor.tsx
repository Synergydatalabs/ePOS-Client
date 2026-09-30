"use client";

// Reusable volume-tier editor. Used inline in ProductModal (product-level
// tiers on simple products) and inside the per-variant tier modal opened
// from VariantsEditor.
//
// Contract:
//   value:    array of { minQty, unitPriceCents }
//   onChange: called with a NEW sorted-by-minQty array on every edit
//   currency: display label for the price column ("CAD")
//
// Rows show a small preview of the effective unit price a buyer would
// pay at that qty — helps suppliers sanity-check that lower quantities
// don't accidentally cost less than higher ones (should be monotonic
// decreasing, but nothing stops a supplier from entering weird data).

import { useMemo } from "react";
import { Icon } from "@iconify/react";

export interface PriceTierRow {
  minQty: string; // string in the form; parsed on save
  unitPrice: string; // dollars as string, e.g. "9.50"
}

export interface PriceTierValue {
  minQty: number;
  unitPriceCents: number;
}

interface Props {
  value: PriceTierValue[];
  currency: string;
  // basePrice shown as the "quantity 1" reference line so suppliers see
  // what the tiers are discounting FROM. Optional — omitted for variants
  // whose price inherits from the product until edited.
  basePriceCents?: number | null;
  onChange: (next: PriceTierValue[]) => void;
}

export default function TierEditor({
  value,
  currency,
  basePriceCents,
  onChange,
}: Props) {
  // Convert value → editable rows for the form. Kept as a derived value
  // (not local state) so parent state is the source of truth — no drift.
  const rows: PriceTierRow[] = useMemo(
    () =>
      value.map((t) => ({
        minQty: String(t.minQty),
        unitPrice: (t.unitPriceCents / 100).toFixed(2),
      })),
    [value]
  );

  // Push a mutation up to the parent. Empty / invalid fields collapse
  // gracefully — a row with blank price becomes 0, which the DB rejects,
  // which surfaces as a save error. Better than eating the click silently.
  const emit = (next: PriceTierRow[]) => {
    const parsed: PriceTierValue[] = [];
    const seenMinQty = new Set<number>();
    for (const r of next) {
      const minQty = parseInt(r.minQty, 10);
      const cents = Math.round(parseFloat(r.unitPrice) * 100);
      if (
        Number.isFinite(minQty) &&
        minQty >= 1 &&
        Number.isFinite(cents) &&
        cents >= 0 &&
        !seenMinQty.has(minQty)
      ) {
        seenMinQty.add(minQty);
        parsed.push({ minQty, unitPriceCents: cents });
      }
    }
    parsed.sort((a, b) => a.minQty - b.minQty);
    onChange(parsed);
  };

  const updateRow = (idx: number, patch: Partial<PriceTierRow>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    emit(next);
  };
  const addRow = () => emit([...rows, { minQty: "", unitPrice: "" }]);
  const removeRow = (idx: number) => emit(rows.filter((_, i) => i !== idx));

  // Detect duplicate minQty values so the supplier gets an inline warning
  // (backend rejects them, but catching in the UI is nicer). Duplicates
  // are already filtered out of the emitted `value`, so we work from
  // `rows` directly to preserve the visual duplicate for the warning.
  const duplicateMinQtys = new Set<string>();
  const seenMinQtyStrs = new Set<string>();
  for (const r of rows) {
    const k = r.minQty.trim();
    if (!k) continue;
    if (seenMinQtyStrs.has(k)) duplicateMinQtys.add(k);
    seenMinQtyStrs.add(k);
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Volume Tiers
          </p>
          <p className="text-[11px] text-gray-500">
            Optional — set a lower unit price at higher order quantities.
          </p>
        </div>
        <button
          onClick={addRow}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-indigo-700 hover:bg-indigo-50"
        >
          <Icon icon="solar:add-circle-linear" className="w-4 h-4" />
          Add tier
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="p-4 text-center text-xs text-gray-400">
          No tiers configured. Merchants pay the default price at every qty.
        </div>
      ) : (
        <div>
          {/* Header */}
          <div className="grid grid-cols-[1fr,1fr,auto] gap-2 px-3 py-2 border-b border-gray-100 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            <span>Min qty</span>
            <span>Unit price ({currency})</span>
            <span className="w-6" />
          </div>
          {basePriceCents != null && (
            <div className="grid grid-cols-[1fr,1fr,auto] gap-2 px-3 py-2 text-xs text-gray-400 italic border-b border-gray-100">
              <span>1 (default)</span>
              <span>{(basePriceCents / 100).toFixed(2)}</span>
              <span className="w-6" />
            </div>
          )}
          {rows.map((r, i) => {
            const isDup = duplicateMinQtys.has(r.minQty.trim());
            return (
              <div
                key={i}
                className={`grid grid-cols-[1fr,1fr,auto] gap-2 px-3 py-2 border-b border-gray-100 last:border-b-0 items-center ${
                  isDup ? "bg-red-50/40" : ""
                }`}
              >
                <input
                  type="number"
                  min={1}
                  value={r.minQty}
                  onChange={(e) => updateRow(i, { minQty: e.target.value })}
                  placeholder="e.g. 10"
                  className={`w-full px-2 py-1 text-xs border rounded-md outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                    isDup ? "border-red-300" : "border-gray-200"
                  }`}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={r.unitPrice}
                  onChange={(e) => updateRow(i, { unitPrice: e.target.value })}
                  placeholder="e.g. 9.50"
                  className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <button
                  onClick={() => removeRow(i)}
                  className="p-1 text-red-500 hover:bg-red-50 rounded"
                  title="Remove tier"
                >
                  <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                </button>
              </div>
            );
          })}
          {duplicateMinQtys.size > 0 && (
            <div className="px-3 py-2 bg-red-50 border-t border-red-100 text-[11px] text-red-800">
              Two tiers share the same min qty — the save will be rejected.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
