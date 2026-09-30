"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Trip {
  id: string;
  tripNumber: string;
  status: "searching" | "assigned" | "in_progress" | "completed" | "cancelled";
  customerName: string;
  customerPhone: string;
  pickupAddress: string;
  dropoffAddress: string;
  driverName: string | null;
  driverId: string | null;
  vehiclePlate: string | null;
  fare: number | null;
  distance: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
}

interface AvailableDriver {
  id: string;
  name: string;
  phone: string;
  vehicle: string;
  vehiclePlate: string;
  lastLocation: string;
  status: "online" | "offline" | "on_trip";
  rating: number;
}

const STATUS_CONFIG: Record<string, { color: string; text: string; bg: string; label: string }> = {
  searching: { color: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", label: "Searching" },
  assigned: { color: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50", label: "Assigned" },
  in_progress: { color: "bg-green-500", text: "text-green-700", bg: "bg-green-50", label: "In Progress" },
  completed: { color: "bg-gray-400", text: "text-gray-700", bg: "bg-gray-50", label: "Completed" },
  cancelled: { color: "bg-red-500", text: "text-red-700", bg: "bg-red-50", label: "Cancelled" },
};

const DRIVER_STATUS_CONFIG: Record<string, { color: string; text: string; bg: string; label: string }> = {
  online: { color: "bg-green-500", text: "text-green-700", bg: "bg-green-50", label: "Online" },
  offline: { color: "bg-gray-400", text: "text-gray-700", bg: "bg-gray-50", label: "Offline" },
  on_trip: { color: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50", label: "On Trip" },
};

export default function DispatchPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<AvailableDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "searching" | "assigned" | "in_progress">("all");
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTripId, setAssignTripId] = useState<string | null>(null);
  const [assignDriverId, setAssignDriverId] = useState("");
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("tenantId") || localStorage.getItem("tap_active_tenant") || ""
    : "";

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [tripsRes, driversRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/cab/trips?status=active`),
        fetch(`/api/tenants/${tenantId}/cab/drivers?status=available`),
      ]);
      const tripsData = await tripsRes.json();
      const driversData = await driversRes.json();
      if (tripsData.trips) setTrips(tripsData.trips);
      if (driversData.drivers) setDrivers(driversData.drivers);
    } catch {
      toast.error("Failed to load dispatch data");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredTrips = activeTab === "all"
    ? trips
    : trips.filter((t) => t.status === activeTab);

  const handleAssignDriver = async () => {
    if (!assignTripId || !assignDriverId) {
      toast.error("Select a driver to assign");
      return;
    }
    setActionLoading((p) => ({ ...p, assign: true }));
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/trips/${assignTripId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: assignDriverId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Driver assigned successfully");
        setShowAssignModal(false);
        setAssignTripId(null);
        setAssignDriverId("");
        fetchData();
      } else {
        toast.error(data.error || "Failed to assign driver");
      }
    } catch {
      toast.error("Failed to assign driver");
    } finally {
      setActionLoading((p) => ({ ...p, assign: false }));
    }
  };

  const handleCancelTrip = async (tripId: string) => {
    if (!confirm("Cancel this trip?")) return;
    setActionLoading((p) => ({ ...p, [tripId]: true }));
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/trips/${tripId}/cancel`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Trip cancelled");
        fetchData();
      } else {
        toast.error(data.error || "Failed to cancel trip");
      }
    } catch {
      toast.error("Failed to cancel trip");
    } finally {
      setActionLoading((p) => ({ ...p, [tripId]: false }));
    }
  };

  const tabs = [
    { key: "all", label: "All", count: trips.length },
    { key: "searching", label: "Searching", count: trips.filter((t) => t.status === "searching").length },
    { key: "assigned", label: "Assigned", count: trips.filter((t) => t.status === "assigned").length },
    { key: "in_progress", label: "In Progress", count: trips.filter((t) => t.status === "in_progress").length },
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
          <h1 className="text-2xl font-bold text-gray-900">Live Dispatch Board</h1>
          <p className="text-gray-500 mt-1">Monitor and manage active trips in real-time</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Auto-refreshing every 10s
        </div>
      </div>

      {/* Status Filter Tabs */}
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

      {/* Main Grid: Map + Trips + Drivers */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Panel: Active Trips */}
        <div className="xl:col-span-1 space-y-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Icon icon="solar:route-bold" className="w-5 h-5 text-indigo-600" />
            Active Trips ({filteredTrips.length})
          </h2>

          {filteredTrips.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
              <Icon icon="solar:route-bold" className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">No active trips</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {filteredTrips.map((trip) => {
                const statusCfg = STATUS_CONFIG[trip.status];
                return (
                  <div
                    key={trip.id}
                    onClick={() => setSelectedTrip(trip)}
                    className={`bg-white rounded-2xl shadow-sm border p-4 cursor-pointer transition-all hover:shadow-md ${
                      selectedTrip?.id === trip.id ? "border-indigo-300 ring-2 ring-indigo-100" : "border-gray-100"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 text-sm">#{trip.tripNumber}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.color}`} />
                            {statusCfg.label}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-700 mt-1">{trip.customerName}</p>
                      </div>
                      {trip.fare && (
                        <span className="text-sm font-semibold text-gray-900">${trip.fare.toFixed(2)}</span>
                      )}
                    </div>

                    <div className="space-y-1.5 text-xs text-gray-500">
                      <div className="flex items-start gap-2">
                        <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        </div>
                        <span className="line-clamp-1">{trip.pickupAddress}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        </div>
                        <span className="line-clamp-1">{trip.dropoffAddress}</span>
                      </div>
                    </div>

                    {trip.driverName && (
                      <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-2 text-xs text-gray-600">
                        <Icon icon="solar:user-id-bold" className="w-3.5 h-3.5" />
                        <span>{trip.driverName}</span>
                        {trip.vehiclePlate && (
                          <>
                            <span className="text-gray-300">|</span>
                            <span className="font-mono">{trip.vehiclePlate}</span>
                          </>
                        )}
                      </div>
                    )}

                    {/* Quick Actions */}
                    <div className="mt-3 flex gap-2">
                      {trip.status === "searching" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignTripId(trip.id);
                            setShowAssignModal(true);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                        >
                          <Icon icon="solar:user-plus-bold" className="w-3.5 h-3.5" />
                          Assign Driver
                        </button>
                      )}
                      {(trip.status === "searching" || trip.status === "assigned") && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancelTrip(trip.id);
                          }}
                          disabled={actionLoading[trip.id]}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                        >
                          <Icon icon="solar:close-circle-bold" className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Center: Map Placeholder */}
        <div className="xl:col-span-1">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Icon icon="solar:map-bold" className="w-5 h-5 text-indigo-600" />
            Map View
          </h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 h-[600px] flex flex-col items-center justify-center text-center p-8">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center mb-4">
              <Icon icon="solar:map-point-wave-bold" className="w-10 h-10 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Live Map Coming Soon</h3>
            <p className="text-gray-500 text-sm max-w-xs">
              Google Maps integration will show real-time driver locations, active trip routes, and zone boundaries.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-4 w-full max-w-xs">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600">{drivers.filter((d) => d.status === "online").length}</div>
                <div className="text-xs text-gray-500">Online</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{trips.filter((t) => t.status === "in_progress").length}</div>
                <div className="text-xs text-gray-500">Active Trips</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-600">{trips.filter((t) => t.status === "searching").length}</div>
                <div className="text-xs text-gray-500">Searching</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Available Drivers */}
        <div className="xl:col-span-1 space-y-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Icon icon="solar:user-id-bold" className="w-5 h-5 text-teal-600" />
            Available Drivers ({drivers.filter((d) => d.status === "online").length})
          </h2>

          {drivers.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
              <Icon icon="solar:user-id-bold" className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">No drivers available</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {drivers.map((driver) => {
                const driverStatusCfg = DRIVER_STATUS_CONFIG[driver.status];
                return (
                  <div
                    key={driver.id}
                    className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center">
                          <Icon icon="solar:user-bold" className="w-5 h-5 text-teal-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{driver.name}</p>
                          <p className="text-xs text-gray-500">{driver.vehicle}</p>
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${driverStatusCfg.bg} ${driverStatusCfg.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${driverStatusCfg.color} ${driver.status === "online" ? "animate-pulse" : ""}`} />
                        {driverStatusCfg.label}
                      </span>
                    </div>

                    <div className="space-y-1 text-xs text-gray-500 mt-2">
                      <div className="flex items-center gap-1.5">
                        <Icon icon="solar:card-bold" className="w-3.5 h-3.5" />
                        <span className="font-mono">{driver.vehiclePlate}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Icon icon="solar:map-point-bold" className="w-3.5 h-3.5" />
                        <span className="line-clamp-1">{driver.lastLocation || "Unknown"}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Icon icon="solar:star-bold" className="w-3.5 h-3.5 text-amber-500" />
                        <span>{driver.rating.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Trip Details Modal */}
      {selectedTrip && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedTrip(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">Trip #{selectedTrip.tripNumber}</h3>
              <button onClick={() => setSelectedTrip(null)} className="p-2 rounded-lg hover:bg-gray-100">
                <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${STATUS_CONFIG[selectedTrip.status].bg} ${STATUS_CONFIG[selectedTrip.status].text}`}>
                  <span className={`w-2 h-2 rounded-full ${STATUS_CONFIG[selectedTrip.status].color}`} />
                  {STATUS_CONFIG[selectedTrip.status].label}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Customer</span>
                  <p className="font-medium text-gray-900">{selectedTrip.customerName}</p>
                </div>
                <div>
                  <span className="text-gray-500">Phone</span>
                  <p className="font-medium text-gray-900">{selectedTrip.customerPhone}</p>
                </div>
                <div>
                  <span className="text-gray-500">Driver</span>
                  <p className="font-medium text-gray-900">{selectedTrip.driverName || "Unassigned"}</p>
                </div>
                <div>
                  <span className="text-gray-500">Vehicle</span>
                  <p className="font-mono text-gray-900">{selectedTrip.vehiclePlate || "N/A"}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-green-50">
                  <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                  </div>
                  <div>
                    <span className="text-xs text-green-600 font-medium">Pickup</span>
                    <p className="text-sm text-gray-900">{selectedTrip.pickupAddress}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50">
                  <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                  </div>
                  <div>
                    <span className="text-xs text-red-600 font-medium">Dropoff</span>
                    <p className="text-sm text-gray-900">{selectedTrip.dropoffAddress}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm pt-2">
                <div>
                  <span className="text-gray-500">Fare</span>
                  <p className="font-semibold text-gray-900">{selectedTrip.fare ? `$${selectedTrip.fare.toFixed(2)}` : "Pending"}</p>
                </div>
                <div>
                  <span className="text-gray-500">Distance</span>
                  <p className="font-medium text-gray-900">{selectedTrip.distance ? `${selectedTrip.distance.toFixed(1)} km` : "N/A"}</p>
                </div>
                <div>
                  <span className="text-gray-500">Created</span>
                  <p className="font-medium text-gray-900">{new Date(selectedTrip.createdAt).toLocaleTimeString()}</p>
                </div>
              </div>

              {selectedTrip.notes && (
                <div className="p-3 rounded-xl bg-gray-50">
                  <span className="text-xs text-gray-500 font-medium">Notes</span>
                  <p className="text-sm text-gray-700 mt-1">{selectedTrip.notes}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
              {selectedTrip.status === "searching" && (
                <button
                  onClick={() => {
                    setAssignTripId(selectedTrip.id);
                    setSelectedTrip(null);
                    setShowAssignModal(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  <Icon icon="solar:user-plus-bold" className="w-4 h-4" />
                  Assign Driver
                </button>
              )}
              {(selectedTrip.status === "searching" || selectedTrip.status === "assigned") && (
                <button
                  onClick={() => {
                    handleCancelTrip(selectedTrip.id);
                    setSelectedTrip(null);
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
                >
                  <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
                  Cancel Trip
                </button>
              )}
              <button
                onClick={() => setSelectedTrip(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Driver Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAssignModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">Assign Driver</h3>
              <button onClick={() => setShowAssignModal(false)} className="p-2 rounded-lg hover:bg-gray-100">
                <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto">
              {drivers.filter((d) => d.status === "online").length === 0 ? (
                <div className="text-center py-8">
                  <Icon icon="solar:user-cross-bold" className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                  <p className="text-gray-500 text-sm">No online drivers available</p>
                </div>
              ) : (
                drivers
                  .filter((d) => d.status === "online")
                  .map((driver) => (
                    <button
                      key={driver.id}
                      onClick={() => setAssignDriverId(driver.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors ${
                        assignDriverId === driver.id
                          ? "bg-indigo-50 border-2 border-indigo-300"
                          : "bg-gray-50 border-2 border-transparent hover:bg-gray-100"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center flex-shrink-0">
                        <Icon icon="solar:user-bold" className="w-5 h-5 text-teal-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 text-sm">{driver.name}</p>
                        <p className="text-xs text-gray-500">{driver.vehicle} - {driver.vehiclePlate}</p>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-amber-600">
                        <Icon icon="solar:star-bold" className="w-3.5 h-3.5" />
                        {driver.rating.toFixed(1)}
                      </div>
                      {assignDriverId === driver.id && (
                        <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-indigo-600" />
                      )}
                    </button>
                  ))
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAssignDriver}
                disabled={!assignDriverId || actionLoading.assign}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {actionLoading.assign ? (
                  <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon icon="solar:user-plus-bold" className="w-4 h-4" />
                )}
                {actionLoading.assign ? "Assigning..." : "Assign"}
              </button>
              <button
                onClick={() => setShowAssignModal(false)}
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
