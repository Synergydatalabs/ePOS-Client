"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { Button, Input, Modal } from "@/components/ui";
import ProductModal, { EditableProduct } from "./ProductModal";
import ImportModal from "./ImportModal";

interface Category {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  _count?: { products: number };
}

interface ProductRow {
  id: string;
  sku: string | null;
  name: string;
  unitLabel: string;
  wholesalePriceCents: number;
  minOrderQty: number;
  stepQty: number;
  trackInventory: boolean;
  stockLevel: number | null;
  lowStockThreshold: number | null;
  isPublic: boolean;
  isActive: boolean;
  category: { id: string; name: string } | null;
  images: { id: string; dataUrl: string; altText: string | null }[];
  // Phase D #71: variant count badge on the card
  _count?: { variants: number };
}

export default function SupplierProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currency, setCurrency] = useState("CAD");
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [showInactive, setShowInactive] = useState(false);

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<EditableProduct | null>(null);

  const [categoriesModalOpen, setCategoriesModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      // Currency comes from the supplier tenant — needed for the price columns.
      // Prefetched here and cached; changes on next mount if the tenant switches.
      const [meRes, catsRes, prodsRes] = await Promise.all([
        fetch("/api/supplier/me"),
        fetch("/api/supplier/product-categories"),
        fetch("/api/supplier/products"),
      ]);
      const meData = await meRes.json();
      const catsData = await catsRes.json();
      const prodsData = await prodsRes.json();
      if (meData.success) setCurrency(meData.tenant.currency);
      if (catsData.success) setCategories(catsData.categories);
      if (prodsData.success) setProducts(prodsData.products);
    } catch {
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditingProduct(null);
    setProductModalOpen(true);
  };
  const openEdit = (p: ProductRow) => {
    setEditingProduct({ id: p.id, name: p.name });
    setProductModalOpen(true);
  };

  const handleDelete = async (p: ProductRow) => {
    if (
      !confirm(
        `Delete "${p.name}"? This can't be undone. (If you just want to hide it, edit the product and turn Available off.)`
      )
    )
      return;
    const res = await fetch(`/api/supplier/products/${p.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Product deleted");
      load();
    } else {
      const data = await res.json();
      toast.error(data.error || "Failed to delete");
    }
  };

  // Client-side filter — cheap for small catalogs, saves a round-trip.
  const filtered = products.filter((p) => {
    if (!showInactive && !p.isActive) return false;
    if (categoryFilter && p.category?.id !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !p.name.toLowerCase().includes(q) &&
        !(p.sku || "").toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const money = (cents: number) =>
    `${currency} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-500 mt-1">
            {products.length} product{products.length !== 1 ? "s" : ""} · {categories.length}{" "}
            categor{categories.length !== 1 ? "ies" : "y"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            icon="solar:folder-with-files-linear"
            onClick={() => setCategoriesModalOpen(true)}
          >
            Categories
          </Button>
          <Button
            variant="secondary"
            icon="solar:upload-linear"
            onClick={() => setImportModalOpen(true)}
          >
            Import CSV
          </Button>
          <Button icon="solar:add-circle-bold" onClick={openAdd}>
            Add Product
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <Input
            placeholder="Search by name or SKU"
            icon="solar:magnifer-linear"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show hidden
        </label>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-52 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 mx-auto mb-5 flex items-center justify-center">
            <Icon icon="solar:box-bold" className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {products.length === 0 ? "No products yet" : "No products match your filters"}
          </h2>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
            {products.length === 0
              ? "Add your first product manually — bulk import from Excel/CSV is coming next."
              : "Try clearing the search or category filter."}
          </p>
          {products.length === 0 && (
            <Button icon="solar:add-circle-bold" onClick={openAdd}>
              Add First Product
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const primary = p.images[0];
            const lowStock =
              p.trackInventory &&
              p.stockLevel != null &&
              p.lowStockThreshold != null &&
              p.stockLevel <= p.lowStockThreshold;
            return (
              <div
                key={p.id}
                className={`bg-white rounded-2xl border overflow-hidden transition-colors ${
                  p.isActive ? "border-gray-200 hover:border-gray-300" : "border-gray-100 opacity-70"
                }`}
              >
                {/* Image / placeholder */}
                <div className="aspect-video bg-gray-50 relative">
                  {primary ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={primary.dataUrl}
                      alt={primary.altText || p.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <Icon icon="solar:box-linear" className="w-12 h-12" />
                    </div>
                  )}
                  <div className="absolute top-2 right-2 flex gap-1">
                    {!p.isActive && (
                      <span className="px-2 py-0.5 rounded-full bg-gray-800 text-white text-[10px] font-semibold">
                        HIDDEN
                      </span>
                    )}
                    {p.isPublic && p.isActive && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-semibold">
                        PUBLIC
                      </span>
                    )}
                    {(p._count?.variants ?? 0) > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-semibold">
                        {p._count!.variants} VARIANT{p._count!.variants !== 1 ? "S" : ""}
                      </span>
                    )}
                    {lowStock && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-semibold">
                        LOW STOCK
                      </span>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                      <p className="text-xs text-gray-500 truncate">
                        {p.category?.name || "Uncategorized"} · {p.unitLabel}
                        {p.sku ? ` · ${p.sku}` : ""}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-gray-900">{money(p.wholesalePriceCents)}</p>
                      <p className="text-xs text-gray-500">per {p.unitLabel}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-3 mb-3">
                    <span>
                      <strong className="text-gray-700">Min</strong> {p.minOrderQty}
                    </span>
                    {p.stepQty > 1 && (
                      <span>
                        <strong className="text-gray-700">Step</strong> {p.stepQty}
                      </span>
                    )}
                    {p.trackInventory && p.stockLevel != null && (
                      <span>
                        <strong className={lowStock ? "text-amber-700" : "text-gray-700"}>
                          Stock
                        </strong>{" "}
                        {p.stockLevel}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-1 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => openEdit(p)}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                      title="Edit"
                    >
                      <Icon icon="solar:pen-linear" className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(p)}
                      className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                      title="Delete"
                    >
                      <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Product modal */}
      <ProductModal
        isOpen={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        product={editingProduct}
        categories={categories}
        currency={currency}
        onSaved={load}
      />

      {/* Categories management modal */}
      <CategoriesModal
        isOpen={categoriesModalOpen}
        onClose={() => setCategoriesModalOpen(false)}
        categories={categories}
        onChanged={load}
      />

      {/* CSV bulk-import modal */}
      <ImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={load}
      />
    </div>
  );
}

// ---------- Inline categories modal ----------
// Kept in this file because it's tiny (add + rename + delete) and shares the
// same list state as the parent. Extracting to its own file would be
// premature — the whole thing is under 100 lines.

function CategoriesModal({
  isOpen,
  onClose,
  categories,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const addCategory = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/supplier/product-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Category added");
        setNewName("");
        onChanged();
      } else {
        toast.error(data.error || "Failed to add");
      }
    } finally {
      setSaving(false);
    }
  };

  const renameCategory = async (id: string) => {
    if (!editingName.trim()) return;
    const res = await fetch(`/api/supplier/product-categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingName.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      toast.success("Renamed");
      setEditingId(null);
      onChanged();
    } else {
      toast.error(data.error || "Failed to rename");
    }
  };

  const deleteCategory = async (c: Category) => {
    const count = c._count?.products || 0;
    const msg =
      count > 0
        ? `Delete "${c.name}"? ${count} product${count !== 1 ? "s" : ""} will move to Uncategorized.`
        : `Delete "${c.name}"?`;
    if (!confirm(msg)) return;
    const res = await fetch(`/api/supplier/product-categories/${c.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      onChanged();
    } else {
      const data = await res.json();
      toast.error(data.error || "Failed to delete");
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Categories" size="md">
      <div className="space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Add a new category…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCategory()}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
          <Button onClick={addCategory} disabled={saving || !newName.trim()}>
            Add
          </Button>
        </div>

        {categories.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500">
            No categories yet — add your first one above.
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 p-3 rounded-xl border border-gray-100 hover:border-gray-200"
              >
                {editingId === c.id ? (
                  <>
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && renameCategory(c.id)}
                      className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      autoFocus
                    />
                    <button
                      onClick={() => renameCategory(c.id)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 rounded-lg text-gray-500 text-xs hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{c.name}</p>
                      <p className="text-xs text-gray-500">
                        {(c._count?.products || 0)} product
                        {(c._count?.products || 0) !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingId(c.id);
                        setEditingName(c.name);
                      }}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                    >
                      <Icon icon="solar:pen-linear" className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteCategory(c)}
                      className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                    >
                      <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
