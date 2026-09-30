"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string;
  photoUrl: string | null;
  licenseNumber: string;
  licenseExpiry: string;
  status: "online" | "offline" | "on_trip";
  vehicleId: string | null;
  vehiclePlate: string | null;
  vehicleModel: string | null;
  rating: number;
  totalTrips: number;
  acceptanceRate: number;
  commissionRate: number;
  createdAt: string;
}

interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface Vehicle {
  id: string;
  plate: string;
  make: string;
  model: string;
  assignedDriverId: string | null;
}

const STATUS_CONFIG: Record<string, { color: string; text: string; bg: string; label: string }> = {
  online: { color: "bg-green-500", text: "text-green-700", bg: "bg-green-50", label: "Online" },
  offline: { color: "bg-gray-400", text: "text-gray-700", bg: "bg-gray-50", label: "Offline" },
  on_trip: { color: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50", label: "On Trip" },
};

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "online" | "offline" | "on_trip">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);

  // Form state
  const [formStaffId, setFormStaffId] = useState("");
  const [formLicenseNumber, setFormLicenseNumber] = useState("");
  const [formLicenseExpiry, setFormLicenseExpiry] = useState("");
  const [formVehicleId, setFormVehicleId] = useState("");
  const [formCommission, setFormCommission] = useState("15");
  const [formLoading, setFormLoading] = useState(false);

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("tenantId") || localStorage.getItem("tap_active_tenant") || ""
    : "";

  const fetchDrivers = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/drivers`);
      const data = await res.json();
      if (data.drivers) setDrivers(data.drivers);
    } catch {
      toast.error("Failed to load drivers");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const fetchStaffAndVehicles = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [staffRes, vehiclesRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/staff`),
        fetch(`/api/tenants/${tenantId}/cab/vehicles`),
      ]);
      const staffData = await staffRes.json();
      const vehiclesData = await vehiclesRes.json();
      if (staffData.staff) setStaff(staffData.staff);
      if (vehiclesData.vehicles) setVehicles(vehiclesData.vehicles);
    } catch {
      // silent
    }
  }, [tenantId]);

  useEffect(() => {
    fetchDrivers();
    fetchStaffAndVehicles();
  }, [fetchDrivers, fetchStaffAndVehicles]);

  const resetForm = () => {
    setFormStaffId("");
    setFormLicenseNumber("");
    setFormLicenseExpiry("");
    setFormVehicleId("");
    setFormCommission("15");
    setEditingDriver(null);
  };

  const openEditModal = (driver: Driver) => {
    setEditingDriver(driver);
    setFormLicenseNumber(driver.licenseNumber);
    setFormLicenseExpiry(driver.licenseExpiry ? driver.licenseExpiry.split("T")[0] : "");
    setFormVehicleId(driver.vehicleId || "");
    setFormCommission(String(driver.commissionRate));
    setShowAddModal(true);
  };

  const handleSubmit = async () => {
    if (!editingDriver && !formStaffId) {
      toast.error("Please select a staff member");
      return;
    }
    if (!formLicenseNumber) {
      toast.error("License number is required");
      return;
    }

    setFormLoading(true);
    try {
      const url = editingDriver
        ? `/api/tenants/${tenantId}/cab/drivers/${editingDriver.id}`
        : `/api/tenants/${tenantId}/cab/drivers`;
      const method = editingDriver ? "PUT" : "POST";

      const body: Record<string, unknown> = {
        licenseNumber: formLicenseNumber,
        licenseExpiry: formLicenseExpiry || null,
        vehicleId: formVehicleId || null,
        commissionRate: parseFloat(formCommission) || 15,
      };
      if (!editingDriver) {
        body.staffId = formStaffId;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(editingDriver ? "Driver updated" : "Driver added successfully");
        setShowAddModal(false);
        resetForm();
        fetchDrivers();
      } else {
        toast.error(data.error || "Failed to save driver");
      }
    } catch {
      toast.error("Failed to save driver");
    } finally {
      setFormLoading(false);
    }
  };

  const filteredDrivers = drivers.filter((d) => {
    const matchesTab = activeTab === "all" || d.status === activeTab;
    const matchesSearch = !searchQuery || d.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const tabs = [
    { key: "all", label: "All", count: drivers.length },
    { key: "online", label: "Online", count: drivers.filter((d) => d.status === "online").length },
    { key: "offline", label: "Offline", count: drivers.filter((d) => d.status === "offline").length },
    { key: "on_trip", label: "On Trip", count: drivers.filter((d) => d.status === "on_trip").length },
  ] as const;

  const renderStars = (rating: number) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Icon
          key={i}
          icon={i <= Math.round(rating) ? "solar:star-bold" : "solar:star-linear"}
          className={`w-3.5 h-3.5 ${i <= Math.round(rating) ? "text-amber-400" : "text-gray-300"}`}
        />
      );
    }
    return stars;
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
          <h1 className="text-2xl font-bold text-gray-900">Driver Management</h1>
          <p className="text-gray-500 mt-1">Manage your fleet drivers and their assignments</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowAddModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
        >
          <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
          Add Driver
        </button>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Icon icon="solar:magnifer-linear" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
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
      </div>

      {/* Driver List */}
      {filteredDrivers.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <Icon icon="solar:user-id-bold" className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Drivers Found</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            {searchQuery ? "No drivers match your search criteria." : "Add your first driver to get started with ride dispatch."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredDrivers.map((driver) => {
            const statusCfg = STATUS_CONFIG[driver.status];
            return (
              <div key={driver.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center">
                      <Icon icon="solar:user-bold" className="w-6 h-6 text-indigo-500" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{driver.name}</h3>
                      <p className="text-xs text-gray-500">{driver.phone}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.color} ${driver.status === "online" ? "animate-pulse" : ""}`} />
                    {statusCfg.label}
                  </span>
                </div>

                {/* Rating */}
                <div className="flex items-center gap-1.5 mb-3">
                  {renderStars(driver.rating)}
                  <span className="text-sm text-gray-600 ml-1">{driver.rating.toFixed(1)}</span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="text-center p-2 rounded-xl bg-gray-50">
                    <p className="text-lg font-bold text-gray-900">{driver.totalTrips}</p>
                    <p className="text-xs text-gray-500">Trips</p>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-gray-50">
                    <p className="text-lg font-bold text-gray-900">{driver.acceptanceRate}%</p>
                    <p className="text-xs text-gray-500">Accept</p>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-gray-50">
                    <p className="text-lg font-bold text-gray-900">{driver.commissionRate}%</p>
                    <p className="text-xs text-gray-500">Comm.</p>
                  </div>
                </div>

                {/* Vehicle Info */}
                <div className="text-sm text-gray-600 mb-4">
                  {driver.vehicleModel ? (
                    <div className="flex items-center gap-2">
                      <Icon icon="solar:car-bold" className="w-4 h-4 text-gray-400" />
                      <span>{driver.vehicleModel}</span>
                      <span className="text-gray-300">|</span>
                      <span className="font-mono text-xs">{driver.vehiclePlate}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-600">
                      <Icon icon="solar:danger-triangle-bold" className="w-4 h-4" />
                      <span className="text-xs">No vehicle assigned</span>
                    </div>
                  )}
                </div>

                {/* License */}
                <div className="text-xs text-gray-500 mb-4 flex items-center gap-2">
                  <Icon icon="solar:card-bold" className="w-3.5 h-3.5" />
                  <span>License: {driver.licenseNumber}</span>
                  {driver.licenseExpiry && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span>Exp: {new Date(driver.licenseExpiry).toLocaleDateString()}</span>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => openEditModal(driver)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                  >
                    <Icon icon="solar:pen-bold" className="w-4 h-4" />
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Driver Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setShowAddModal(false); resetForm(); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">
                {editingDriver ? "Edit Driver" : "Add New Driver"}
              </h3>
              <button onClick={() => { setShowAddModal(false); resetForm(); }} className="p-2 rounded-lg hover:bg-gray-100">
                <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              {!editingDriver && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Staff Member</label>
                  <select
                    value={formStaffId}
                    onChange={(e) => setFormStaffId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">Select staff member...</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.phone})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License Number</label>
                <input
                  type="text"
                  value={formLicenseNumber}
                  onChange={(e) => setFormLicenseNumber(e.target.value)}
                  placeholder="DL-1234567890"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License Expiry</label>
                <input
                  type="date"
                  value={formLicenseExpiry}
                  onChange={(e) => setFormLicenseExpiry(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assign Vehicle</label>
                <select
                  value={formVehicleId}
                  onChange={(e) => setFormVehicleId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">No vehicle assigned</option>
                  {vehicles
                    .filter((v) => !v.assignedDriverId || v.assignedDriverId === editingDriver?.id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>{v.make} {v.model} - {v.plate}</option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Commission Rate (%)</label>
                <input
                  type="number"
                  value={formCommission}
                  onChange={(e) => setFormCommission(e.target.value)}
                  placeholder="15"
                  min="0"
                  max="100"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSubmit}
                disabled={formLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {formLoading ? (
                  <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
                )}
                {formLoading ? "Saving..." : editingDriver ? "Update Driver" : "Add Driver"}
              </button>
              <button
                onClick={() => { setShowAddModal(false); resetForm(); }}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
