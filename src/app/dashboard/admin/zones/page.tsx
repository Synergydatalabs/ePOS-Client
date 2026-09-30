"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Zone {
  id: string;
  name: string;
  type: "service_area" | "airport" | "downtown" | "suburb";
  surchargeType: "none" | "flat" | "percentage" | "multiplier";
  surchargeAmount: number;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  service_area: { icon: "solar:map-bold", color: "text-indigo-700", bg: "bg-indigo-50", label: "Service Area" },
  airport: { icon: "solar:airplane-bold", color: "text-purple-700", bg: "bg-purple-50", label: "Airport" },
  downtown: { icon: "solar:buildings-bold", color: "text-teal-700", bg: "bg-teal-50", label: "Downtown" },
  suburb: { icon: "solar:home-2-bold", color: "text-green-700", bg: "bg-green-50", label: "Suburb" },
};

const SURCHARGE_LABELS: Record<string, string> = {
  none: "No surcharge",
  flat: "Flat fee",
  percentage: "Percentage",
  multiplier: "Multiplier",
};

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<Zone["type"]>("service_area");
  const [formSurchargeType, setFormSurchargeType] = useState<Zone["surchargeType"]>("none");
  const [formSurchargeAmount, setFormSurchargeAmount] = useState("0");
  const [formDescription, setFormDescription] = useState("");
  const [formLoading, setFormLoading] = useState(false);

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("tenantId") || localStorage.getItem("tap_active_tenant") || ""
    : "";

  const fetchZones = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/zones`);
      const data = await res.json();
      if (data.zones) setZones(data.zones);
    } catch {
      toast.error("Failed to load zones");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  const resetForm = () => {
    setFormName("");
    setFormType("service_area");
    setFormSurchargeType("none");
    setFormSurchargeAmount("0");
    setFormDescription("");
    setEditingZone(null);
  };

  const openEdit = (zone: Zone) => {
    setEditingZone(zone);
    setFormName(zone.name);
    setFormType(zone.type);
    setFormSurchargeType(zone.surchargeType);
    setFormSurchargeAmount(String(zone.surchargeAmount));
    setFormDescription(zone.description || "");
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formName) {
      toast.error("Zone name is required");
      return;
    }

    setFormLoading(true);
    try {
      const url = editingZone
        ? `/api/tenants/${tenantId}/cab/zones/${editingZone.id}`
        : `/api/tenants/${tenantId}/cab/zones`;
      const method = editingZone ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          type: formType,
          surchargeType: formSurchargeType,
          surchargeAmount: parseFloat(formSurchargeAmount) || 0,
          description: formDescription || null,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(editingZone ? "Zone updated" : "Zone created");
        setShowForm(false);
        resetForm();
        fetchZones();
      } else {
        toast.error(data.error || "Failed to save zone");
      }
    } catch {
      toast.error("Failed to save zone");
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (zone: Zone) => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/zones/${zone.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !zone.isActive }),
      });
      if (res.ok) {
        toast.success(`Zone ${zone.isActive ? "deactivated" : "activated"}`);
        fetchZones();
      } else {
        toast.error("Failed to update zone");
      }
    } catch {
      toast.error("Failed to update zone");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this zone?")) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/zones/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Zone deleted");
        fetchZones();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete zone");
    }
  };

  const formatSurcharge = (zone: Zone) => {
    if (zone.surchargeType === "none") return "No surcharge";
    if (zone.surchargeType === "flat") return `+$${zone.surchargeAmount.toFixed(2)} flat`;
    if (zone.surchargeType === "percentage") return `+${zone.surchargeAmount}%`;
    if (zone.surchargeType === "multiplier") return `${zone.surchargeAmount}x multiplier`;
    return "";
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
          <h1 className="text-2xl font-bold text-gray-900">Service Zones</h1>
          <p className="text-gray-500 mt-1">Define service areas, airport zones, and surcharge regions</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
        >
          <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
          Add Zone
        </button>
      </div>

      {/* Map Placeholder */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100 p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-white/80 flex items-center justify-center">
            <Icon icon="solar:map-point-wave-bold" className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Map-Based Zone Drawing</h3>
            <p className="text-sm text-gray-600">Coming soon - Draw zone boundaries directly on the map</p>
          </div>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              {editingZone ? "Edit Zone" : "Add New Zone"}
            </h3>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="p-2 rounded-lg hover:bg-gray-100">
              <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Downtown Core"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone Type</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as Zone["type"])}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="service_area">Service Area</option>
                <option value="airport">Airport</option>
                <option value="downtown">Downtown</option>
                <option value="suburb">Suburb</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Surcharge Type</label>
              <select
                value={formSurchargeType}
                onChange={(e) => setFormSurchargeType(e.target.value as Zone["surchargeType"])}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="none">No Surcharge</option>
                <option value="flat">Flat Fee</option>
                <option value="percentage">Percentage</option>
                <option value="multiplier">Multiplier</option>
              </select>
            </div>
            {formSurchargeType !== "none" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Surcharge Amount {formSurchargeType === "flat" ? "($)" : formSurchargeType === "percentage" ? "(%)" : "(x)"}
                </label>
                <input
                  type="number"
                  value={formSurchargeAmount}
                  onChange={(e) => setFormSurchargeAmount(e.target.value)}
                  placeholder="0"
                  step="0.01"
                  min="0"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description of this zone..."
                rows={2}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
              />
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
              {formLoading ? "Saving..." : editingZone ? "Update Zone" : "Create Zone"}
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

      {/* Zones List */}
      {zones.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <Icon icon="solar:map-bold" className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Zones Configured</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Create service zones to define coverage areas and apply surcharges for airport pickups, downtown areas, and more.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {zones.map((zone) => {
            const typeCfg = TYPE_CONFIG[zone.type] || TYPE_CONFIG.service_area;
            return (
              <div
                key={zone.id}
                className={`bg-white rounded-2xl shadow-sm border p-5 transition-opacity ${
                  zone.isActive ? "border-gray-100" : "border-gray-100 opacity-60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl ${typeCfg.bg} flex items-center justify-center`}>
                      <Icon icon={typeCfg.icon} className={`w-6 h-6 ${typeCfg.color}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{zone.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeCfg.bg} ${typeCfg.color}`}>
                          {typeCfg.label}
                        </span>
                        {!zone.isActive && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        <span>{formatSurcharge(zone)}</span>
                        {zone.description && (
                          <>
                            <span className="text-gray-300">|</span>
                            <span className="line-clamp-1">{zone.description}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Active Toggle */}
                    <button
                      onClick={() => handleToggleActive(zone)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        zone.isActive ? "bg-green-500" : "bg-gray-300"
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        zone.isActive ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>

                    <button
                      onClick={() => openEdit(zone)}
                      className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    >
                      <Icon icon="solar:pen-bold" className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(zone.id)}
                      className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <Icon icon="solar:trash-bin-2-bold" className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
