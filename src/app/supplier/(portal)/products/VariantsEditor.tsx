"use client";

// VariantsEditor — inline component inside ProductModal for managing a
// product's variant axes + the variants they cross-product into.
//
// State model (owned here, lifted to parent via `onChange`):
//   axes: [{ name: "Weight", values: ["1kg","5kg","20kg"] },
//          { name: "Format", values: ["Block","Grated"] }]
//   overrides: Map<attributesKey, VariantOverride>
//     — variant field overrides keyed by canonical-json of attributes.
//       New combinations get default (all-null) overrides on the fly.
//
// On every change we recompute the full grid (cross-product of axes' values)
// and emit `{ variantAxes, variants }` to the parent. Parent sends those
// straight to the API — validation + soft-delete-of-retired happens
// server-side (see validateAndNormalizeVariants + PUT handler).

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import TierEditor, { type PriceTierValue } from "./TierEditor";

const MAX_IMAGE_BYTES = 1 * 1024 * 1024;

export interface VariantForApi {
  id?: string;
  displayName: string;
  attributes: Record<string, string>;
  sku: string | null;
  barcode?: string | null;
  wholesalePriceCents: number | null;
  retailPriceCents: number | null;
  minOrderQty: number | null;
  stepQty: number | null;
  trackInventory: boolean;
  stockLevel: number | null;
  lowStockThreshold: number | null;
  imageDataUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  // Phase D #73: per-variant volume tiers.
  priceTiers?: PriceTierValue[];
}

export interface VariantsEditorState {
  variantAxes: string[];
  variants: VariantForApi[];
}

interface AxisWithValues {
  name: string;
  values: string[];
}

interface VariantOverride {
  id?: string;
  sku?: string;
  wholesalePriceCents?: string;
  stockLevel?: string;
  trackInventory?: boolean;
  isActive?: boolean;
  imageDataUrl?: string | null;
  // Phase D #73: per-variant volume tiers, keyed alongside the other
  // overrides so they save/restore in the same round-trip.
  priceTiers?: PriceTierValue[];
}

// Canonical key for an attributes object — sorted by axis, joined.
// Used both to dedup grid rows and to match existing variant ids.
function attrsKey(attrs: Record<string, string>): string {
  return Object.keys(attrs)
    .sort()
    .map((k) => `${k}=${attrs[k]}`)
    .join("|");
}

// Cross-product of every axis's values → all attributes combinations.
// Empty axes = [], one empty axis = []. Anything with at least one axis
// having zero values produces zero combinations (which the UI handles
// by prompting the supplier to add values).
function crossProduct(axes: AxisWithValues[]): Record<string, string>[] {
  if (axes.length === 0) return [];
  if (axes.some((a) => a.values.length === 0)) return [];
  let combos: Record<string, string>[] = [{}];
  for (const axis of axes) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const val of axis.values) {
        next.push({ ...combo, [axis.name]: val });
      }
    }
    combos = next;
  }
  return combos;
}

function deriveDisplayName(attrs: Record<string, string>, axisOrder: string[]): string {
  return axisOrder
    .map((a) => attrs[a] ?? "")
    .filter(Boolean)
    .join(" · ");
}

// Turn incoming variants (from the API) into axes+overrides that the
// editor UI can consume. Values per axis are inferred from the union
// of all variants' attribute values, preserving first-seen order.
function seedStateFromServer(
  initialAxes: string[],
  initialVariants: VariantForApi[]
): {
  axes: AxisWithValues[];
  overrides: Map<string, VariantOverride>;
} {
  const axes: AxisWithValues[] = initialAxes.map((name) => ({ name, values: [] }));
  const overrides = new Map<string, VariantOverride>();

  for (const v of initialVariants) {
    for (const axis of axes) {
      const val = v.attributes[axis.name];
      if (val != null && !axis.values.includes(val)) axis.values.push(val);
    }
    overrides.set(attrsKey(v.attributes), {
      id: v.id,
      sku: v.sku ?? "",
      wholesalePriceCents:
        v.wholesalePriceCents != null ? (v.wholesalePriceCents / 100).toFixed(2) : "",
      stockLevel: v.stockLevel != null ? String(v.stockLevel) : "",
      trackInventory: v.trackInventory,
      isActive: v.isActive,
      imageDataUrl: v.imageDataUrl ?? null,
      priceTiers: Array.isArray(v.priceTiers) ? v.priceTiers : [],
    });
  }

  return { axes, overrides };
}

