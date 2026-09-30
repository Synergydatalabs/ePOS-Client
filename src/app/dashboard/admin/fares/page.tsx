"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface FareRule {
  id: string;
  name: string;
  vehicleType: "sedan" | "suv" | "van" | "luxury" | "accessible";
  isDefault: boolean;
  baseFare: number;
  perKm: number;
  perMinute: number;
  waitingPerMinute: number;
  minimumFare: number;
  bookingFee: number;
  cancellationFee: number;
  peakHoursMultiplier: number;
  peakHoursStart: string | null;
  peakHoursEnd: string | null;
  nightRateMultiplier: number;
  nightRateStart: string | null;
  nightRateEnd: string | null;
  weekendMultiplier: number;
  holidayMultiplier: number;
  isActive: boolean;
  createdAt: string;
}

const VEHICLE_TYPES = [
  { value: "sedan", label: "Sedan", icon: "solar:car-bold" },
  { value: "suv", label: "SUV", icon: "solar:car-bold" },
  { value: "van", label: "Van", icon: "solar:bus-bold" },
  { value: "luxury", label: "Luxury", icon: "solar:star-bold" },
  { value: "accessible", label: "Accessible", icon: "solar:accessibility-bold" },
];

export default function FaresPage() {
  const [fareRules, setFareRules] = useState<FareRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<FareRule | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: "",
    vehicleType: "sedan" as FareRule["vehicleType"],
    isDefault: false,
    baseFare: "5.00",
    perKm: "1.50",
    perMinute: "0.30",
    waitingPerMinute: "0.50",
    minimumFare: "8.00",
    bookingFee: "2.00",
    cancellationFee: "5.00",
    peakHoursMultiplier: "1.5",
    peakHoursStart: "07:00",
    peakHoursEnd: "09:00",
    nightRateMultiplier: "1.25",
    nightRateStart: "22:00",
    nightRateEnd: "05:00",
    weekendMultiplier: "1.0",
    holidayMultiplier: "1.5",
  });
  const [formLoading, setFormLoading] = useState(false);

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("tenantId") || localStorage.getItem("tap_active_tenant") || ""
    : "";

  const fetchFareRules = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/fares`);
      const data = await res.json();
      if (data.fareRules) setFareRules(data.fareRules);
    } catch {
      toast.error("Failed to load fare rules");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchFareRules();
  }, [fetchFareRules]);

  const resetForm = () => {
    setForm({
      name: "",
      vehicleType: "sedan",
      isDefault: false,
      baseFare: "5.00",
      perKm: "1.50",
      perMinute: "0.30",
      waitingPerMinute: "0.50",
      minimumFare: "8.00",
      bookingFee: "2.00",
      cancellationFee: "5.00",
      peakHoursMultiplier: "1.5",
      peakHoursStart: "07:00",
      peakHoursEnd: "09:00",
      nightRateMultiplier: "1.25",
      nightRateStart: "22:00",
      nightRateEnd: "05:00",
      weekendMultiplier: "1.0",
      holidayMultiplier: "1.5",
    });
    setEditingRule(null);
  };

  const openEdit = (rule: FareRule) => {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      vehicleType: rule.vehicleType,
      isDefault: rule.isDefault,
      baseFare: String(rule.baseFare),
      perKm: String(rule.perKm),
      perMinute: String(rule.perMinute),
      waitingPerMinute: String(rule.waitingPerMinute),
      minimumFare: String(rule.minimumFare),
      bookingFee: String(rule.bookingFee),
      cancellationFee: String(rule.cancellationFee),
      peakHoursMultiplier: String(rule.peakHoursMultiplier),
      peakHoursStart: rule.peakHoursStart || "07:00",
      peakHoursEnd: rule.peakHoursEnd || "09:00",
      nightRateMultiplier: String(rule.nightRateMultiplier),
      nightRateStart: rule.nightRateStart || "22:00",
      nightRateEnd: rule.nightRateEnd || "05:00",
      weekendMultiplier: String(rule.weekendMultiplier),
      holidayMultiplier: String(rule.holidayMultiplier),
    });
    setShowForm(true);
  };

  const updateForm = (key: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name) {
      toast.error("Fare rule name is required");
      return;
    }

    setFormLoading(true);
    try {
      const url = editingRule
        ? `/api/tenants/${tenantId}/cab/fares/${editingRule.id}`
        : `/api/tenants/${tenantId}/cab/fares`;
      const method = editingRule ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          vehicleType: form.vehicleType,
          isDefault: form.isDefault,
          baseFare: parseFloat(form.baseFare) || 0,
          perKm: parseFloat(form.perKm) || 0,
          perMinute: parseFloat(form.perMinute) || 0,
          waitingPerMinute: parseFloat(form.waitingPerMinute) || 0,
          minimumFare: parseFloat(form.minimumFare) || 0,
          bookingFee: parseFloat(form.bookingFee) || 0,
          cancellationFee: parseFloat(form.cancellationFee) || 0,
          peakHoursMultiplier: parseFloat(form.peakHoursMultiplier) || 1,
          peakHoursStart: form.peakHoursStart || null,
          peakHoursEnd: form.peakHoursEnd || null,
          nightRateMultiplier: parseFloat(form.nightRateMultiplier) || 1,
          nightRateStart: form.nightRateStart || null,
          nightRateEnd: form.nightRateEnd || null,
          weekendMultiplier: parseFloat(form.weekendMultiplier) || 1,
          holidayMultiplier: parseFloat(form.holidayMultiplier) || 1,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(editingRule ? "Fare rule updated" : "Fare rule created");
        setShowForm(false);
        resetForm();
        fetchFareRules();
      } else {
        toast.error(data.error || "Failed to save fare rule");
      }
    } catch {
      toast.error("Failed to save fare rule");
    } finally {
      setFormLoading(false);
    }
  };

  // Group fare rules by vehicle type
  const groupedRules: Record<string, FareRule[]> = {};
  fareRules.forEach((rule) => {
    if (!groupedRules[rule.vehicleType]) groupedRules[rule.vehicleType] = [];
    groupedRules[rule.vehicleType].push(rule);
  });

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
          <h1 className="text-2xl font-bold text-gray-900">Fare Configuration</h1>
          <p className="text-gray-500 mt-1">Set pricing rules for each vehicle type</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
        >
          <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
          Add Fare Rule
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-gray-900">
              {editingRule ? "Edit Fare Rule" : "New Fare Rule"}
            </h3>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="p-2 rounded-lg hover:bg-gray-100">
              <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateForm("name", e.target.value)}
                placeholder="Standard Sedan Rate"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
              <select
                value={form.vehicleType}
                onChange={(e) => updateForm("vehicleType", e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {VEHICLE_TYPES.map((vt) => (
                  <option key={vt.value} value={vt.value}>{vt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => updateForm("isDefault", e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-gray-700">Default fare rule</span>
              </label>
            </div>
          </div>

          {/* Pricing */}
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Icon icon="solar:tag-price-bold" className="w-4 h-4 text-indigo-600" />
            Base Pricing
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { key: "baseFare", label: "Base Fare ($)" },
              { key: "perKm", label: "Per KM ($)" },
              { key: "perMinute", label: "Per Minute ($)" },
              { key: "waitingPerMinute", label: "Waiting/Min ($)" },
              { key: "minimumFare", label: "Minimum Fare ($)" },
              { key: "bookingFee", label: "Booking Fee ($)" },
              { key: "cancellationFee", label: "Cancellation Fee ($)" },
            ].map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{field.label}</label>
                <input
                  type="number"
                  value={form[field.key as keyof typeof form] as string}
                  onChange={(e) => updateForm(field.key, e.target.value)}
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                />
              </div>
            ))}
          </div>

          {/* Peak Hours */}
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Icon icon="solar:clock-circle-bold" className="w-4 h-4 text-amber-600" />
            Peak Hours
          </h4>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Multiplier</label>
              <input
                type="number"
                value={form.peakHoursMultiplier}
                onChange={(e) => updateForm("peakHoursMultiplier", e.target.value)}
                step="0.1"
                min="1"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start Time</label>
              <input
                type="time"
                value={form.peakHoursStart}
                onChange={(e) => updateForm("peakHoursStart", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End Time</label>
              <input
                type="time"
                value={form.peakHoursEnd}
                onChange={(e) => updateForm("peakHoursEnd", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
          </div>

          {/* Night Rate */}
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Icon icon="solar:moon-bold" className="w-4 h-4 text-purple-600" />
            Night Rate
          </h4>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Multiplier</label>
              <input
                type="number"
                value={form.nightRateMultiplier}
                onChange={(e) => updateForm("nightRateMultiplier", e.target.value)}
                step="0.1"
                min="1"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start Time</label>
              <input
                type="time"
                value={form.nightRateStart}
                onChange={(e) => updateForm("nightRateStart", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End Time</label>
              <input
                type="time"
                value={form.nightRateEnd}
                onChange={(e) => updateForm("nightRateEnd", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
          </div>

          {/* Weekend & Holiday */}
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Icon icon="solar:calendar-bold" className="w-4 h-4 text-teal-600" />
            Weekend & Holiday
          </h4>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Weekend Multiplier</label>
              <input
                type="number"
                value={form.weekendMultiplier}
                onChange={(e) => updateForm("weekendMultiplier", e.target.value)}
                step="0.1"
                min="1"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Holiday Multiplier</label>
              <input
                type="number"
                value={form.holidayMultiplier}
                onChange={(e) => updateForm("holidayMultiplier", e.target.value)}
                step="0.1"
                min="1"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>
          </div>

          <div className="flex gap-3">
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
              {formLoading ? "Saving..." : editingRule ? "Update Rule" : "Create Rule"}
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

      {/* Fare Rules by Vehicle Type */}
      {fareRules.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <Icon icon="solar:tag-price-bold" className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Fare Rules</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Create fare rules to define pricing for each vehicle type. Set base fares, per-km rates, peak hours, and more.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {VEHICLE_TYPES.map((vt) => {
            const rules = groupedRules[vt.value];
            if (!rules || rules.length === 0) return null;
            return (
              <div key={vt.value}>
                <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Icon icon={vt.icon} className="w-5 h-5 text-indigo-600" />
                  {vt.label}
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {rules.map((rule) => (
                    <div key={rule.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                            {rule.isDefault && (
                              <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium">
                                Default
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => openEdit(rule)}
                          className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <Icon icon="solar:pen-bold" className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Pricing Grid */}
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="p-2 rounded-lg bg-gray-50 text-center">
                          <p className="text-lg font-bold text-gray-900">${rule.baseFare.toFixed(2)}</p>
                          <p className="text-xs text-gray-500">Base Fare</p>
                        </div>
                        <div className="p-2 rounded-lg bg-gray-50 text-center">
                          <p className="text-lg font-bold text-gray-900">${rule.perKm.toFixed(2)}</p>
                          <p className="text-xs text-gray-500">Per KM</p>
                        </div>
                        <div className="p-2 rounded-lg bg-gray-50 text-center">
                          <p className="text-lg font-bold text-gray-900">${rule.perMinute.toFixed(2)}</p>
                          <p className="text-xs text-gray-500">Per Min</p>
                        </div>
                        <div className="p-2 rounded-lg bg-gray-50 text-center">
                          <p className="text-lg font-bold text-gray-900">${rule.waitingPerMinute.toFixed(2)}</p>
                          <p className="text-xs text-gray-500">Waiting/Min</p>
                        </div>
                        <div className="p-2 rounded-lg bg-gray-50 text-center">
                          <p className="text-lg font-bold text-gray-900">${rule.minimumFare.toFixed(2)}</p>
                          <p className="text-xs text-gray-500">Minimum</p>
                        </div>
                        <div className="p-2 rounded-lg bg-gray-50 text-center">
                          <p className="text-lg font-bold text-gray-900">${rule.bookingFee.toFixed(2)}</p>
                          <p className="text-xs text-gray-500">Booking Fee</p>
                        </div>
                      </div>

                      {/* Multipliers */}
                      <div className="flex flex-wrap gap-2 text-xs">
                        {rule.peakHoursMultiplier > 1 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 text-amber-700">
                            <Icon icon="solar:clock-circle-bold" className="w-3 h-3" />
                            Peak {rule.peakHoursMultiplier}x ({rule.peakHoursStart}-{rule.peakHoursEnd})
                          </span>
                        )}
                        {rule.nightRateMultiplier > 1 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-50 text-purple-700">
                            <Icon icon="solar:moon-bold" className="w-3 h-3" />
                            Night {rule.nightRateMultiplier}x ({rule.nightRateStart}-{rule.nightRateEnd})
                          </span>
                        )}
                        {rule.weekendMultiplier > 1 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-50 text-teal-700">
                            <Icon icon="solar:calendar-bold" className="w-3 h-3" />
                            Weekend {rule.weekendMultiplier}x
                          </span>
                        )}
                        {rule.holidayMultiplier > 1 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-700">
                            <Icon icon="solar:star-bold" className="w-3 h-3" />
                            Holiday {rule.holidayMultiplier}x
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100 text-gray-600">
                          <Icon icon="solar:close-circle-bold" className="w-3 h-3" />
                          Cancel: ${rule.cancellationFee.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
