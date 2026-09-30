"use client";

// Merchant-facing view of ONE supplier's catalog. Reachable from the
// marketplace index when the merchant clicks a supplier card.
//
// Renders:
//   - Header with the supplier's public profile (name, contact, warehouse)
//   - Category filter chips + search
//   - Product grid with wholesale prices, min/step qty, stock indicator
//   - Per-product "Add to Order" button — DISABLED for v1 with a tooltip
//     explaining PO creation lands in the next release. Wired up in #59.

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Card, Input } from "@/components/ui";
import {
  addToCart,
  getCart,
  cartItemCount,
  Cart,
} from "@/lib/marketplace-cart";

interface SupplierProfile {
  id: string;
  displayName: string;
  legalName: string;
  currency: string;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  aboutText: string | null;
  warehouseAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  } | null;
  categories: string[];
  minOrderCents: number;
  defaultLeadDays: number | null;
}

interface Relationship {
  id: string;
  status: string;
  connectedAt: string;
  totalOrders: number;
  totalSpentCents: number;
}

interface ProductCategory {
  id: string;
  name: string;
  productCount: number;
}

// Phase D #72: variant data on the storefront product row. Fields are
// pre-resolved server-side (variant overrides applied over product
// defaults), so the UI can treat every variant as a self-contained
// orderable item.
interface PriceTier {
  minQty: number;
  unitPriceCents: number;
}

interface Variant {
  id: string;
  displayName: string;
  attributes: Record<string, string>;
  sku: string | null;
  wholesalePriceCents: number;
  retailPriceCents: number | null;
  minOrderQty: number;
  stepQty: number;
  stockIndicator: "in" | "low" | "out" | null;
  stockLevel: number | null;
  image: { id: string; dataUrl: string; altText: string | null } | null;
  // Phase D #73: volume tiers surface on the storefront so merchants can
  // see the discount ladder before adding to cart.
  priceTiers: PriceTier[];
}

interface Product {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  category: { id: string; name: string } | null;
  unitLabel: string;
  wholesalePriceCents: number;
  retailPriceCents: number | null;
  minOrderQty: number;
  stepQty: number;
  leadTimeDays: number | null;
  stockIndicator: "in" | "low" | "out" | null;
  stockLevel: number | null;
  image: { id: string; dataUrl: string; altText: string | null } | null;
  // Phase D #72: variants. Empty = simple product (existing behavior).
  variantAxes: string[];
  variants: Variant[];
  // Phase D #73: product-level tiers (only populated when the product has
  // no variants — for variant products, tiers live on each Variant row).
  priceTiers: PriceTier[];
}

