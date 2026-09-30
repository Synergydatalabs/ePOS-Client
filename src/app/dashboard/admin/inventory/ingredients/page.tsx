"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Select, Card, Badge, Modal, Toggle } from "@/components/ui";

interface Unit {
  id: string;
  name: string;
  abbreviation: string;
}

interface Allergen {
  id: string;
  name: string;
  icon: string;
}

interface Ingredient {
  id: string;
  name: string;
  sku?: string;
  unitId?: string;
  unit?: Unit;
  costPerUnit: number;
  lowStockThreshold: number;
  isActive: boolean;
  allergens?: { allergen: Allergen }[];
  _count?: { recipes: number };
  // Phase D #77: marketplace auto-reorder
  autoReorderEnabled?: boolean;
  reorderQty?: number | null;
  preferredSupplierTenantId?: string | null;
  preferredSupplierProductId?: string | null;
}

interface MarketplaceSupplier {
  supplierTenantId: string;
  name: string;
  currency: string;
}

interface MarketplaceProduct {
  id: string;
  name: string;
  sku: string | null;
  unitLabel: string;
  wholesalePriceCents: number;
  variantAxes?: string[];
  isActive: boolean;
}

export default function IngredientsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>([]);

  // Form data
  const [formData, setFormData] = useState({
    name: "",
    sku: "",
    unitId: "",
    costPerUnit: "",
    lowStockThreshold: "10",
    isActive: true,
    // Phase D #77 auto-reorder
    autoReorderEnabled: false,
    reorderQty: "",
    preferredSupplierTenantId: "",
    preferredSupplierProductId: "",
  });

  // Phase D #77: marketplace suppliers + their products for the picker
  const [marketplaceSuppliers, setMarketplaceSuppliers] = useState<MarketplaceSupplier[]>([]);
  const [supplierProducts, setSupplierProducts] = useState<MarketplaceProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [runningNow, setRunningNow] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;

    try {
      const [ingredientsRes, unitsRes, allergensRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/ingredients`),
        fetch(`/api/tenants/${tenantId}/units`),
        fetch(`/api/tenants/${tenantId}/allergens`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);

      const [ingredientsData, unitsData, allergensData, settingsData] = await Promise.all([
        ingredientsRes.json(),
        unitsRes.json(),
        allergensRes.json(),
        settingsRes.json(),
      ]);

      if (ingredientsData.success) setIngredients(ingredientsData.ingredients);
      if (unitsData.success) setUnits(unitsData.units);
      if (allergensData.success) setAllergens(allergensData.allergens);
      if (settingsData.success) setCurrency(settingsData.tenant?.currency || "CAD");

      // Phase D #77: load marketplace suppliers for the auto-reorder
      // picker. Failure here is non-fatal — merchant just can't configure
      // auto-reorder until suppliers come back.
      try {
        const suppliersRes = await fetch(`/api/tenants/${tenantId}/marketplace/suppliers`);
        const suppliersData = await suppliersRes.json();
        if (suppliersData.success) setMarketplaceSuppliers(suppliersData.suppliers);
      } catch {
        // ignore — the picker section will show an empty state
      }
    } catch (error) {
      toast.error("Failed to load ingredients");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Load a supplier's products when the merchant picks one — for the
  // product picker in the auto-reorder section.
  const loadSupplierProducts = useCallback(
    async (supplierTenantId: string) => {
      if (!supplierTenantId || !tenantId) {
        setSupplierProducts([]);
        return;
      }
      setLoadingProducts(true);
      try {
        const res = await fetch(
          `/api/tenants/${tenantId}/marketplace/suppliers/${supplierTenantId}/products`
        );
        const data = await res.json();
        if (data.success) {
          // Endpoint already filters to isActive=true — no client-side
          // filter needed.
          setSupplierProducts(data.products || []);
        } else {
          setSupplierProducts([]);
        }
      } catch {
        setSupplierProducts([]);
      } finally {
        setLoadingProducts(false);
      }
    },
    [tenantId]
  );

  // When editing modal opens with a preferred supplier already set, load
  // that supplier's products so the current product shows in the dropdown.
  useEffect(() => {
    if (formData.preferredSupplierTenantId) {
      loadSupplierProducts(formData.preferredSupplierTenantId);
    } else {
      setSupplierProducts([]);
    }
  }, [formData.preferredSupplierTenantId, loadSupplierProducts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const openModal = (ingredient?: Ingredient) => {
    if (ingredient) {
      setEditing(ingredient);
      setFormData({
        name: ingredient.name,
        sku: ingredient.sku || "",
        unitId: ingredient.unitId || "",
        costPerUnit: (ingredient.costPerUnit / 100).toFixed(2),
        lowStockThreshold: ingredient.lowStockThreshold.toString(),
        isActive: ingredient.isActive,
        autoReorderEnabled: ingredient.autoReorderEnabled ?? false,
        reorderQty:
          ingredient.reorderQty != null ? String(ingredient.reorderQty) : "",
        preferredSupplierTenantId: ingredient.preferredSupplierTenantId ?? "",
        preferredSupplierProductId: ingredient.preferredSupplierProductId ?? "",
      });
      setSelectedAllergens(ingredient.allergens?.map((a) => a.allergen.id) || []);
    } else {
      setEditing(null);
      setFormData({
        name: "",
        sku: "",
        unitId: "",
        costPerUnit: "",
        lowStockThreshold: "10",
        isActive: true,
        autoReorderEnabled: false,
        reorderQty: "",
        preferredSupplierTenantId: "",
        preferredSupplierProductId: "",
      });
      setSelectedAllergens([]);
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Ingredient name is required");
      return;
    }

    try {
      // Auto-reorder validation: if enabled, all three configuration
      // fields must be filled. Prevents silent no-ops later.
      if (formData.autoReorderEnabled) {
        if (!formData.preferredSupplierTenantId) {
          toast.error("Pick a preferred supplier to enable auto-reorder");
          return;
        }
        if (!formData.preferredSupplierProductId) {
          toast.error("Pick a supplier product to auto-reorder");
          return;
        }
        const q = parseFloat(formData.reorderQty);
        if (!q || q <= 0) {
          toast.error("Enter a reorder quantity greater than zero");
          return;
        }
      }

      const payload = {
        name: formData.name,
        sku: formData.sku || undefined,
        unitId: formData.unitId || undefined,
        costPerUnit: formData.costPerUnit ? Math.round(parseFloat(formData.costPerUnit) * 100) : 0,
        lowStockThreshold: parseInt(formData.lowStockThreshold) || 10,
        isActive: formData.isActive,
        allergenIds: selectedAllergens,
        autoReorderEnabled: formData.autoReorderEnabled,
        reorderQty: formData.reorderQty ? parseFloat(formData.reorderQty) : null,
        preferredSupplierTenantId: formData.preferredSupplierTenantId || null,
        preferredSupplierProductId: formData.preferredSupplierProductId || null,
      };

      const url = editing
        ? `/api/tenants/${tenantId}/ingredients/${editing.id}`
        : `/api/tenants/${tenantId}/ingredients`;

      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(editing ? "Ingredient updated" : "Ingredient created");
        setShowModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to save ingredient");
      }
    } catch (error) {
      toast.error("Failed to save ingredient");
    }
  };

  const handleDelete = async (ingredient: Ingredient) => {
    if (!confirm(`Delete "${ingredient.name}"?`)) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/ingredients/${ingredient.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Ingredient deleted");
        loadData();
      } else {
        toast.error(data.error || "Failed to delete ingredient");
      }
    } catch (error) {
      toast.error("Failed to delete ingredient");
    }
  };

  // Filter ingredients
  const filteredIngredients = ingredients.filter(
    (ingredient) =>
      !searchQuery ||
      ingredient.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ingredient.sku?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Please select a business first</p>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Ingredients"
        subtitle={`${ingredients.length} ingredient${ingredients.length !== 1 ? "s" : ""} in your inventory`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon="solar:refresh-circle-linear"
              disabled={runningNow}
              onClick={async () => {
                if (!tenantId) return;
                setRunningNow(true);
                try {
                  const res = await fetch(
                    `/api/tenants/${tenantId}/marketplace/auto-reorder`,
                    { method: "POST" }
                  );
                  const data = await res.json();
                  if (!res.ok || !data.success) {
                    toast.error(data?.error || "Auto-reorder failed");
                    return;
                  }
                  const r = data.result;
                  if (r.posCreated === 0) {
                    toast.success(
                      r.scanned === 0
                        ? "No ingredients have auto-reorder enabled yet"
                        : `Scanned ${r.scanned} — nothing below par right now`
                    );
                  } else {
                    toast.success(
                      `Created ${r.posCreated} PO${r.posCreated !== 1 ? "s" : ""} (${r.itemsOrdered} item${r.itemsOrdered !== 1 ? "s" : ""})`
                    );
                  }
                  if (r.skipped.length > 0) {
                    console.warn("[AUTO-REORDER] Skipped items:", r.skipped);
                  }
                } catch {
                  toast.error("Auto-reorder failed");
                } finally {
                  setRunningNow(false);
                }
              }}
            >
              {runningNow ? "Scanning…" : "Run Auto-Reorder Now"}
            </Button>
            <Button icon="solar:add-circle-bold" onClick={() => openModal()}>
              Add Ingredient
            </Button>
          </div>
        }
      />

      <div className="p-6">
        {/* Search */}
        <div className="mb-6">
          <Input
            placeholder="Search ingredients..."
            icon="solar:magnifer-linear"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
          />
        </div>

        {/* Ingredients Table */}
        {loading ? (
          <Card padding="none">
            <div className="animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 border-b border-gray-100">
                  <div className="w-10 h-10 bg-gray-200 rounded-xl" />
                  <div className="flex-1">
                    <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : filteredIngredients.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:box-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No ingredients found</h3>
            <p className="text-gray-500 mb-4">
              {searchQuery
                ? "Try adjusting your search"
                : "Add ingredients to track inventory and calculate food costs"}
            </p>
            {!searchQuery && (
              <Button icon="solar:add-circle-bold" onClick={() => openModal()}>
                Add First Ingredient
              </Button>
            )}
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th>Unit</th>
                    <th>Cost/Unit</th>
                    <th>Low Stock</th>
                    <th>Allergens</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIngredients.map((ingredient) => (
                    <tr key={ingredient.id}>
                      <td>
                        <div>
                          <p className="font-medium text-gray-900">{ingredient.name}</p>
                          {ingredient.sku && (
                            <p className="text-xs text-gray-400">SKU: {ingredient.sku}</p>
                          )}
                          {ingredient._count?.recipes !== undefined && ingredient._count.recipes > 0 && (
                            <p className="text-xs text-gray-400">
                              Used in {ingredient._count.recipes} recipe(s)
                            </p>
                          )}
                        </div>
                      </td>
                      <td>
                        {ingredient.unit ? (
                          <Badge variant="gray">{ingredient.unit.abbreviation}</Badge>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="font-medium">{formatPrice(ingredient.costPerUnit)}</td>
                      <td>{ingredient.lowStockThreshold}</td>
                      <td>
                        {ingredient.allergens && ingredient.allergens.length > 0 ? (
                          <div className="flex items-center gap-1">
                            {ingredient.allergens.map((a) => (
                              <span key={a.allergen.id} title={a.allergen.name} className="text-lg">
                                {a.allergen.icon}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td>
                        {ingredient.isActive ? (
                          <Badge variant="success" dot>Active</Badge>
                        ) : (
                          <Badge variant="danger">Inactive</Badge>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openModal(ingredient)}
                            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                          >
                            <Icon icon="solar:pen-linear" className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDelete(ingredient)}
                            className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                          >
                            <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Ingredient Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? "Edit Ingredient" : "New Ingredient"}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Ingredient Name"
              placeholder="e.g., Chicken Breast"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <Input
              label="SKU"
              placeholder="e.g., ING-001"
              value={formData.sku}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="Unit of Measure"
              options={[
                { value: "", label: "Select unit" },
                ...units.map((u) => ({ value: u.id, label: `${u.name} (${u.abbreviation})` })),
              ]}
              value={formData.unitId}
              onChange={(e) => setFormData({ ...formData, unitId: e.target.value })}
            />
            <Input
              label="Cost per Unit"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={formData.costPerUnit}
              onChange={(e) => setFormData({ ...formData, costPerUnit: e.target.value })}
              icon="solar:dollar-linear"
            />
            <Input
              label="Low Stock Alert"
              type="number"
              min={0}
              value={formData.lowStockThreshold}
              onChange={(e) => setFormData({ ...formData, lowStockThreshold: e.target.value })}
              helperText="Alert when stock falls below"
            />
          </div>

          {/* Allergens */}
          {allergens.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Allergens
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {allergens.map((allergen) => (
                  <label
                    key={allergen.id}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
                      selectedAllergens.includes(allergen.id)
                        ? "border-amber-500 bg-amber-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAllergens.includes(allergen.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAllergens([...selectedAllergens, allergen.id]);
                        } else {
                          setSelectedAllergens(selectedAllergens.filter((id) => id !== allergen.id));
                        }
                      }}
                      className="w-4 h-4 rounded text-amber-500"
                    />
                    <span className="text-lg">{allergen.icon}</span>
                    <span className="text-sm text-gray-700">{allergen.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Phase D #77: auto-reorder from par levels. Toggling ON reveals
              the supplier + product + qty picker. When enabled AND stock
              drops below Low Stock Alert, we auto-submit a PO to the
              picked supplier for the given qty. */}
          <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
            <Toggle
              label="Auto-reorder from Marketplace"
              description="Automatically submit a PO when this ingredient drops below the low-stock alert"
              checked={formData.autoReorderEnabled}
              onChange={(checked) => setFormData({ ...formData, autoReorderEnabled: checked })}
            />

            {formData.autoReorderEnabled && (
              <div className="mt-4 space-y-3 pl-1">
                {marketplaceSuppliers.length === 0 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    No marketplace suppliers connected yet.{" "}
                    <a href="/dashboard/admin/marketplace" className="underline font-medium">
                      Connect a supplier
                    </a>{" "}
                    first, then enable auto-reorder.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Preferred Supplier"
                        options={[
                          { value: "", label: "Select supplier" },
                          ...marketplaceSuppliers.map((s) => ({
                            value: s.supplierTenantId,
                            label: s.name,
                          })),
                        ]}
                        value={formData.preferredSupplierTenantId}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            preferredSupplierTenantId: e.target.value,
                            preferredSupplierProductId: "", // reset product on supplier change
                          })
                        }
                      />
                      <Select
                        label="Product"
                        options={[
                          {
                            value: "",
                            label: loadingProducts
                              ? "Loading products…"
                              : formData.preferredSupplierTenantId
                              ? "Select product"
                              : "Pick a supplier first",
                          },
                          ...supplierProducts
                            .filter((p) => (p.variantAxes ?? []).length === 0)
                            .map((p) => ({
                              value: p.id,
                              label: `${p.name}${p.sku ? ` · ${p.sku}` : ""}`,
                            })),
                        ]}
                        value={formData.preferredSupplierProductId}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            preferredSupplierProductId: e.target.value,
                          })
                        }
                        disabled={!formData.preferredSupplierTenantId || loadingProducts}
                      />
                    </div>
                    <Input
                      label="Reorder Quantity"
                      type="number"
                      step="0.01"
                      min={0}
                      value={formData.reorderQty}
                      onChange={(e) =>
                        setFormData({ ...formData, reorderQty: e.target.value })
                      }
                      helperText="How many units to order each time. Rounds up to the supplier's min/step."
                    />
                    {supplierProducts.filter((p) => (p.variantAxes ?? []).length > 0).length > 0 && (
                      <p className="text-xs text-gray-500">
                        Products with variants aren't shown — auto-reorder v1 only supports
                        simple products. Pick a specific variant via a manual PO for those.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <Toggle
            label="Active"
            description="Ingredient is available for use"
            checked={formData.isActive}
            onChange={(checked) => setFormData({ ...formData, isActive: checked })}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editing ? "Save Changes" : "Create Ingredient"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
