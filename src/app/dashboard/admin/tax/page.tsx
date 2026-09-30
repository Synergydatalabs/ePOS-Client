"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Modal } from "@/components/ui";
import { toast } from "sonner";

interface Category {
  id: string;
  name: string;
  ratePercent: string; // Prisma Decimal → string
  description?: string | null;
  isDefault: boolean;
  isActive: boolean;
  _count?: { products: number; locationOverrides: number };
}

interface Location {
  id: string;
  name: string;
}

interface Override {
  locationId: string;
  taxCategoryId: string;
  ratePercent: string;
}

type Tab = "categories" | "overrides";

export default function TaxPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("categories");
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [overrides, setOverrides] = useState<
    Record<string, string /* rate as string, "" for empty */>
  >({});
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [creatingCategory, setCreatingCategory] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [catRes, locRes, ovrRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/tax-categories`),
        fetch(`/api/tenants/${tenantId}/locations`),
        fetch(`/api/tenants/${tenantId}/tax-overrides`),
      ]);
      const [catData, locData, ovrData] = await Promise.all([
        catRes.json(),
        locRes.json(),
        ovrRes.json(),
      ]);
      if (catData.success) setCategories(catData.categories);
      if (locData.success) setLocations(locData.locations || []);
      if (ovrData.success) {
        const map: Record<string, string> = {};
        for (const o of ovrData.overrides as Override[]) {
          map[`${o.locationId}:${o.taxCategoryId}`] = String(o.ratePercent);
        }
        setOverrides(map);
        setDirty(false);
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteCategory = async (c: Category) => {
    if (!confirm(`Delete "${c.name}"? Products using it will fall back to the default rate.`)) return;
    const res = await fetch(
      `/api/tenants/${tenantId}/tax-categories/${c.id}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      toast.success("Deleted");
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Delete failed");
    }
  };

  const saveOverrides = async () => {
    // Send every cell — server upserts non-null, deletes null. Keeps the
    // UI simple (one Save button) at the cost of one round-trip per
    // dirty grid rather than per cell.
    const payload = {
      overrides: [] as Array<{
        locationId: string;
        taxCategoryId: string;
        ratePercent: number | null;
      }>,
    };
    for (const loc of locations) {
      for (const cat of categories) {
        const key = `${loc.id}:${cat.id}`;
        const v = overrides[key];
        payload.overrides.push({
          locationId: loc.id,
          taxCategoryId: cat.id,
          ratePercent: v === "" || v === undefined ? null : parseFloat(v),
        });
      }
    }
    const res = await fetch(`/api/tenants/${tenantId}/tax-overrides`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      toast.success("Overrides saved");
      setDirty(false);
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Save failed");
    }
  };

  return (
    <div>
      <AdminHeader
        title="Tax"
        subtitle="Categories for product-level tax rules + per-location rate overrides"
      />

      <div className="p-6 space-y-6">
        {/* Tab strip */}
        <div className="card p-1 flex items-center gap-1">
          {(
            [
              { id: "categories" as Tab, label: "Categories", icon: "solar:tag-linear" },
              { id: "overrides" as Tab, label: "Location Overrides", icon: "solar:map-point-linear" },
            ]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 md:flex-initial px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                tab === t.id
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <Icon icon={t.icon} className="w-4 h-4" />
              {t.label}
            </button>
          ))}
          {tab === "categories" && (
            <Button
              className="ml-auto"
              onClick={() => setCreatingCategory(true)}
            >
              <Icon icon="solar:add-circle-bold" className="w-4 h-4 mr-1" />
              New Category
            </Button>
          )}
        </div>

        {tab === "categories" ? (
          <CategoriesTable
            categories={categories}
            loading={loading}
            onEdit={setEditingCategory}
            onDelete={deleteCategory}
          />
        ) : (
          <OverridesGrid
            locations={locations}
            categories={categories}
            overrides={overrides}
            loading={loading}
            dirty={dirty}
            onChange={(k, v) => {
              setOverrides((prev) => ({ ...prev, [k]: v }));
              setDirty(true);
            }}
            onSave={saveOverrides}
          />
        )}
      </div>

      {(creatingCategory || editingCategory) && tenantId && (
        <CategoryForm
          tenantId={tenantId}
          existing={editingCategory}
          onClose={() => {
            setCreatingCategory(false);
            setEditingCategory(null);
          }}
          onSaved={() => {
            setCreatingCategory(false);
            setEditingCategory(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CategoriesTable({
  categories,
  loading,
  onEdit,
  onDelete,
}: {
  categories: Category[];
  loading: boolean;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
}) {
  if (loading) return <Loading />;
  if (categories.length === 0)
    return (
      <div className="card p-12 text-center text-gray-400">
        <Icon icon="solar:tag-bold" className="w-12 h-12 mx-auto mb-3" />
        <p className="font-medium mb-1 text-gray-600">No tax categories yet</p>
        <p className="text-sm">
          Create one to charge different tax rates on different products
          (e.g. hot food vs cold takeaway food for UK VAT).
        </p>
      </div>
    );
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Name</th>
            <th className="text-right px-4 py-3 font-medium">Default Rate</th>
            <th className="text-right px-4 py-3 font-medium">Products</th>
            <th className="text-right px-4 py-3 font-medium">Overrides</th>
            <th className="text-center px-4 py-3 font-medium">Status</th>
            <th className="w-24" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {categories.map((c) => (
            <tr key={c.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">
                  {c.name}
                  {c.isDefault && (
                    <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                      default
                    </span>
                  )}
                </p>
                {c.description && (
                  <p className="text-xs text-gray-500">{c.description}</p>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                {Number(c.ratePercent).toFixed(2)}%
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                {c._count?.products || 0}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                {c._count?.locationOverrides || 0}
              </td>
              <td className="px-4 py-3 text-center">
                <span
                  className={`inline-block px-2 py-0.5 text-xs rounded-full border ${
                    c.isActive
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-gray-50 text-gray-500 border-gray-200"
                  }`}
                >
                  {c.isActive ? "active" : "inactive"}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => onEdit(c)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                    title="Edit"
                  >
                    <Icon icon="solar:pen-2-linear" className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDelete(c)}
                    className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"
                    title="Delete"
                  >
                    <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverridesGrid({
  locations,
  categories,
  overrides,
  loading,
  dirty,
  onChange,
  onSave,
}: {
  locations: Location[];
  categories: Category[];
  overrides: Record<string, string>;
  loading: boolean;
  dirty: boolean;
  onChange: (key: string, v: string) => void;
  onSave: () => void;
}) {
  if (loading) return <Loading />;
  if (locations.length === 0 || categories.length === 0) {
    return (
      <div className="card p-12 text-center text-gray-400">
        <Icon icon="solar:map-point-bold" className="w-12 h-12 mx-auto mb-3" />
        <p className="font-medium mb-1 text-gray-600">
          {categories.length === 0
            ? "Create categories first"
            : "Add locations first"}
        </p>
        <p className="text-sm">
          Overrides let one category charge different rates per store — you
          need both categories and locations to build the grid.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-4">
      <p className="text-sm text-gray-600">
        Leave a cell blank to use the category's default rate. Fill in a
        percent to override for that location — e.g. California charges
        7.25%, Texas charges 6.25% for the same "Standard" category.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-500 text-xs uppercase bg-gray-50 sticky left-0">
                Location
              </th>
              {categories.map((c) => (
                <th
                  key={c.id}
                  className="text-center px-3 py-2 font-medium text-gray-500 text-xs uppercase bg-gray-50 min-w-[110px]"
                >
                  {c.name}
                  <span className="block text-[10px] font-normal normal-case text-gray-400">
                    default {Number(c.ratePercent).toFixed(2)}%
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {locations.map((loc) => (
              <tr key={loc.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-900 bg-white sticky left-0">
                  {loc.name}
                </td>
                {categories.map((c) => {
                  const key = `${loc.id}:${c.id}`;
                  const v = overrides[key] ?? "";
                  return (
                    <td key={c.id} className="px-2 py-1 text-center">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={v}
                        onChange={(e) => onChange(key, e.target.value)}
                        placeholder={Number(c.ratePercent).toFixed(2)}
                        className="w-20 px-2 py-1 rounded border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-center text-sm"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-3">
        {dirty && (
          <span className="text-xs text-amber-600 font-medium">
            Unsaved changes
          </span>
        )}
        <Button onClick={onSave} disabled={!dirty}>
          Save Overrides
        </Button>
      </div>
    </div>
  );
}

function CategoryForm({
  tenantId,
  existing,
  onClose,
  onSaved,
}: {
  tenantId: string;
  existing: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || "");
  const [rate, setRate] = useState(
    existing ? Number(existing.ratePercent).toFixed(2) : "20.00"
  );
  const [description, setDescription] = useState(existing?.description || "");
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    const ratePercent = parseFloat(rate);
    if (isNaN(ratePercent) || ratePercent < 0 || ratePercent > 100) {
      toast.error("Rate must be between 0 and 100");
      return;
    }
    setSubmitting(true);
    try {
      const url = existing
        ? `/api/tenants/${tenantId}/tax-categories/${existing.id}`
        : `/api/tenants/${tenantId}/tax-categories`;
      const res = await fetch(url, {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ratePercent,
          description: description || undefined,
          isDefault,
          isActive,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(existing ? "Updated" : "Created");
        onSaved();
      } else {
        toast.error(data.error || "Save failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="md"
      title={existing ? "Edit Category" : "New Tax Category"}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Standard rate"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Default rate (%)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Used when no location override is set.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description (optional)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. UK VAT 20% — most goods and services"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-gray-700">Set as default</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-gray-700">Active</span>
          </label>
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} fullWidth>
            {existing ? "Save Changes" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Loading() {
  return (
    <div className="card p-12 text-center text-gray-400">
      <Icon
        icon="solar:refresh-linear"
        className="w-8 h-8 animate-spin mx-auto mb-2"
      />
      Loading...
    </div>
  );
}
