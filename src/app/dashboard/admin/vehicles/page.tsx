"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Vehicle {
  id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  color: string;
  capacity: number;
  type: "sedan" | "suv" | "van" | "luxury" | "accessible";
  status: "active" | "maintenance" | "inactive";
  assignedDriver: { id: string; name: string } | null;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { color: string; text: string; bg: string; label: string }> = {
  active: { color: "bg-green-500", text: "text-green-700", bg: "bg-green-50", label: "Active" },
  maintenance: { color: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", label: "Maintenance" },
  inactive: { color: "bg-gray-400", text: "text-gray-700", bg: "bg-gray-50", label: "Inactive" },
};

const TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  sedan: { icon: "solar:car-bold", label: "Sedan" },
  suv: { icon: "solar:car-bold", label: "SUV" },
  van: { icon: "solar:bus-bold", label: "Van" },
  luxury: { icon: "solar:star-bold", label: "Luxury" },
  accessible: { icon: "solar:accessibility-bold", label: "Accessible" },
};

const COLOR_MAP: Record<string, string> = {
  black: "bg-gray-900",
  white: "bg-white border border-gray-300",
  silver: "bg-gray-300",
  gray: "bg-gray-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  brown: "bg-amber-700",
  beige: "bg-amber-100",
  orange: "bg-orange-500",
  navy: "bg-blue-900",
  maroon: "bg-red-900",
};

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "active" | "maintenance" | "inactive">("all");
  const [showForm, setShowForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  // Form state
  const [formPlate, setFormPlate] = useState("");
  const [formMake, setFormMake] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formYear, setFormYear] = useState(String(new Date().getFullYear()));
  const [formColor, setFormColor] = useState("");
  const [formCapacity, setFormCapacity] = useState("4");
  const [formType, setFormType] = useState<Vehicle["type"]>("sedan");
  const [formLoading, setFormLoading] = useState(false);

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("tenantId") || localStorage.getItem("tap_active_tenant") || ""
    : "";

  const fetchVehicles = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/vehicles`);
      const data = await res.json();
      if (data.vehicles) setVehicles(data.vehicles);
    } catch {
      toast.error("Failed to load vehicles");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  const resetForm = () => {
    setFormPlate("");
    setFormMake("");
    setFormModel("");
    setFormYear(String(new Date().getFullYear()));
    setFormColor("");
    setFormCapacity("4");
    setFormType("sedan");
    setEditingVehicle(null);
  };

  const openEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setFormPlate(vehicle.plate);
    setFormMake(vehicle.make);
    setFormModel(vehicle.model);
    setFormYear(String(vehicle.year));
    setFormColor(vehicle.color);
    setFormCapacity(String(vehicle.capacity));
    setFormType(vehicle.type);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formPlate || !formMake || !formModel) {
      toast.error("Plate, make, and model are required");
      return;
    }

    setFormLoading(true);
    try {
      const url = editingVehicle
        ? `/api/tenants/${tenantId}/cab/vehicles/${editingVehicle.id}`
        : `/api/tenants/${tenantId}/cab/vehicles`;
      const method = editingVehicle ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: formPlate.toUpperCase(),
          make: formMake,
          model: formModel,
          year: parseInt(formYear) || new Date().getFullYear(),
          color: formColor.toLowerCase(),
          capacity: parseInt(formCapacity) || 4,
          type: formType,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(editingVehicle ? "Vehicle updated" : "Vehicle added");
        setShowForm(false);
        resetForm();
        fetchVehicles();
      } else {
        toast.error(data.error || "Failed to save vehicle");
      }
    } catch {
      toast.error("Failed to save vehicle");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this vehicle?")) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/vehicles/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Vehicle deleted");
        fetchVehicles();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete vehicle");
    }
  };

  const filteredVehicles = activeTab === "all"
    ? vehicles
    : vehicles.filter((v) => v.status === activeTab);

  const tabs = [
    { key: "all", label: "All", count: vehicles.length },
    { key: "active", label: "Active", count: vehicles.filter((v) => v.status === "active").length },
    { key: "maintenance", label: "Maintenance", count: vehicles.filter((v) => v.status === "maintenance").length },
    { key: "inactive", label: "Inactive", count: vehicles.filter((v) => v.status === "inactive").length },
  ] as const;

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
          <h1 className="text-2xl font-bold text-gray-900">Vehicle Fleet</h1>
          <p className="text-gray-500 mt-1">Manage your fleet of vehicles</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
        >
          <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
          Add Vehicle
        </button>
      </div>

      {/* Status Filter */}
      <div className="flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-indigo-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
            }`}
          >
            {tab.label}
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${
              activeTab === tab.key ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              {editingVehicle ? "Edit Vehicle" : "Add New Vehicle"}
            </h3>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="p-2 rounded-lg hover:bg-gray-100">
              <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plate Number</label>
              <input
                type="text"
                value={formPlate}
                onChange={(e) => setFormPlate(e.target.value)}
                placeholder="ABC 1234"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 uppercase"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
              <input
                type="text"
                value={formMake}
                onChange={(e) => setFormMake(e.target.value)}
                placeholder="Toyota"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
              <input
                type="text"
                value={formModel}
                onChange={(e) => setFormModel(e.target.value)}
                placeholder="Camry"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
              <input
                type="number"
                value={formYear}
                onChange={(e) => setFormYear(e.target.value)}
                placeholder="2024"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
              <input
                type="text"
                value={formColor}
                onChange={(e) => setFormColor(e.target.value)}
                placeholder="Black"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
              <input
                type="number"
                value={formCapacity}
                onChange={(e) => setFormCapacity(e.target.value)}
                placeholder="4"
                min="1"
                max="20"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as Vehicle["type"])}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="sedan">Sedan</option>
                <option value="suv">SUV</option>
                <option value="van">Van</option>
                <option value="luxury">Luxury</option>
                <option value="accessible">Accessible</option>
              </select>
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
              {formLoading ? "Saving..." : editingVehicle ? "Update Vehicle" : "Add Vehicle"}
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

      {/* Vehicle Grid */}
      {filteredVehicles.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <Icon icon="solar:car-bold" className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Vehicles Found</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Add vehicles to your fleet to assign them to drivers.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVehicles.map((vehicle) => {
            const statusCfg = STATUS_CONFIG[vehicle.status];
            const typeCfg = TYPE_CONFIG[vehicle.type] || TYPE_CONFIG.sedan;
            const colorClass = COLOR_MAP[vehicle.color] || "bg-gray-400";

            return (
              <div key={vehicle.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-50 to-indigo-50 flex items-center justify-center">
                      <Icon icon={typeCfg.icon} className="w-6 h-6 text-teal-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 font-mono">{vehicle.plate}</h3>
                      <p className="text-sm text-gray-500">{vehicle.make} {vehicle.model}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.color}`} />
                    {statusCfg.label}
                  </span>
                </div>

                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full ${colorClass}`} />
                    <span className="text-sm text-gray-600 capitalize">{vehicle.color}</span>
                  </div>
                  <span className="text-gray-300">|</span>
                  <span className="text-sm text-gray-600">{vehicle.year}</span>
                  <span className="text-gray-300">|</span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium">
                    {typeCfg.label}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                  <div className="flex items-center gap-1.5">
                    <Icon icon="solar:users-group-rounded-bold" className="w-4 h-4" />
                    <span>{vehicle.capacity} seats</span>
                  </div>
                  {vehicle.assignedDriver ? (
                    <div className="flex items-center gap-1.5 text-teal-600">
                      <Icon icon="solar:user-bold" className="w-4 h-4" />
                      <span>{vehicle.assignedDriver.name}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-gray-400">
                      <Icon icon="solar:user-cross-bold" className="w-4 h-4" />
                      <span>Unassigned</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => openEdit(vehicle)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                  >
                    <Icon icon="solar:pen-bold" className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(vehicle.id)}
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