interface Props {
  currency: string;
  initialAxes: string[];
  initialVariants: VariantForApi[];
  onChange: (state: VariantsEditorState) => void;
}

export default function VariantsEditor({
  currency,
  initialAxes,
  initialVariants,
  onChange,
}: Props) {
  const [{ axes, overrides }, setState] = useState(() =>
    seedStateFromServer(initialAxes, initialVariants)
  );
  const [newValueDraft, setNewValueDraft] = useState<Record<string, string>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Phase D #73: which variant's tier modal is open (by attributes key).
  const [tierModalKey, setTierModalKey] = useState<string | null>(null);

  // Emit to parent on every state change so the parent's save payload
  // always reflects the current grid. onChange is stable enough — parent
  // sets it once per open.
  useEffect(() => {
    const axisNames = axes.map((a) => a.name);
    const combos = crossProduct(axes);
    const variants: VariantForApi[] = combos.map((attrs, idx) => {
      const key = attrsKey(attrs);
      const ov = overrides.get(key) ?? {};
      const priceNum = ov.wholesalePriceCents ? parseFloat(ov.wholesalePriceCents) : NaN;
      const stockNum = ov.stockLevel ? parseInt(ov.stockLevel, 10) : NaN;
      return {
        id: ov.id,
        displayName: deriveDisplayName(attrs, axisNames),
        attributes: attrs,
        sku: ov.sku?.trim() || null,
        barcode: null,
        wholesalePriceCents:
          Number.isFinite(priceNum) && priceNum >= 0 ? Math.round(priceNum * 100) : null,
        retailPriceCents: null,
        minOrderQty: null,
        stepQty: null,
        trackInventory: !!ov.trackInventory,
        stockLevel:
          ov.trackInventory && Number.isFinite(stockNum) && stockNum >= 0
            ? stockNum
            : null,
        lowStockThreshold: null,
        imageDataUrl: ov.imageDataUrl ?? null,
        isActive: ov.isActive !== false,
        sortOrder: idx,
        // Phase D #73: forward the variant's tier list unchanged. Editing
        // happens in the per-variant tier modal (see below).
        priceTiers: ov.priceTiers ?? [],
      };
    });
    onChange({ variantAxes: axisNames, variants });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axes, overrides]);

  // ------- Axis operations -------

  const addAxis = () => {
    // Prompt the supplier for a name — cheaper than an inline "new axis"
    // row that has to handle empty state.
    const raw = window.prompt("Axis name (e.g. Weight, Color, Format)")?.trim();
    if (!raw) return;
    if (axes.some((a) => a.name === raw)) {
      toast.error(`Axis "${raw}" already exists`);
      return;
    }
    setState((s) => ({
      axes: [...s.axes, { name: raw, values: [] }],
      overrides: s.overrides,
    }));
  };

  const renameAxis = (oldName: string) => {
    const next = window.prompt(`Rename axis "${oldName}"`, oldName)?.trim();
    if (!next || next === oldName) return;
    if (axes.some((a) => a.name === next)) {
      toast.error(`Axis "${next}" already exists`);
      return;
    }
    // Rewrite overrides' attribute keys to use the new axis name so the
    // overrides survive the rename.
    setState((s) => {
      const newAxes = s.axes.map((a) =>
        a.name === oldName ? { ...a, name: next } : a
      );
      const newOverrides = new Map<string, VariantOverride>();
      for (const [key, ov] of s.overrides.entries()) {
        // Parse key back to attrs so we can rewrite the axis name.
        const attrs: Record<string, string> = {};
        for (const part of key.split("|")) {
          const [k, v] = part.split("=");
          attrs[k === oldName ? next : k] = v;
        }
        newOverrides.set(attrsKey(attrs), ov);
      }
      return { axes: newAxes, overrides: newOverrides };
    });
  };

  const removeAxis = (name: string) => {
    if (!window.confirm(`Remove axis "${name}"? All its values disappear from every variant.`))
      return;
    // Filter overrides to those still valid (their attrs don't reference
    // the removed axis). Others get dropped — server soft-deletes any
    // existing variants that no longer match the new grid.
    setState((s) => {
      const newAxes = s.axes.filter((a) => a.name !== name);
      const newOverrides = new Map<string, VariantOverride>();
      for (const [, ov] of s.overrides.entries()) void ov; // reset — we'll re-key
      // Simpler: for each existing override key, if the axis being removed
      // is in the key, remove that portion and re-key.
      for (const [key, ov] of s.overrides.entries()) {
        const attrs: Record<string, string> = {};
        for (const part of key.split("|")) {
          const [k, v] = part.split("=");
          if (k !== name) attrs[k] = v;
        }
        // Only keep the override if it still covers every remaining axis
        // AND has no leftover values not in the axis (which can't happen
        // now that the axis is gone). Empty axes = drop everything.
        const covers = newAxes.every((a) => attrs[a.name] != null);
        if (covers && newAxes.length > 0) newOverrides.set(attrsKey(attrs), ov);
      }
      return { axes: newAxes, overrides: newOverrides };
    });
  };

  const addValue = (axisName: string) => {
    const raw = (newValueDraft[axisName] || "").trim();
    if (!raw) return;
    setState((s) => {
      const newAxes = s.axes.map((a) =>
        a.name === axisName
          ? a.values.includes(raw)
            ? a
            : { ...a, values: [...a.values, raw] }
          : a
      );
      return { axes: newAxes, overrides: s.overrides };
    });
    setNewValueDraft((d) => ({ ...d, [axisName]: "" }));
  };

  const removeValue = (axisName: string, value: string) => {
    setState((s) => {
      const newAxes = s.axes.map((a) =>
        a.name === axisName ? { ...a, values: a.values.filter((v) => v !== value) } : a
      );
      // Drop overrides that referenced the removed value.
      const newOverrides = new Map<string, VariantOverride>();
      for (const [key, ov] of s.overrides.entries()) {
        const attrs: Record<string, string> = {};
        for (const part of key.split("|")) {
          const [k, v] = part.split("=");
          attrs[k] = v;
        }
        if (attrs[axisName] !== value) newOverrides.set(key, ov);
      }
      return { axes: newAxes, overrides: newOverrides };
    });
  };

  // ------- Per-variant override edits -------

  const updateOverride = (
    attrs: Record<string, string>,
    patch: Partial<VariantOverride>
  ) => {
    const key = attrsKey(attrs);
    setState((s) => {
      const prev = s.overrides.get(key) ?? {};
      const next = new Map(s.overrides);
      next.set(key, { ...prev, ...patch });
      return { axes: s.axes, overrides: next };
    });
  };

  const handleVariantImage = async (
    attrs: Record<string, string>,
    file: File | null
  ) => {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image must be under 1 MB");
      return;
    }
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      updateOverride(attrs, { imageDataUrl: dataUrl });
    } catch {
      toast.error("Couldn't read image");
    }
  };

  // ------- Derived grid -------

  const combos = useMemo(() => crossProduct(axes), [axes]);
  const axisNames = axes.map((a) => a.name);

  // Detect any incomplete axes (created but no values yet) so we can
  // show a helpful hint instead of an empty grid.
  const incompleteAxes = axes.filter((a) => a.values.length === 0).map((a) => a.name);

  return (
    <div className="border-2 border-dashed border-indigo-200 rounded-2xl p-4 bg-indigo-50/30">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">
            Product variants
            {axes.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-500">
                {combos.length} combination{combos.length !== 1 ? "s" : ""}
              </span>
            )}
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Define one or more axes (Weight, Color, Format, etc.) — a variant
            is auto-created for each combination.
          </p>
        </div>
        {axes.length === 0 && (
          <button
            onClick={addAxis}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 flex-shrink-0"
          >
            <Icon icon="solar:add-square-linear" className="w-3.5 h-3.5" />
            Add first axis
          </button>
        )}
      </div>

      {/* Empty state */}
      {axes.length === 0 && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500">
            No variants — this product is sold as one item.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Add an axis if you sell in multiple sizes, colors, formats, etc.
          </p>
        </div>
      )}

      {/* Axes */}
      {axes.length > 0 && (
        <div className="space-y-3 mb-5">
          {axes.map((axis) => (
            <div key={axis.name} className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-900">{axis.name}</span>
                  <button
                    onClick={() => renameAxis(axis.name)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Rename
                  </button>
                </div>
                <button
                  onClick={() => removeAxis(axis.name)}
                  className="text-xs text-red-500 hover:underline"
                >
                  Remove axis
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {axis.values.map((val) => (
                  <span
                    key={val}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-800 text-xs font-medium"
                  >
                    {val}
                    <button
                      onClick={() => removeValue(axis.name, val)}
                      className="text-indigo-500 hover:text-indigo-900"
                    >
                      <Icon icon="solar:close-circle-bold" className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
                <div className="inline-flex items-center gap-1">
                  <input
                    type="text"
                    value={newValueDraft[axis.name] || ""}
                    onChange={(e) =>
                      setNewValueDraft((d) => ({ ...d, [axis.name]: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addValue(axis.name))}
                    placeholder={`+ value`}
                    className="w-24 px-2 py-1 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <button
                    onClick={() => addValue(axis.name)}
                    className="p-1 rounded text-indigo-600 hover:bg-indigo-50"
                    title="Add value"
                  >
                    <Icon icon="solar:add-circle-linear" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={addAxis}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs font-medium hover:bg-gray-50"
          >
            <Icon icon="solar:add-square-linear" className="w-3.5 h-3.5" />
            Add another axis
          </button>
        </div>
      )}

      {/* Grid */}
      {incompleteAxes.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
          <Icon icon="solar:danger-triangle-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Add at least one value to: {incompleteAxes.map((n) => `"${n}"`).join(", ")}. Variants
            can't be generated until every axis has a value.
          </span>
        </div>
      )}

      {combos.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr className="border-b border-gray-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Variant
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    SKU
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">
                    Price
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">
                    Stock
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">
                    Tiers
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">
                    On
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">
                    Img
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {combos.map((attrs) => {
                  const key = attrsKey(attrs);
                  const ov = overrides.get(key) ?? {};
                  const isActive = ov.isActive !== false;
                  const trackInv = !!ov.trackInventory;
                  return (
                    <tr key={key} className={isActive ? "" : "opacity-50"}>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {deriveDisplayName(attrs, axisNames)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={ov.sku ?? ""}
                          onChange={(e) => updateOverride(attrs, { sku: e.target.value })}
                          placeholder="—"
                          className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none">
                            {currency}
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={ov.wholesalePriceCents ?? ""}
                            onChange={(e) =>
                              updateOverride(attrs, { wholesalePriceCents: e.target.value })
                            }
                            placeholder="—"
                            className="w-full pl-8 pr-2 py-1 text-xs border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            value={ov.stockLevel ?? ""}
                            onChange={(e) =>
                              updateOverride(attrs, {
                                stockLevel: e.target.value,
                                trackInventory: e.target.value !== "" || trackInv,
                              })
                            }
                            disabled={!trackInv}
                            placeholder={trackInv ? "0" : "off"}
                            className="w-full px-2 py-1 text-xs border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
                          />
                          <button
                            onClick={() => updateOverride(attrs, { trackInventory: !trackInv })}
                            className={`p-1 rounded ${trackInv ? "text-indigo-600" : "text-gray-300"}`}
                            title={trackInv ? "Stop tracking stock" : "Track stock"}
                          >
                            <Icon icon="solar:box-bold" className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {/* Phase D #73: tiers chip. Number of tiers on
                            the pill; click opens the tier editor modal
                            for this variant only. */}
                        <button
                          onClick={() => setTierModalKey(key)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            (ov.priceTiers?.length ?? 0) > 0
                              ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                          }`}
                        >
                          <Icon icon="solar:tag-price-linear" className="w-3 h-3" />
                          {(ov.priceTiers?.length ?? 0) === 0
                            ? "None"
                            : `${ov.priceTiers!.length}`}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={(e) => updateOverride(attrs, { isActive: e.target.checked })}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          ref={(el) => {
                            fileInputRefs.current[key] = el;
                          }}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) =>
                            handleVariantImage(attrs, e.target.files?.[0] || null)
                          }
                        />
                        {ov.imageDataUrl ? (
                          <div className="relative w-8 h-8">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={ov.imageDataUrl}
                              alt=""
                              className="w-8 h-8 rounded object-cover cursor-pointer"
                              onClick={() => fileInputRefs.current[key]?.click()}
                            />
                            <button
                              onClick={() => updateOverride(attrs, { imageDataUrl: null })}
                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white text-red-500 shadow flex items-center justify-center text-[10px] hover:bg-red-50"
                              title="Remove image"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => fileInputRefs.current[key]?.click()}
                            className="w-8 h-8 rounded border border-dashed border-gray-300 text-gray-300 hover:text-gray-500 hover:border-gray-400 flex items-center justify-center"
                            title="Add image"
                          >
                            <Icon icon="solar:add-circle-linear" className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-gray-100 text-[11px] text-gray-400">
            Empty fields inherit from the product's price / stock defaults above. Off toggles
            hide the variant from merchants without deleting order history.
          </div>
        </div>
      )}

      {/* Phase D #73: per-variant tier modal. Opened by clicking a row's
          Tiers chip. Reuses the shared TierEditor — same UX as the
          product-level tier editor in ProductModal. */}
      {tierModalKey && (
        <TierModal
          modalKey={tierModalKey}
          overrides={overrides}
          currency={currency}
          axisNames={axisNames}
          onClose={() => setTierModalKey(null)}
          onSave={(nextTiers) => {
            const attrs: Record<string, string> = {};
            for (const part of tierModalKey.split("|")) {
              const [k, v] = part.split("=");
              attrs[k] = v;
            }
            updateOverride(attrs, { priceTiers: nextTiers });
            setTierModalKey(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- Per-variant tier modal ----------
// Reads the current tiers for one variant, lets the supplier edit via the
// shared TierEditor, and calls back with the final list. Kept in-file
// because it's tightly coupled to the parent's overrides map — extracting
// would add plumbing without simplifying anything.

function TierModal({
  modalKey,
  overrides,
  currency,
  axisNames,
  onClose,
  onSave,
}: {
  modalKey: string;
  overrides: Map<string, VariantOverride>;
  currency: string;
  axisNames: string[];
  onClose: () => void;
  onSave: (tiers: PriceTierValue[]) => void;
}) {
  // Local editing copy — save button flushes to parent. Cancel just closes.
  const initialTiers = overrides.get(modalKey)?.priceTiers ?? [];
  const [tiers, setTiers] = useState<PriceTierValue[]>(initialTiers);

  // Reconstruct the variant's attributes for the modal header from the key.
  const attrs: Record<string, string> = {};
  for (const part of modalKey.split("|")) {
    const [k, v] = part.split("=");
    attrs[k] = v;
  }
  const displayName = axisNames
    .map((a) => attrs[a] ?? "")
    .filter(Boolean)
    .join(" · ");

  // Base price for the reference row in TierEditor — pull the override's
  // wholesale price if set, else leave null (TierEditor omits the row).
  const basePriceStr = overrides.get(modalKey)?.wholesalePriceCents;
  const basePriceCents =
    basePriceStr && basePriceStr.trim() !== ""
      ? Math.round(parseFloat(basePriceStr) * 100)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-gray-900">Volume tiers</h3>
            <p className="text-xs text-gray-500 mt-0.5">{displayName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 -mt-2 -mr-2"
          >
            <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
          </button>
        </div>

        <TierEditor
          value={tiers}
          currency={currency}
          basePriceCents={basePriceCents}
          onChange={setTiers}
        />

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-100 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(tiers)}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
          >
            Save Tiers
          </button>
        </div>
      </div>
    </div>
  );
}
