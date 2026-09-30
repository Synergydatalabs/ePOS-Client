"use client";

// Merchant cart / checkout view for a single supplier.
//
// Flow:
//   1. Load cart from localStorage (client-only — no DB row until submit)
//   2. Fetch supplier profile + full product details for each cart item so
//      we can show live prices, images, and min/step rules
//   3. User can adjust qtys / remove / add notes / pick delivery location
//   4. On Submit → POST to /orders endpoint → clear cart → redirect
//
// Not covered here: purchasing on behalf of another merchant location that
// belongs to a different tenant (impossible by design — validation on the
// server rejects it).

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Card } from "@/components/ui";
import {
  Cart,
  getCart,
  setQty as setCartQty,
  removeFromCart,
  updateMeta,
  clearCart,
} from "@/lib/marketplace-cart";
import { resolveBestTier } from "@/lib/supplier-price-tiers";

interface PriceTier {
  minQty: number;
  unitPriceCents: number;
}

// Phase D #72: variant type (pre-resolved server-side — see marketplace
// products endpoint). Cart lines with a variantId use these values.
interface Variant {
  id: string;
  displayName: string;
  attributes: Record<string, string>;
  sku: string | null;
  wholesalePriceCents: number;
  minOrderQty: number;
  stepQty: number;
  stockIndicator: "in" | "low" | "out" | null;
  image: { dataUrl: string; altText: string | null } | null;
  // Phase D #73
  priceTiers: PriceTier[];
}

interface Product {
  id: string;
  name: string;
  sku: string | null;
  unitLabel: string;
  wholesalePriceCents: number;
  minOrderQty: number;
  stepQty: number;
  stockIndicator: "in" | "low" | "out" | null;
  image: { dataUrl: string; altText: string | null } | null;
  variantAxes: string[];
  variants: Variant[];
  // Phase D #73 — only populated for simple products (no variants).
  priceTiers: PriceTier[];
}

interface SupplierProfile {
  displayName: string;
  currency: string;
  minOrderCents: number;
}

interface LocationRow {
  id: string;
  name: string;
  city?: string | null;
  isDefault?: boolean;
}