export default function SupplierStorefrontPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = use(params);
  const router = useRouter();

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [profile, setProfile] = useState<SupplierProfile | null>(null);
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  // Cart state — refreshed on Add to Order clicks and on the custom
  // 'marketplace-cart-changed' event (fired by the cart lib on every write).
  const [cart, setCart] = useState<Cart | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) {
      setTenantId(stored);
      setCart(getCart(stored, supplierId));
    }

    // Listen for cart writes from anywhere on this page (or a future
    // shared header) so the badge always reflects the current cart.
    const onCartChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { merchantTenantId: string; supplierTenantId: string };
      if (
        stored &&
        detail?.merchantTenantId === stored &&
        detail?.supplierTenantId === supplierId
      ) {
        setCart(getCart(stored, supplierId));
      }
    };
    window.addEventListener("marketplace-cart-changed", onCartChange);
    return () => window.removeEventListener("marketplace-cart-changed", onCartChange);
  }, [supplierId]);

  // Phase D #72: variant picker modal state. Non-null = modal open on
  // that product. Simple products (no variants) bypass this and add
  // straight to cart via handleAddSimple.
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);

  const handleAddSimple = (product: Product) => {
    if (!tenantId) return;
    if (product.stockIndicator === "out") {
      toast.error(`"${product.name}" is out of stock`);
      return;
    }
    const updated = addToCart(tenantId, supplierId, product.id, product.minOrderQty);
    setCart(updated);
    toast.success(`Added ${product.minOrderQty} × ${product.name}`, {
      action: {
        label: "Review cart",
        onClick: () => router.push(`/dashboard/admin/marketplace/${supplierId}/cart`),
      },
    });
  };

  const handleAddVariant = (product: Product, variant: Variant) => {
    if (!tenantId) return;
    if (variant.stockIndicator === "out") {
      toast.error(`"${variant.displayName}" is out of stock`);
      return;
    }
    const updated = addToCart(
      tenantId,
      supplierId,
      product.id,
      variant.minOrderQty,
      variant.id
    );
    setCart(updated);
    toast.success(`Added ${variant.minOrderQty} × ${product.name} — ${variant.displayName}`, {
      action: {
        label: "Review cart",
        onClick: () => router.push(`/dashboard/admin/marketplace/${supplierId}/cart`),
      },
    });
    setPickerProduct(null);
  };

  // Router into the right handler based on whether the product has variants.
  const handleAddClick = (product: Product) => {
    if (product.variantAxes.length > 0 && product.variants.length > 0) {
      setPickerProduct(product);
    } else {
      handleAddSimple(product);
    }
  };

  useEffect(() => {
    if (!tenantId) return;

    // Two calls in parallel — supplier profile + product list. Products
    // reload on search / category change; profile is stable per mount.
    Promise.all([
      fetch(`/api/tenants/${tenantId}/marketplace/suppliers/${supplierId}`).then((r) =>
        r.json()
      ),
      fetch(
        `/api/tenants/${tenantId}/marketplace/suppliers/${supplierId}/products`
      ).then((r) => r.json()),
    ])
      .then(([profileData, productsData]) => {
        if (!profileData.success) {
          toast.error(profileData.error || "Supplier not found");
          router.replace("/dashboard/admin/marketplace");
          return;
        }
        setProfile(profileData.supplier);
        setRelationship(profileData.relationship);
        setCategories(profileData.productCategories);

        if (productsData.success) {
          setProducts(productsData.products);
        }
      })
      .catch(() => toast.error("Failed to load supplier"))
      .finally(() => setLoading(false));
  }, [tenantId, supplierId, router]);

  // Search / category filter → refetch products. Kept server-side because
  // catalogs may grow large; the profile / category chips stay put.
  useEffect(() => {
    if (!tenantId || !profile) return;
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (categoryFilter) params.set("categoryId", categoryFilter);
    const query = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/tenants/${tenantId}/marketplace/suppliers/${supplierId}/products${query}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setProducts(data.products);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, categoryFilter]);

  if (!tenantId) {
    return (
      <div className="p-12 text-center text-gray-500">Please select a business first</div>
    );
  }

  if (loading || !profile) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-gray-100 rounded-2xl" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 bg-gray-100 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const money = (cents: number) =>
    `${profile.currency} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const addr = profile.warehouseAddress || {};
  const addrParts = [addr.city, addr.region, addr.country].filter(Boolean).join(", ");

  const cartCount = cart ? cartItemCount(cart) : 0;

  return (
    <div>
      <AdminHeader
        title={profile.displayName}
        subtitle={
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link
              href="/dashboard/admin/marketplace"
              className="text-indigo-600 hover:underline"
            >
              Marketplace
            </Link>
            <Icon icon="solar:alt-arrow-right-linear" className="w-3.5 h-3.5" />
            <span>{profile.displayName}</span>
          </div>
        }
        actions={
          cartCount > 0 ? (
            <Link
              href={`/dashboard/admin/marketplace/${supplierId}/cart`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700"
            >
              <Icon icon="solar:cart-large-2-bold" className="w-4 h-4" />
              Review Cart
              <span className="ml-1 px-2 py-0.5 rounded-full bg-white/25 text-xs font-semibold">
                {cartCount}
              </span>
            </Link>
          ) : null
        }
      />

      <div className="p-6 max-w-6xl mx-auto">
        {/* Supplier header card */}
        <div className="p-6 rounded-2xl bg-white border border-gray-200 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <Icon icon="solar:shop-bold" className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-gray-900">{profile.displayName}</h2>
              {profile.aboutText && (
                <p className="text-sm text-gray-600 mt-2 max-w-2xl">{profile.aboutText}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-500">
                {profile.contactEmail && (
                  <a
                    href={`mailto:${profile.contactEmail}`}
                    className="flex items-center gap-1.5 hover:text-indigo-600"
                  >
                    <Icon icon="solar:letter-linear" className="w-4 h-4" />
                    {profile.contactEmail}
                  </a>
                )}
                {profile.contactPhone && (
                  <a
                    href={`tel:${profile.contactPhone}`}
                    className="flex items-center gap-1.5 hover:text-indigo-600"
                  >
                    <Icon icon="solar:phone-linear" className="w-4 h-4" />
                    {profile.contactPhone}
                  </a>
                )}
                {profile.websiteUrl && (
                  <a
                    href={profile.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 hover:text-indigo-600"
                  >
                    <Icon icon="solar:globus-linear" className="w-4 h-4" />
                    Website
                  </a>
                )}
                {addrParts && (
                  <span className="flex items-center gap-1.5">
                    <Icon icon="solar:map-point-linear" className="w-4 h-4" />
                    Ships from {addrParts}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-gray-100 flex flex-wrap items-center gap-6 text-sm">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
                Minimum order
              </p>
              <p className="text-gray-900 font-semibold mt-0.5">
                {money(profile.minOrderCents)}
              </p>
            </div>
            {profile.defaultLeadDays != null && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
                  Typical lead time
                </p>
                <p className="text-gray-900 font-semibold mt-0.5">
                  {profile.defaultLeadDays} day{profile.defaultLeadDays !== 1 ? "s" : ""}
                </p>
              </div>
            )}
            {relationship && relationship.totalOrders > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
                  Your history
                </p>
                <p className="text-gray-900 font-semibold mt-0.5">
                  {relationship.totalOrders} order
                  {relationship.totalOrders !== 1 ? "s" : ""} ·{" "}
                  {money(relationship.totalSpentCents)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <Input
              placeholder="Search products…"
              icon="solar:magnifer-linear"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {categories.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setCategoryFilter("")}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  categoryFilter === ""
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                All ({categories.reduce((sum, c) => sum + c.productCount, 0)})
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategoryFilter(c.id)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                    categoryFilter === c.id
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {c.name} ({c.productCount})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product grid */}
        {products.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:box-linear" className="w-14 h-14 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {searchQuery || categoryFilter
                ? "No products match your filters"
                : "This supplier hasn't listed products yet"}
            </h3>
            {(searchQuery || categoryFilter) && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setCategoryFilter("");
                }}
                className="text-sm text-indigo-600 hover:underline mt-2"
              >
                Clear filters
              </button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((p) => {
              const stockClass =
                p.stockIndicator === "out"
                  ? "bg-red-100 text-red-700"
                  : p.stockIndicator === "low"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700";
              const stockLabel =
                p.stockIndicator === "out"
                  ? "Out of stock"
                  : p.stockIndicator === "low"
                  ? `Low stock${p.stockLevel != null ? ` (${p.stockLevel})` : ""}`
                  : `In stock${p.stockLevel != null ? ` (${p.stockLevel})` : ""}`;

              return (
                <div
                  key={p.id}
                  className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:border-gray-300 transition-colors flex flex-col"
                >
                  {/* Image */}
                  <div className="aspect-video bg-gray-50 relative">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image.dataUrl}
                        alt={p.image.altText || p.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <Icon icon="solar:box-linear" className="w-12 h-12" />
                      </div>
                    )}
                    {p.stockIndicator && (
                      <span
                        className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold ${stockClass}`}
                      >
                        {stockLabel}
                      </span>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-4 flex flex-col flex-1">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                        <p className="text-xs text-gray-500 truncate">
                          {p.category?.name || "Uncategorized"} · {p.unitLabel}
                          {p.sku ? ` · ${p.sku}` : ""}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-gray-900">{money(p.wholesalePriceCents)}</p>
                        {p.retailPriceCents != null && p.retailPriceCents > p.wholesalePriceCents && (
                          <p className="text-xs text-gray-400 line-through">
                            {money(p.retailPriceCents)}
                          </p>
                        )}
                      </div>
                    </div>

                    {p.description && (
                      <p className="text-xs text-gray-500 line-clamp-2 mb-3">{p.description}</p>
                    )}

                    <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                      <span>
                        <strong className="text-gray-700">Min</strong> {p.minOrderQty}
                      </span>
                      {p.stepQty > 1 && (
                        <span>
                          <strong className="text-gray-700">Step</strong> {p.stepQty}
                        </span>
                      )}
                      {p.leadTimeDays != null && (
                        <span>
                          <strong className="text-gray-700">Lead</strong> {p.leadTimeDays}d
                        </span>
                      )}
                      {/* Phase D #73: tier ladder chip. Only for simple
                          products — variant products surface their tiers
                          in the picker modal. Compact "starts at" hint. */}
                      {p.variantAxes.length === 0 && p.priceTiers.length > 0 && (
                        <span className="text-emerald-700 font-medium">
                          Save at{" "}
                          {p.priceTiers
                            .map((t) => `${t.minQty}+`)
                            .join(" · ")}
                        </span>
                      )}
                    </div>

                    {/* Add to Order — adds the product's min-order qty to
                        the cart. Merchant can then adjust qty on the cart
                        page. Out-of-stock items are blocked at click time
                        (extra layer beyond the badge). */}
                    <div className="mt-auto pt-3 border-t border-gray-100">
                      {p.variantAxes.length > 0 && p.variants.length > 0 ? (
                        // Product has variants → picker required. Show a
                        // short summary of what to expect (N options).
                        <button
                          onClick={() => handleAddClick(p)}
                          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                        >
                          <Icon icon="solar:layers-linear" className="w-4 h-4" />
                          Choose Variant · {p.variants.length}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAddClick(p)}
                          disabled={p.stockIndicator === "out"}
                          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          <Icon icon="solar:cart-plus-linear" className="w-4 h-4" />
                          {p.stockIndicator === "out"
                            ? "Out of stock"
                            : `Add ${p.minOrderQty} to Order`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Phase D #72: variant picker modal. Rendered as a plain overlay
          (no external Modal component here — the storefront doesn't need
          the framework's animation, and keeping the modal local avoids
          another Client Component import). */}
      {pickerProduct && (
        <VariantPickerModal
          product={pickerProduct}
          money={money}
          onClose={() => setPickerProduct(null)}
          onPick={(variant) => handleAddVariant(pickerProduct, variant)}
        />
      )}
    </div>
  );
}

