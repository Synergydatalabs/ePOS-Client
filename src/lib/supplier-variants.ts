// Validation + normalization for supplier product variants.
//
// Called by the product create + update endpoints. Enforces:
//   - When variantAxes is empty, variants must be empty
//   - When variantAxes has entries, every variant.attributes must have
//     EXACTLY the axis names as keys (no missing, no extras)
//   - No two variants share identical attributes (would collide in UI +
//     be ambiguous at order time)
//   - SKUs unique within the product's variant list
//   - Prices non-negative, qtys ≥ 1, stock ≥ 0
//
// Returns either `{ ok: true, normalized: [...] }` (ready to hand to
// Prisma) or `{ ok: false, error: "..." }` (a specific message for the
// client to display).

export interface VariantInput {
  id?: string; // present = update existing; absent = insert new
  displayName?: string;
  attributes?: Record<string, string>;
  sku?: string | null;
  barcode?: string | null;
  wholesalePriceCents?: number | null;
  retailPriceCents?: number | null;
  minOrderQty?: number | null;
  stepQty?: number | null;
  trackInventory?: boolean;
  stockLevel?: number | null;
  lowStockThreshold?: number | null;
  imageDataUrl?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  // Phase D #73: volume tiers for this variant.
  priceTiers?: VariantPriceTierInput[];
}

export interface NormalizedVariant {
  id?: string;
  displayName: string;
  attributes: Record<string, string>;
  sku: string | null;
  barcode: string | null;
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
  // Phase D #73: normalized tier list (validated + deduped).
  priceTiers: { minQty: number; unitPriceCents: number }[];
}

// Phase D #73: shared tier validation. Rejects duplicate minQty (would
// crash the unique index) + non-positive minQty + negative prices.
// Duplicate minQty across tiers is a data bug that the supplier UI
// should prevent — server rejects loudly rather than silently pick one.
export function validatePriceTiers(
  raw: unknown,
  context: string
):
  | { ok: true; tiers: { minQty: number; unitPriceCents: number }[] }
  | { ok: false; error: string } {
  const tiers: { minQty: number; unitPriceCents: number }[] = [];
  if (raw == null) return { ok: true, tiers };
  if (!Array.isArray(raw)) {
    return { ok: false, error: `${context}: price tiers must be an array` };
  }
  const seenMinQty = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as VariantPriceTierInput;
    const minQty = Number(t?.minQty);
    const price = Number(t?.unitPriceCents);
    if (!Number.isFinite(minQty) || minQty < 1) {
      return { ok: false, error: `${context}: tier #${i + 1} — minQty must be ≥ 1` };
    }
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, error: `${context}: tier #${i + 1} — price must be ≥ 0` };
    }
    const key = Math.round(minQty);
    if (seenMinQty.has(key)) {
      return { ok: false, error: `${context}: two tiers share minQty ${key}` };
    }
    seenMinQty.add(key);
    tiers.push({ minQty: key, unitPriceCents: Math.round(price) });
  }
  tiers.sort((a, b) => a.minQty - b.minQty);
  return { ok: true, tiers };
}

const MAX_IMAGE_DATA_URL_LENGTH = 2_500_000; // ~1.8 MB decoded

// Phase D #73: shape a variant carries for its tiers. Kept alongside the
// variant fields so variant edits and tier edits round-trip together.
export interface VariantPriceTierInput {
  minQty?: number;
  unitPriceCents?: number;
}

// Derive the merchant-facing label from the attributes if the caller
// didn't provide one. "1kg · Block" style, joined by · in axis order.
export function deriveDisplayName(
  attributes: Record<string, string>,
  axes: string[]
): string {
  return axes.map((a) => attributes[a] ?? "").filter(Boolean).join(" · ");
}

// Stable JSON stringification for attribute-equality checks. Sorts keys
// so `{a:1,b:2}` and `{b:2,a:1}` hash the same.
function attrsKey(attributes: Record<string, string>): string {
  const keys = Object.keys(attributes).sort();
  return JSON.stringify(keys.map((k) => [k, attributes[k]]));
}

