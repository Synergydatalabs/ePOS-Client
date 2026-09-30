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
  duration: number | null;
  paymentMethod: string;
  promoCode: string | null;
  notes: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_CONFIG: Record<string, { color: string; text: string; bg: string; label: string }> = {
  searching: { color: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", label: "Searching" },
  assigned: { color: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50", label: "Assigned" },
  in_progress: { color: "bg-green-500", text: "text-green-700", bg: "bg-green-50", label: "In Progress" },
  completed: { color: "bg-gray-400", text: "text-gray-700", bg: "bg-gray-50", label: "Completed" },
  cancelled: { color: "bg-red-500", text: "text-red-700", bg: "bg-red-50", label: "Cancelled" },
};

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("tenantId") || localStorage.getItem("tap_active_tenant") || ""
    : "";

  const fetchTrips = useCallback(async () => {
    if (!tenantId) return;
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") params.set("status", activeTab);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/tenants/${tenantId}/cab/trips?${params.toString()}`);
      const data = await res.json();
      if (data.trips) setTrips(data.trips);
    } catch {
      toast.error("Failed to load trips");
    } finally {
      setLoading(false);
    }
  }, [tenantId, activeTab, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const handleExportCSV = () => {
    toast.info("CSV export coming soon");
  };

  const tabs = [
    { key: "all", label: "All" },
    { key: "searching", label: "Searching" },
    { key: "assigned", label: "Assigned" },
    { key: "in_progress", label: "In Progress" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];

  const truncate = (str: string, len: number) =>
    str.length > len ? str.substring(0, len) + "..." : str;

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
          <h1 className="text-2xl font-bold text-gray-900">Trip History</h1>
          <p className="text-gray-500 mt-1">View and search all trips</p>
        </div>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-gray-700 font-medium border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <Icon icon="solar:download-minimalistic-bold" className="w-5 h-5" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <Icon icon="solar:magnifer-linear" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by trip #, customer name, or phone..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Date Filters */}
          <div className="flex gap-2">
            <div>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                placeholder="From"
              />
            </div>
            <div>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                placeholder="To"
              />
            </div>
          </div>
        </div>

        {/* Status Tabs */}
        <div className="flex gap-2 mt-4 overflow-x-auto pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Trip List */}
      {trips.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <Icon icon="solar:route-bold" className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Trips Found</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            {searchQuery || dateFrom || dateTo
              ? "No trips match your filters. Try adjusting your search criteria."
              : "Trip history will appear here once rides start."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Trip #</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date/Time</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Driver</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Route</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Fare</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Payment</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {trips.map((trip) => {
                  const statusCfg = STATUS_CONFIG[trip.status];
                  return (
                    <tr
                      key={trip.id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedTrip(trip)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono font-medium text-sm text-gray-900">#{trip.tripNumber}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(trip.createdAt).toLocaleDateString()}<br />
                        <span className="text-xs text-gray-400">{new Date(trip.createdAt).toLocaleTimeString()}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{trip.customerName}</p>
                        <p className="text-xs text-gray-500">{trip.customerPhone}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {trip.driverName || <span className="text-gray-400">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <div className="w-2 h-2 rounded-full bg-green-400" />
                          <span className="max-w-[120px] truncate">{truncate(trip.pickupAddress, 25)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                          <div className="w-2 h-2 rounded-full bg-red-400" />
                          <span className="max-w-[120px] truncate">{truncate(trip.dropoffAddress, 25)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-sm text-gray-900">
                          {trip.fare ? `$${trip.fare.toFixed(2)}` : "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600 capitalize">{trip.paymentMethod}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.color}`} />
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button className="p-1.5 rounded-lg hover:bg-gray-100">
                          <Icon icon="solar:eye-bold" className="w-4 h-4 text-gray-400" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="lg:hidden divide-y divide-gray-100">
            {trips.map((trip) => {
              const statusCfg = STATUS_CONFIG[trip.status];
              return (
                <div
                  key={trip.id}
                  onClick={() => setSelectedTrip(trip)}
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="font-mono font-medium text-sm text-gray-900">#{trip.tripNumber}</span>
                      <span className="text-xs text-gray-400 ml-2">{new Date(trip.createdAt).toLocaleDateString()}</span>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.color}`} />
                      {statusCfg.label}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <div>
                      <p className="font-medium text-gray-900">{trip.customerName}</p>
                      <p className="text-xs text-gray-500">{trip.driverName || "Unassigned"}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{trip.fare ? `$${trip.fare.toFixed(2)}` : "-"}</p>
                      <p className="text-xs text-gray-500 capitalize">{trip.paymentMethod}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trip Details Side Panel */}
      {selectedTrip && (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={() => setSelectedTrip(null)}>
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Trip #{selectedTrip.tripNumber}</h3>
              <button onClick={() => setSelectedTrip(null)} className="p-2 rounded-lg hover:bg-gray-100">
                <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Status */}
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${STATUS_CONFIG[selectedTrip.status].bg} ${STATUS_CONFIG[selectedTrip.status].text}`}>
                  <span className={`w-2 h-2 rounded-full ${STATUS_CONFIG[selectedTrip.status].color}`} />
                  {STATUS_CONFIG[selectedTrip.status].label}
                </span>
                {selectedTrip.promoCode && (
                  <span className="px-2 py-1 rounded-full bg-purple-50 text-purple-700 text-xs font-medium">
                    Promo: {selectedTrip.promoCode}
                  </span>
                )}
              </div>

              {/* Customer & Driver */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-gray-50">
                  <span className="text-xs text-gray-500 font-medium">Customer</span>
                  <p className="font-medium text-gray-900 mt-1">{selectedTrip.customerName}</p>
                  <p className="text-sm text-gray-500">{selectedTrip.customerPhone}</p>
                </div>
                <div className="p-4 rounded-xl bg-gray-50">
                  <span className="text-xs text-gray-500 font-medium">Driver</span>
                  <p className="font-medium text-gray-900 mt-1">{selectedTrip.driverName || "Unassigned"}</p>
                  <p className="text-sm text-gray-500 font-mono">{selectedTrip.vehiclePlate || "N/A"}</p>
                </div>
              </div>

              {/* Route */}
              <div className="space-y-2">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-green-50">
                  <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                  </div>
                  <div>
                    <span className="text-xs text-green-600 font-medium">Pickup</span>
                    <p className="text-sm text-gray-900">{selectedTrip.pickupAddress}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50">
                  <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                  </div>
                  <div>
                    <span className="text-xs text-red-600 font-medium">Dropoff</span>
                    <p className="text-sm text-gray-900">{selectedTrip.dropoffAddress}</p>
                  </div>
                </div>
              </div>

              {/* Trip Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 rounded-xl bg-gray-50">
                  <p className="text-xl font-bold text-gray-900">{selectedTrip.fare ? `$${selectedTrip.fare.toFixed(2)}` : "-"}</p>
                  <p className="text-xs text-gray-500">Fare</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-gray-50">
                  <p className="text-xl font-bold text-gray-900">{selectedTrip.distance ? `${selectedTrip.distance.toFixed(1)} km` : "-"}</p>
                  <p className="text-xs text-gray-500">Distance</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-gray-50">
                  <p className="text-xl font-bold text-gray-900">{selectedTrip.duration ? `${selectedTrip.duration} min` : "-"}</p>
                  <p className="text-xs text-gray-500">Duration</p>
                </div>
              </div>

              {/* Timeline */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Timeline</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full bg-gray-400" />
                    <span className="text-gray-500">Created</span>
                    <span className="text-gray-900 ml-auto">{new Date(selectedTrip.createdAt).toLocaleString()}</span>
                  </div>
                  {selectedTrip.startedAt && (
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-gray-500">Started</span>
                      <span className="text-gray-900 ml-auto">{new Date(selectedTrip.startedAt).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedTrip.completedAt && (
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-gray-500">Completed</span>
                      <span className="text-gray-900 ml-auto">{new Date(selectedTrip.completedAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-indigo-600 font-medium">Payment Method</span>
                    <p className="font-medium text-gray-900 capitalize">{selectedTrip.paymentMethod}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-indigo-600 font-medium">Total Fare</span>
                    <p className="text-xl font-bold text-gray-900">{selectedTrip.fare ? `$${selectedTrip.fare.toFixed(2)}` : "Pending"}</p>
                  </div>
                </div>
              </div>

              {selectedTrip.notes && (
                <div className="p-3 rounded-xl bg-gray-50">
                  <span className="text-xs text-gray-500 font-medium">Notes</span>
                  <p className="text-sm text-gray-700 mt-1">{selectedTrip.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