export default function CartPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = use(params);
  const router = useRouter();

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [profile, setProfile] = useState<SupplierProfile | null>(null);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState("");
  const [locationId, setLocationId] = useState("");

  // Initial load — tenant id from localStorage, then fetch cart + profile
  // + products + locations in parallel.
  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (!stored) return;
    setTenantId(stored);

    const c = getCart(stored, supplierId);
    setCart(c);
    setNotes(c.notesToSupplier || "");
    setLocationId(c.locationId || "");

    Promise.all([
      fetch(`/api/tenants/${stored}/marketplace/suppliers/${supplierId}`).then((r) => r.json()),
      fetch(`/api/tenants/${stored}/marketplace/suppliers/${supplierId}/products`).then((r) => r.json()),
      fetch(`/api/tenants/${stored}/locations`).then((r) => r.json()),
    ])
      .then(([profileData, productsData, locationsData]) => {
        if (profileData.success) {
          setProfile({
            displayName: profileData.supplier.displayName,
            currency: profileData.supplier.currency,
            minOrderCents: profileData.supplier.minOrderCents,
          });
        } else {
          toast.error(profileData.error || "Supplier not found");
          router.replace("/dashboard/admin/marketplace");
        }

        if (productsData.success) {
          const map = new Map<string, Product>();
          for (const p of productsData.products) map.set(p.id, p);
          setProducts(map);
        }

        if (locationsData.success) {
          const locs: LocationRow[] = (locationsData.locations || []).map((l: any) => ({
            id: l.id,
            name: l.name,
            city: l.city,
            isDefault: l.isDefault,
          }));
          setLocations(locs);
          // Auto-pick the default location if the cart doesn't have one yet.
          if (!c.locationId) {
            const def = locs.find((l) => l.isDefault) || locs[0];
            if (def) {
              setLocationId(def.id);
              updateMeta(stored, supplierId, { locationId: def.id });
            }
          }
        }
      })
      .catch(() => toast.error("Failed to load cart"))
      .finally(() => setLoading(false));
  }, [supplierId, router]);

  // Persist notes into the cart on blur so the merchant can navigate away
  // and come back without losing them.
  const commitNotes = () => {
    if (!tenantId || !cart) return;
    updateMeta(tenantId, supplierId, { notesToSupplier: notes });
  };

  const handleLocationChange = (id: string) => {
    setLocationId(id);
    if (tenantId) updateMeta(tenantId, supplierId, { locationId: id });
  };

  // Phase D #72: cart lines are unique on (productId, variantId), so
  // both mutations need to carry the variantId through to the cart lib.
  const handleQtyChange = (productId: string, next: number, variantId?: string) => {
    if (!tenantId) return;
    const updated = setCartQty(tenantId, supplierId, productId, next, variantId);
    setCart(updated);
  };

  const handleRemove = (productId: string, variantId?: string) => {
    if (!tenantId) return;
    const updated = removeFromCart(tenantId, supplierId, productId, variantId);
    setCart(updated);
  };

  // Compute enriched line items (cart + live product/variant data) once
  // per render. When the cart item has a variantId, we resolve to the
  // variant's effective fields; otherwise we use the product-level fields.
  //
  // "unavailable" covers three cases:
  //   - product no longer exists (deleted or deactivated)
  //   - product now HAS variants but the cart line has no variantId (stale)
  //   - cart line references a variantId that no longer exists on the product
  const lines = useMemo(() => {
    if (!cart) return [];
    return cart.items
      .map((item) => {
        const product = products.get(item.productId);
        if (!product) {
          return {
            item,
            product: null as Product | null,
            variant: null as Variant | null,
            unitPriceCents: 0,
            basePriceCents: 0,
            appliedTier: null,
            nextTier: null,
            qtyToNextTier: undefined,
            effectiveMinQty: 1,
            effectiveStepQty: 1,
            unitLabel: "",
            imageDataUrl: null as string | null,
            titleLine: "",
            subLine: "",
            stockIndicator: null as Variant["stockIndicator"],
            lineTotalCents: 0,
            unavailable: true as const,
          };
        }

        const productHasVariants = product.variantAxes.length > 0;
        let variant: Variant | null = null;
        if (productHasVariants) {
          if (!item.variantId) {
            // Product used to be simple, now has variants — stale cart entry.
            return {
              item,
              product,
              variant: null,
              unitPriceCents: 0,
              effectiveMinQty: 1,
              effectiveStepQty: 1,
              unitLabel: product.unitLabel,
              imageDataUrl: product.image?.dataUrl ?? null,
              titleLine: product.name,
              subLine: "Pick a variant to continue",
              stockIndicator: null,
              lineTotalCents: 0,
              unavailable: true as const,
            };
          }
          variant = product.variants.find((v) => v.id === item.variantId) ?? null;
          if (!variant) {
            // Variant deactivated or removed since the merchant added it.
            return {
              item,
              product,
              variant: null,
              unitPriceCents: 0,
              effectiveMinQty: 1,
              effectiveStepQty: 1,
              unitLabel: product.unitLabel,
              imageDataUrl: product.image?.dataUrl ?? null,
              titleLine: product.name,
              subLine: "Selected variant no longer available",
              stockIndicator: null,
              lineTotalCents: 0,
              unavailable: true as const,
            };
          }
        }

        const baseUnit = variant?.wholesalePriceCents ?? product.wholesalePriceCents;
        const minQty = variant?.minOrderQty ?? product.minOrderQty;
        const stepQty = variant?.stepQty ?? product.stepQty;
        const imgUrl =
          variant?.image?.dataUrl ?? product.image?.dataUrl ?? null;
        const titleLine = variant
          ? `${product.name} — ${variant.displayName}`
          : product.name;
        const subLine = variant?.sku ?? product.sku
          ? `${variant?.sku ?? product.sku}`
          : "";

        // Phase D #73: resolve the applicable volume tier for this line's
        // current qty. Client preview only — the server re-resolves at
        // PO submit and stores the authoritative unit_price_cents.
        const tiers = variant ? variant.priceTiers : product.priceTiers;
        const resolved = resolveBestTier(item.qty, tiers);
        const appliedTier =
          resolved && resolved.tier.minQty > 0 ? resolved.tier : null;
        const nextTier = resolved?.nextTier ?? null;
        const qtyToNextTier = resolved?.qtyToNextTier;
        const unit = appliedTier ? appliedTier.unitPriceCents : baseUnit;

        return {
          item,
          product,
          variant,
          unitPriceCents: unit,
          basePriceCents: baseUnit,
          appliedTier,
          nextTier,
          qtyToNextTier,
          effectiveMinQty: minQty,
          effectiveStepQty: stepQty,
          unitLabel: product.unitLabel,
          imageDataUrl: imgUrl,
          titleLine,
          subLine,
          stockIndicator: variant?.stockIndicator ?? product.stockIndicator,
          lineTotalCents: unit * item.qty,
          unavailable: false as const,
        };
      })
      // Preserve insertion order — items sorted by addedAt asc.
      .sort((a, b) => a.item.addedAt - b.item.addedAt);
  }, [cart, products]);

  const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const totalCents = subtotalCents; // Phase C: + taxes

  const unavailableCount = lines.filter((l) => l.unavailable).length;

  const belowMinOrder =
    !!profile && profile.minOrderCents > 0 && subtotalCents < profile.minOrderCents;

  // Per-line rule violation messages (min qty / step). Doesn't block save
  // to cart — merchant can adjust freely — but blocks submit.
  // Phase D #72: warnings use EFFECTIVE min/step/stock (variant if picked,
  // else product-level). Keyed by (productId, variantId) so two lines for
  // the same product with different variants each get their own warning.
  const lineWarnings = lines
    .filter((l) => !l.unavailable && l.product)
    .map((l) => {
      const key = { productId: l.item.productId, variantId: l.item.variantId };
      if (l.item.qty < l.effectiveMinQty) {
        return { ...key, message: `Min order ${l.effectiveMinQty}` };
      }
      if (l.effectiveStepQty > 1 && l.item.qty % l.effectiveStepQty !== 0) {
        return { ...key, message: `Order in multiples of ${l.effectiveStepQty}` };
      }
      if (l.stockIndicator === "out") {
        return { ...key, message: "Out of stock" };
      }
      return null;
    })
    .filter(Boolean) as {
    productId: string;
    variantId?: string;
    message: string;
  }[];

  const canSubmit =
    !!cart &&
    lines.length > 0 &&
    unavailableCount === 0 &&
    lineWarnings.length === 0 &&
    !belowMinOrder &&
    !!locationId;

  const money = (cents: number) => {
    const currency = profile?.currency || "CAD";
    return `${currency} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const handleSubmit = async () => {
    if (!tenantId || !cart || !canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/marketplace/suppliers/${supplierId}/orders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId,
            notesToSupplier: notes.trim() || undefined,
            // Phase D #72: forward variantId when present. Server treats
            // missing variantId as "simple product" and rejects it if the
            // product actually has variants (stale cart guard).
            items: cart.items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              qty: i.qty,
            })),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to submit order");
        setSubmitting(false);
        return;
      }
      toast.success(`Purchase order ${data.purchaseOrder.poNumber} submitted!`);
      clearCart(tenantId, supplierId);
      // Land back on the marketplace index — PO tracking view arrives in #61.
      // The toast holds the PO number long enough for the merchant to see it.
      router.push("/dashboard/admin/marketplace");
    } catch {
      toast.error("Failed to submit order");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-gray-100 rounded-2xl" />
          <div className="h-40 bg-gray-100 rounded-2xl" />
          <div className="h-40 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Review Order"
        subtitle={
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/dashboard/admin/marketplace" className="text-indigo-600 hover:underline">
              Marketplace
            </Link>
            <Icon icon="solar:alt-arrow-right-linear" className="w-3.5 h-3.5" />
            <Link
              href={`/dashboard/admin/marketplace/${supplierId}`}
              className="text-indigo-600 hover:underline"
            >
              {profile?.displayName || "Supplier"}
            </Link>
            <Icon icon="solar:alt-arrow-right-linear" className="w-3.5 h-3.5" />
            <span>Cart</span>
          </div>
        }
      />

      <div className="p-6 max-w-4xl mx-auto">
        {lines.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:cart-large-linear" className="w-14 h-14 text-gray-300 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Your cart is empty</h2>
            <p className="text-sm text-gray-500 mb-6">
              Head back to the catalog to add items.
            </p>
            <Link
              href={`/dashboard/admin/marketplace/${supplierId}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700"
            >
              <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
              Continue Shopping
            </Link>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Global warnings */}
            {unavailableCount > 0 && (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-900">
                <div className="flex items-start gap-2">
                  <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>
                    {unavailableCount} item{unavailableCount !== 1 ? "s" : ""} in your cart{" "}
                    {unavailableCount !== 1 ? "are" : "is"} no longer available. Remove{" "}
                    {unavailableCount !== 1 ? "them" : "it"} to submit the order.
                  </span>
                </div>
              </div>
            )}

            {/* Line items */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">
                  {lines.length} item{lines.length !== 1 ? "s" : ""}
                </h2>
                <Link
                  href={`/dashboard/admin/marketplace/${supplierId}`}
                  className="text-sm text-indigo-600 hover:underline"
                >
                  + Add more items
                </Link>
              </div>
              <div className="divide-y divide-gray-100">
                {lines.map((l) => (
                  <CartLineRow
                    // Phase D #72: key on (productId, variantId) since a
                    // product can occupy multiple cart rows now.
                    key={`${l.item.productId}::${l.item.variantId ?? ""}`}
                    line={l}
                    warning={
                      lineWarnings.find(
                        (w) =>
                          w.productId === l.item.productId &&
                          (w.variantId ?? undefined) === l.item.variantId
                      )?.message
                    }
                    onQtyChange={(qty) =>
                      handleQtyChange(l.item.productId, qty, l.item.variantId)
                    }
                    onRemove={() =>
                      handleRemove(l.item.productId, l.item.variantId)
                    }
                    money={money}
                  />
                ))}
              </div>
            </div>

            {/* Delivery location */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Deliver to</h2>
              {locations.length === 0 ? (
                <p className="text-sm text-gray-500">
                  You need at least one active location to place an order.
                </p>
              ) : (
                <select
                  value={locationId}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.city ? ` — ${l.city}` : ""}
                      {l.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Notes */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-3">
                Notes to supplier <span className="text-xs font-normal text-gray-400">(optional)</span>
              </h2>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={commitNotes}
                placeholder="Delivery window, special instructions, PO reference on your side…"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>

            {/* Summary */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600 text-sm">Subtotal</span>
                <span className="text-gray-900 font-semibold">{money(subtotalCents)}</span>
              </div>
              <div className="flex items-center justify-between mb-3 text-xs text-gray-400">
                <span>Taxes</span>
                <span>Calculated by supplier</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-gray-900 font-semibold">Estimated total</span>
                <span className="text-xl font-bold text-gray-900">{money(totalCents)}</span>
              </div>

              {belowMinOrder && profile && (
                <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
                  <div className="flex items-start gap-2">
                    <Icon icon="solar:info-circle-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      This supplier requires a minimum order of{" "}
                      <strong>{money(profile.minOrderCents)}</strong>. Add{" "}
                      <strong>{money(profile.minOrderCents - subtotalCents)}</strong> more to submit.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3">
              <Link
                href={`/dashboard/admin/marketplace/${supplierId}`}
                className="px-5 py-2.5 rounded-xl text-gray-600 border border-gray-200 hover:bg-gray-50 font-medium"
              >
                Keep shopping
              </Link>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                icon="solar:paper-plane-bold"
              >
                {submitting ? "Submitting…" : "Submit Purchase Order"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Inline line-item row ----------
// Split out for readability. All state lives in the parent — this is
// purely presentational + calls back on change/remove.

function CartLineRow({
  line,
  warning,
  onQtyChange,
  onRemove,
  money,
}: {
  // Phase D #72: line shape now carries pre-resolved fields (titleLine,
  // subLine, imageDataUrl, effective min/step). The row reads those
  // directly — never re-resolves variant vs product itself.
  // Phase D #73: also carries the tier applied at the current qty
  // (nullable) + the next unreached tier + how many units to reach it,
  // so the row can render the "add N more to save" hint.
  line: {
    item: { productId: string; variantId?: string; qty: number };
    product: Product | null;
    variant: Variant | null;
    unitPriceCents: number;
    basePriceCents: number;
    appliedTier: { minQty: number; unitPriceCents: number } | null;
    nextTier: { minQty: number; unitPriceCents: number } | null;
    qtyToNextTier?: number;
    effectiveMinQty: number;
    effectiveStepQty: number;
    unitLabel: string;
    imageDataUrl: string | null;
    titleLine: string;
    subLine: string;
    lineTotalCents: number;
    unavailable: boolean;
  };
  warning?: string;
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
  money: (cents: number) => string;
}) {
  if (line.unavailable) {
    return (
      <div className="p-4 flex items-center gap-4 bg-red-50/50">
        <div className="w-14 h-14 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
          <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-red-900">
            {line.titleLine || "Item no longer available"}
          </p>
          <p className="text-xs text-red-700">
            {line.subLine || "The supplier removed or deactivated this product."}
          </p>
        </div>
        <button
          onClick={onRemove}
          className="p-2 rounded-lg text-red-500 hover:bg-red-100"
          title="Remove"
        >
          <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 flex items-start gap-4">
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
        {line.imageDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={line.imageDataUrl}
            alt={line.titleLine}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <Icon icon="solar:box-linear" className="w-6 h-6" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{line.titleLine}</p>
        <p className="text-xs text-gray-500 truncate">
          {line.subLine ? `${line.subLine} · ` : ""}
          {money(line.unitPriceCents)} per {line.unitLabel}
          {/* Phase D #73: strike the base price when a tier is applied. */}
          {line.appliedTier && line.basePriceCents > line.unitPriceCents && (
            <span className="ml-1.5 text-gray-400 line-through">
              {money(line.basePriceCents)}
            </span>
          )}
        </p>
        {/* Phase D #73: applied tier + "add more to save" nudge */}
        {line.appliedTier && (
          <p className="text-[11px] text-emerald-700 font-medium mt-0.5">
            Volume tier at {line.appliedTier.minQty}+ applied
          </p>
        )}
        {line.nextTier && line.qtyToNextTier != null && line.qtyToNextTier > 0 && (
          <p className="text-[11px] text-indigo-700 mt-0.5">
            Add {line.qtyToNextTier} more to save{" "}
            {money(
              (line.appliedTier?.unitPriceCents ?? line.basePriceCents) -
                line.nextTier.unitPriceCents
            )}
            /unit
          </p>
        )}
        {warning && (
          <p className="text-xs text-red-600 mt-1 font-medium">{warning}</p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1 border border-gray-200 rounded-lg">
          <button
            onClick={() => onQtyChange(Math.max(0, line.item.qty - line.effectiveStepQty))}
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 rounded-l-lg"
            aria-label="Decrease"
          >
            <Icon icon="solar:minus-linear" className="w-4 h-4" />
          </button>
          <input
            type="number"
            min={0}
            value={line.item.qty}
            onChange={(e) => {
              const n = parseInt(e.target.value || "0", 10);
              if (Number.isFinite(n)) onQtyChange(Math.max(0, n));
            }}
            className="w-14 text-center text-sm outline-none py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={() => onQtyChange(line.item.qty + line.effectiveStepQty)}
            className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 rounded-r-lg"
            aria-label="Increase"
          >
            <Icon icon="solar:add-square-linear" className="w-4 h-4" />
          </button>
        </div>
        <div className="text-sm font-semibold text-gray-900">{money(line.lineTotalCents)}</div>
        <button
          onClick={onRemove}
          className="text-xs text-red-500 hover:underline"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
