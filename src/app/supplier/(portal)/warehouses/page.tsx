"use client";

// Supplier warehouses — Phase D #76.
//
// List / create / edit / delete fulfillment origins the supplier ships
// from. A supplier without any warehouses configured still functions —
// PO's `warehouseId` just stays null and merchants don't see a "Ships
// from" card. Single-location suppliers add one row, mark it default,
// and never touch this page again. Regional distributors use it more.

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Warehouse {
  id: string;
  name: string;
  address: string;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  servesRegions: string[];
  isDefault: boolean;
  isActive: boolean;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
}

const emptyForm = {
  name: "",
  address: "",
  city: "",
  province: "",
  postalCode: "",
  country: "CA",
  phone: "",
  servesRegionsText: "",   // freeform comma-separated for UX simplicity
  isDefault: false,
  isActive: true,
  notes: "",
};

export default function SupplierWarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetch("/api/supplier/warehouses")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setWarehouses(data.warehouses);
      })
      .catch(() => toast.error("Failed to load warehouses"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openNew = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      // If this is the very first warehouse, default to default=true so
      // the supplier doesn't have to remember to flip it.
      isDefault: warehouses.length === 0,
    });
    setModalOpen(true);
  };

  const openEdit = (w: Warehouse) => {
    setEditing(w);
    setForm({
      name: w.name,
      address: w.address,
      city: w.city || "",
      province: w.province || "",
      postalCode: w.postalCode || "",
      country: w.country,
      phone: w.phone || "",
      servesRegionsText: w.servesRegions.join(", "),
      isDefault: w.isDefault,
      isActive: w.isActive,
      notes: w.notes || "",
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    if (!form.address.trim()) return toast.error("Address is required");

    setSaving(true);
    try {
      const payload = {
        name: form.name,
        address: form.address,
        city: form.city,
        province: form.province,
        postalCode: form.postalCode,
        country: form.country,
        phone: form.phone,
        servesRegions: form.servesRegionsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        isDefault: form.isDefault,
        isActive: form.isActive,
        notes: form.notes,
      };
      const url = editing
        ? `/api/supplier/warehouses/${editing.id}`
        : `/api/supplier/warehouses`;
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Save failed");
        return;
      }
      toast.success(editing ? "Warehouse updated" : "Warehouse created");
      setModalOpen(false);
      load();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (w: Warehouse) => {
    if (!confirm(`Remove warehouse "${w.name}"?`)) return;
    try {
      const res = await fetch(`/api/supplier/warehouses/${w.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Delete failed");
        return;
      }
      // Soft-delete message differs from hard-delete — surface it.
      if (data.softDeleted) {
        toast.success(data.message || "Deactivated");
      } else {
        toast.success("Warehouse removed");
      }
      load();
    } catch {
      toast.error("Delete failed");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Warehouses</h1>
          <p className="text-sm text-gray-500 mt-1">
            Fulfillment origins for your orders. The default warehouse is
            used when you don't pick one at acknowledgement.
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700"
        >
          <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
          Add Warehouse
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl" />
          ))}
        </div>
      ) : warehouses.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
          <Icon icon="solar:box-linear" className="w-14 h-14 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            No warehouses yet
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Add at least one so merchants know where their orders ship from.
          </p>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700"
          >
            <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
            Add First Warehouse
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {warehouses.map((w) => (
            <div
              key={w.id}
              className={`bg-white rounded-2xl border p-5 flex items-start gap-4 ${
                w.isActive ? "border-gray-200" : "border-gray-100 opacity-60"
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  w.isDefault
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                <Icon
                  icon={w.isDefault ? "solar:star-bold" : "solar:box-linear"}
                  className="w-5 h-5"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900">{w.name}</h3>
                  {w.isDefault && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800">
                      Default
                    </span>
                  )}
                  {!w.isActive && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 text-gray-600">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-1">{w.address}</p>
                {(w.city || w.province || w.postalCode) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[w.city, w.province, w.postalCode].filter(Boolean).join(", ")}
                    {" · "}
                    {w.country}
                  </p>
                )}
                {w.servesRegions.length > 0 && (
                  <p className="text-xs text-indigo-700 mt-2">
                    Serves: {w.servesRegions.join(", ")}
                  </p>
                )}
                {w.phone && (
                  <p className="text-xs text-gray-500 mt-1">
                    <Icon icon="solar:phone-linear" className="w-3 h-3 inline mr-1" />
                    {w.phone}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => openEdit(w)}
                  className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
                  title="Edit"
                >
                  <Icon icon="solar:pen-linear" className="w-4 h-4" />
                </button>
                <button
                  onClick={() => remove(w)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600"
                  title="Delete"
                >
                  <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {editing ? "Edit Warehouse" : "New Warehouse"}
            </h2>
            <div className="space-y-3">
              <Field label="Warehouse name" required>
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Toronto DC"
                />
              </Field>
              <Field label="Address" required>
                <input
                  className={inputCls}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="123 Warehouse Rd."
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="City">
                  <input
                    className={inputCls}
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </Field>
                <Field label="Province / State">
                  <input
                    className={inputCls}
                    value={form.province}
                    onChange={(e) => setForm({ ...form, province: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Postal / ZIP">
                  <input
                    className={inputCls}
                    value={form.postalCode}
                    onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                  />
                </Field>
                <Field label="Country">
                  <input
                    className={inputCls}
                    value={form.country}
                    onChange={(e) =>
                      setForm({ ...form, country: e.target.value.toUpperCase().slice(0, 2) })
                    }
                    maxLength={2}
                  />
                </Field>
              </div>
              <Field label="Phone">
                <input
                  className={inputCls}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label="Serves regions" hint="Comma-separated (e.g. ON, QC). Empty = serves all regions.">
                <input
                  className={inputCls}
                  value={form.servesRegionsText}
                  onChange={(e) => setForm({ ...form, servesRegionsText: e.target.value })}
                  placeholder="ON, QC, MB"
                />
              </Field>
              <Field label="Notes" hint="Shown to merchants — hours, pickup instructions, etc.">
                <textarea
                  className={inputCls}
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                    className="w-4 h-4"
                  />
                  Default warehouse
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="w-4 h-4"
                  />
                  Active
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl text-gray-700 border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? "Saving…" : editing ? "Save Changes" : "Create Warehouse"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