export function validateAndNormalizeVariants(
  variants: unknown,
  variantAxes: string[]
): { ok: true; normalized: NormalizedVariant[] } | { ok: false; error: string } {
  const raw: VariantInput[] = Array.isArray(variants) ? (variants as VariantInput[]) : [];

  // Simple product path — no variants allowed, and none required.
  if (variantAxes.length === 0) {
    if (raw.length > 0) {
      return {
        ok: false,
        error:
          "This product has no variant axes — remove the variants list, or add at least one axis first.",
      };
    }
    return { ok: true, normalized: [] };
  }

  // Product declares axes → must have at least one variant.
  if (raw.length === 0) {
    return {
      ok: false,
      error: "Add at least one variant, or remove the variant axes.",
    };
  }

  const axesSet = new Set(variantAxes);
  const seenAttrKeys = new Set<string>();
  const seenSkus = new Set<string>();
  const normalized: NormalizedVariant[] = [];

  for (let i = 0; i < raw.length; i++) {
    const v = raw[i] || {};

    // Attributes must exist AND cover every axis, no extras.
    const attributes = (v.attributes && typeof v.attributes === "object" ? v.attributes : {}) as Record<
      string,
      string
    >;
    const attrKeys = Object.keys(attributes);
    for (const axis of variantAxes) {
      if (typeof attributes[axis] !== "string" || !attributes[axis].trim()) {
        return {
          ok: false,
          error: `Variant #${i + 1} is missing a value for "${axis}".`,
        };
      }
    }
    for (const key of attrKeys) {
      if (!axesSet.has(key)) {
        return {
          ok: false,
          error: `Variant #${i + 1} has an unknown axis "${key}" — remove it or add the axis.`,
        };
      }
    }

    const attrKey = attrsKey(attributes);
    if (seenAttrKeys.has(attrKey)) {
      return {
        ok: false,
        error: `Two variants have identical attributes (${Object.entries(attributes)
          .map(([k, val]) => `${k}: ${val}`)
          .join(", ")}). Each combination must be unique.`,
      };
    }
    seenAttrKeys.add(attrKey);

    // SKU uniqueness within the product.
    const sku = v.sku?.trim() || null;
    if (sku) {
      const skuLower = sku.toLowerCase();
      if (seenSkus.has(skuLower)) {
        return {
          ok: false,
          error: `SKU "${sku}" is used by more than one variant on this product.`,
        };
      }
      seenSkus.add(skuLower);
    }

    // Numeric field validation — nullable fields let variants inherit
    // from the parent product, so `null` (or undefined) stays null.
    const wholesale =
      v.wholesalePriceCents != null && (v.wholesalePriceCents as unknown) !== ""
        ? Number(v.wholesalePriceCents)
        : null;
    if (wholesale != null && (!Number.isFinite(wholesale) || wholesale < 0)) {
      return {
        ok: false,
        error: `Variant #${i + 1} has an invalid wholesale price.`,
      };
    }

    const retail =
      v.retailPriceCents != null && (v.retailPriceCents as unknown) !== ""
        ? Number(v.retailPriceCents)
        : null;
    if (retail != null && (!Number.isFinite(retail) || retail < 0)) {
      return {
        ok: false,
        error: `Variant #${i + 1} has an invalid retail price.`,
      };
    }

    const minOrder =
      v.minOrderQty != null && (v.minOrderQty as unknown) !== ""
        ? Number(v.minOrderQty)
        : null;
    if (minOrder != null && (!Number.isFinite(minOrder) || minOrder < 1)) {
      return {
        ok: false,
        error: `Variant #${i + 1}: minimum order qty must be ≥ 1.`,
      };
    }

    const step =
      v.stepQty != null && (v.stepQty as unknown) !== "" ? Number(v.stepQty) : null;
    if (step != null && (!Number.isFinite(step) || step < 1)) {
      return {
        ok: false,
        error: `Variant #${i + 1}: step qty must be ≥ 1.`,
      };
    }

    const trackInv = Boolean(v.trackInventory);
    const stock =
      trackInv && v.stockLevel != null && (v.stockLevel as unknown) !== ""
        ? Number(v.stockLevel)
        : null;
    if (stock != null && (!Number.isFinite(stock) || stock < 0)) {
      return {
        ok: false,
        error: `Variant #${i + 1}: stock level must be ≥ 0.`,
      };
    }

    const lowThresh =
      trackInv &&
      v.lowStockThreshold != null &&
      (v.lowStockThreshold as unknown) !== ""
        ? Number(v.lowStockThreshold)
        : null;

    // Per-variant image (base64 data URL). Reuse the cap from products.
    const imageDataUrl = v.imageDataUrl?.trim() || null;
    if (imageDataUrl && imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return {
        ok: false,
        error: `Variant #${i + 1}: image exceeds the 1 MB size cap.`,
      };
    }

    // Phase D #73: per-variant price tiers.
    const tiersResult = validatePriceTiers(v.priceTiers, `Variant #${i + 1}`);
    if (!tiersResult.ok) return { ok: false, error: tiersResult.error };

    // Trim/whitespace-normalize the attribute values so " 1kg " and "1kg"
    // are treated as the same value.
    const cleanAttrs: Record<string, string> = {};
    for (const axis of variantAxes) cleanAttrs[axis] = attributes[axis].trim();

    normalized.push({
      id: v.id || undefined,
      displayName: v.displayName?.trim() || deriveDisplayName(cleanAttrs, variantAxes),
      attributes: cleanAttrs,
      sku,
      barcode: v.barcode?.trim() || null,
      wholesalePriceCents: wholesale != null ? Math.round(wholesale) : null,
      retailPriceCents: retail != null ? Math.round(retail) : null,
      minOrderQty: minOrder != null ? Math.round(minOrder) : null,
      stepQty: step != null ? Math.round(step) : null,
      trackInventory: trackInv,
      stockLevel: stock != null ? Math.round(stock) : null,
      lowStockThreshold: lowThresh != null ? Math.round(Number(lowThresh)) : null,
      imageDataUrl,
      isActive: v.isActive !== false,
      sortOrder: typeof v.sortOrder === "number" ? v.sortOrder : 0,
      priceTiers: tiersResult.tiers,
    });
  }

  return { ok: true, normalized };
}