// ---------- Variant picker modal ----------
// Lists every ACTIVE variant of a product with its resolved price + stock
// indicator. Click "Add {N} to Order" to add that specific variant to the
// cart. Out-of-stock variants are disabled but still visible so merchants
// can request more when they see it.

function VariantPickerModal({
  product,
  money,
  onClose,
  onPick,
}: {
  product: Product;
  money: (cents: number) => string;
  onClose: () => void;
  onPick: (variant: Variant) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900">{product.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Pick a variant to add to your order —{" "}
              <span className="font-medium text-gray-700">
                {product.variantAxes.join(" × ")}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="divide-y divide-gray-100">
            {product.variants.map((v) => {
              const outOfStock = v.stockIndicator === "out";
              const stockLabel =
                v.stockIndicator === "out"
                  ? "Out of stock"
                  : v.stockIndicator === "low"
                  ? `Low stock${v.stockLevel != null ? ` (${v.stockLevel})` : ""}`
                  : v.stockIndicator === "in"
                  ? `In stock${v.stockLevel != null ? ` (${v.stockLevel})` : ""}`
                  : null;
              const stockClass =
                v.stockIndicator === "out"
                  ? "bg-red-100 text-red-700"
                  : v.stockIndicator === "low"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700";
              return (
                <div key={v.id} className="py-3 flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0">
                    {v.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={v.image.dataUrl}
                        alt={v.displayName}
                        className="w-full h-full object-cover"
                      />
                    ) : product.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image.dataUrl}
                        alt={product.name}
                        className="w-full h-full object-cover opacity-70"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <Icon icon="solar:box-linear" className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900 truncate">{v.displayName}</p>
                      {stockLabel && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${stockClass}`}>
                          {stockLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {v.sku ? `${v.sku} · ` : ""}
                      {money(v.wholesalePriceCents)} per {product.unitLabel}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      Min {v.minOrderQty}
                      {v.stepQty > 1 ? ` · step ${v.stepQty}` : ""}
                    </p>
                    {/* Phase D #73: tier ladder chips — merchant sees the
                        discount schedule up-front. Server is authoritative
                        on pricing, this is just the sales pitch. */}
                    {v.priceTiers.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {v.priceTiers.map((t) => (
                          <span
                            key={t.minQty}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 font-medium"
                          >
                            {t.minQty}+ · {money(t.unitPriceCents)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onPick(v)}
                    disabled={outOfStock}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    <Icon icon="solar:cart-plus-linear" className="w-4 h-4" />
                    Add {v.minOrderQty}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
