"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface PromoCode {
  id: string;
  code: string;
  type: "percentage" | "flat" | "free_ride";
  value: number;
  maxDiscountCap: number | null;
  minFare: number | null;
  validFrom: string;
  validTo: string;
  maxUses: number | null;
  currentUses: number;
  firstRideOnly: boolean;
  isActive: boolean;
  createdAt: string;
}

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  percentage: { label: "Percentage", color: "text-indigo-700", bg: "bg-indigo-50" },
  flat: { label: "Flat Discount", color: "text-teal-700", bg: "bg-teal-50" },
  free_ride: { label: "Free Ride", color: "text-purple-700", bg: "bg-purple-50" },
};

export default function PromosPage() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromoCode | null>(null);

  // Form state
  const [formCode, setFormCode] = useState("");
  const [formType, setFormType] = useState<PromoCode["type"]>("percentage");
  const [formValue, setFormValue] = useState("");
  const [formMaxDiscountCap, setFormMaxDiscountCap] = useState("");
  const [formMinFare, setFormMinFare] = useState("");
  const [formValidFrom, setFormValidFrom] = useState("");
  const [formValidTo, setFormValidTo] = useState("");
  const [formMaxUses, setFormMaxUses] = useState("");
  const [formFirstRideOnly, setFormFirstRideOnly] = useState(false);
  const [formLoading, setFormLoading] = useState(false);

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("tenantId") || localStorage.getItem("tap_active_tenant") || ""
    : "";

  const fetchPromos = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/promos`);
      const data = await res.json();
      if (data.promos) setPromos(data.promos);
    } catch {
      toast.error("Failed to load promo codes");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchPromos();
  }, [fetchPromos]);

  const resetForm = () => {
    setFormCode("");
    setFormType("percentage");
    setFormValue("");
    setFormMaxDiscountCap("");
    setFormMinFare("");
    setFormValidFrom("");
    setFormValidTo("");
    setFormMaxUses("");
    setFormFirstRideOnly(false);
    setEditingPromo(null);
  };

  const openEdit = (promo: PromoCode) => {
    setEditingPromo(promo);
    setFormCode(promo.code);
    setFormType(promo.type);
    setFormValue(String(promo.value));
    setFormMaxDiscountCap(promo.maxDiscountCap ? String(promo.maxDiscountCap) : "");
    setFormMinFare(promo.minFare ? String(promo.minFare) : "");
    setFormValidFrom(promo.validFrom ? promo.validFrom.split("T")[0] : "");
    setFormValidTo(promo.validTo ? promo.validTo.split("T")[0] : "");
    setFormMaxUses(promo.maxUses ? String(promo.maxUses) : "");
    setFormFirstRideOnly(promo.firstRideOnly);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formCode) {
      toast.error("Promo code is required");
      return;
    }
    if (!formValue && formType !== "free_ride") {
      toast.error("Discount value is required");
      return;
    }

    setFormLoading(true);
    try {
      const url = editingPromo
        ? `/api/tenants/${tenantId}/cab/promos/${editingPromo.id}`
        : `/api/tenants/${tenantId}/cab/promos`;
      const method = editingPromo ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: formCode.toUpperCase(),
          type: formType,
          value: parseFloat(formValue) || 0,
          maxDiscountCap: formMaxDiscountCap ? parseFloat(formMaxDiscountCap) : null,
          minFare: formMinFare ? parseFloat(formMinFare) : null,
          validFrom: formValidFrom || null,
          validTo: formValidTo || null,
          maxUses: formMaxUses ? parseInt(formMaxUses) : null,
          firstRideOnly: formFirstRideOnly,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(editingPromo ? "Promo updated" : "Promo created");
        setShowForm(false);
        resetForm();
        fetchPromos();
      } else {
        toast.error(data.error || "Failed to save promo");
      }
    } catch {
      toast.error("Failed to save promo");
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (promo: PromoCode) => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/promos/${promo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !promo.isActive }),
      });
      if (res.ok) {
        toast.success(`Promo ${promo.isActive ? "deactivated" : "activated"}`);
        fetchPromos();
      } else {
        toast.error("Failed to update promo");
      }
    } catch {
      toast.error("Failed to update promo");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this promo code?")) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/promos/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Promo deleted");
        fetchPromos();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete promo");
    }
  };

  const formatDiscount = (promo: PromoCode) => {
    if (promo.type === "percentage") return `${promo.value}% off`;
    if (promo.type === "flat") return `$${promo.value.toFixed(2)} off`;
    return "Free Ride";
  };

  const isExpired = (promo: PromoCode) => {
    if (!promo.validTo) return false;
    return new Date(promo.validTo) < new Date();
  };

  const isMaxedOut = (promo: PromoCode) => {
    if (!promo.maxUses) return false;
    return promo.currentUses >= promo.maxUses;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon icon="solar:refresh-bold" className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Promo Codes</h1>
          <p className="text-gray-500 mt-1">Create and manage promotional discounts</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
        >
          <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
          Create Promo
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              {editingPromo ? "Edit Promo Code" : "New Promo Code"}
            </h3>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="p-2 rounded-lg hover:bg-gray-100">
              <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Promo Code</label>
              <input
                type="text"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="WELCOME50"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 uppercase font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discount Type</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as PromoCode["type"])}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="percentage">Percentage (%)</option>
                <option value="flat">Flat Amount ($)</option>
                <option value="free_ride">Free Ride</option>
              </select>
            </div>
            {formType !== "free_ride" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formType === "percentage" ? "Discount (%)" : "Discount Amount ($)"}
                </label>
                <input
                  type="number"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  placeholder={formType === "percentage" ? "50" : "10.00"}
                  step={formType === "percentage" ? "1" : "0.01"}
                  min="0"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            )}
            {formType === "percentage" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Discount Cap ($)</label>
                <input
                  type="number"
                  value={formMaxDiscountCap}
                  onChange={(e) => setFormMaxDiscountCap(e.target.value)}
                  placeholder="Optional"
                  step="0.01"
                  min="0"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid From</label>
              <input
                type="date"
                value={formValidFrom}
                onChange={(e) => setFormValidFrom(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valid To</label>
              <input
                type="date"
                value={formValidTo}
                onChange={(e) => setFormValidTo(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Uses</label>
              <input
                type="number"
                value={formMaxUses}
                onChange={(e) => setFormMaxUses(e.target.value)}
                placeholder="Unlimited"
                min="1"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Fare ($)</label>
              <input
                type="number"
                value={formMinFare}
                onChange={(e) => setFormMinFare(e.target.value)}
                placeholder="No minimum"
                step="0.01"
                min="0"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formFirstRideOnly}
                  onChange={(e) => setFormFirstRideOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-gray-700">First ride only</span>
              </label>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={handleSubmit}
              disabled={formLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {formLoading ? (
                <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
              ) : (
                <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
              )}
              {formLoading ? "Saving..." : editingPromo ? "Update Promo" : "Create Promo"}
            </button>
            <button
              onClick={() => { setShowForm(false); resetForm(); }}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Promo List */}
      {promos.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <Icon icon="solar:ticket-bold" className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Promo Codes</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Create promo codes to offer discounts to your customers. Percentage, flat, or free ride promos.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {promos.map((promo) => {
            const typeCfg = TYPE_LABELS[promo.type];
            const expired = isExpired(promo);
            const maxedOut = isMaxedOut(promo);
            return (
              <div
                key={promo.id}
                className={`bg-white rounded-2xl shadow-sm border p-5 transition-opacity ${
                  !promo.isActive || expired || maxedOut ? "border-gray-100 opacity-60" : "border-gray-100"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-gray-900 font-mono text-lg">{promo.code}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeCfg.bg} ${typeCfg.color}`}>
                        {typeCfg.label}
                      </span>
                    </div>
                    <p className="text-xl font-bold text-indigo-600">{formatDiscount(promo)}</p>
                    {promo.maxDiscountCap && (
                      <p className="text-xs text-gray-500">Max discount: ${promo.maxDiscountCap.toFixed(2)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(promo)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        promo.isActive ? "bg-green-500" : "bg-gray-300"
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        promo.isActive ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
                  <div>
                    <span className="text-gray-500 text-xs">Validity</span>
                    <p className="text-gray-900">
                      {promo.validFrom ? new Date(promo.validFrom).toLocaleDateString() : "No start"} - {promo.validTo ? new Date(promo.validTo).toLocaleDateString() : "No end"}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Usage</span>
                    <p className="text-gray-900">
                      {promo.currentUses} / {promo.maxUses || "Unlimited"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {promo.firstRideOnly && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                      <Icon icon="solar:star-bold" className="w-3 h-3" />
                      First ride only
                    </span>
                  )}
                  {promo.minFare && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      Min fare: ${promo.minFare.toFixed(2)}
                    </span>
                  )}
                  {expired && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
                      Expired
                    </span>
                  )}
                  {maxedOut && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
                      Max uses reached
                    </span>
                  )}
                </div>

                {/* Usage Progress */}
                {promo.maxUses && (
                  <div className="mb-4">
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all"
                        style={{ width: `${Math.min((promo.currentUses / promo.maxUses) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => openEdit(promo)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                  >
                    <Icon icon="solar:pen-bold" className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(promo.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                  >
                    <Icon icon="solar:trash-bin-2-bold" className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
