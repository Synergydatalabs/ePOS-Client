"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { useDriverSession } from "../layout";

interface TripRecord {
  id: string;
  pickupAddress: string;
  dropoffAddress: string;
  fare: number;
  rating?: number;
  status: string;
  completedAt: string;
}

export default function DriverTripsHistoryPage() {
  const { session } = useDriverSession();
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });

  const tenantId = session?.tenant.id;
  const driverId = session?.user.id;

  const loadTrips = useCallback(async () => {
    if (!tenantId || !driverId) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/drivers/${driverId}/trips?date=${dateFilter}`
      );
      if (res.ok) {
        const data = await res.json();
        setTrips(data.trips || []);
      }
    } catch (error) {
      console.error("Failed to load trips:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId, driverId, dateFilter]);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: session?.tenant.currency || "USD",
    }).format(amount / 100);
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const truncateAddress = (addr: string, maxLen = 30) => {
    if (addr.length <= maxLen) return addr;
    return addr.substring(0, maxLen) + "...";
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Icon
        key={i}
        icon={i < rating ? "solar:star-bold" : "solar:star-linear"}
        className={`w-3.5 h-3.5 ${i < rating ? "text-amber-400" : "text-gray-600"}`}
      />
    ));
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Trip History</h2>
      </div>

      {/* Date Filter */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            const d = new Date(dateFilter);
            d.setDate(d.getDate() - 1);
            setDateFilter(d.toISOString().split("T")[0]);
          }}
          className="w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-400 hover:text-white"
        >
          <Icon icon="solar:alt-arrow-left-linear" className="w-5 h-5" />
        </button>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="flex-1 py-2 px-3 bg-gray-800 border border-gray-700 rounded-xl text-white text-sm focus:border-emerald-500 outline-none [color-scheme:dark]"
        />
        <button
          onClick={() => {
            const d = new Date(dateFilter);
            d.setDate(d.getDate() + 1);
            const today = new Date().toISOString().split("T")[0];
            if (d.toISOString().split("T")[0] <= today) {
              setDateFilter(d.toISOString().split("T")[0]);
            }
          }}
          className="w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-400 hover:text-white"
        >
          <Icon icon="solar:alt-arrow-right-linear" className="w-5 h-5" />
        </button>
      </div>

      {/* Trip List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-800/50 rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-700 rounded w-1/2 mb-3" />
              <div className="h-4 bg-gray-700 rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : trips.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Icon icon="solar:clock-circle-bold" className="w-16 h-16 text-gray-700 mb-4" />
          <p className="text-gray-400 font-medium">No trips found</p>
          <p className="text-gray-600 text-sm mt-1">No completed trips for this date</p>
        </div>
      ) : (
        <div className="space-y-3">
          {trips.map((trip) => (
            <div
              key={trip.id}
              className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4"
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs text-gray-500">{formatTime(trip.completedAt)}</span>
                <span className="text-base font-bold text-white">
                  {formatCurrency(trip.fare)}
                </span>
              </div>

              <div className="space-y-1.5 mb-3">
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2.5 h-2.5 rounded-full border-2 border-emerald-400 flex-shrink-0" />
                  <span className="text-gray-300 truncate">{truncateAddress(trip.pickupAddress)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" />
                  <span className="text-gray-300 truncate">{truncateAddress(trip.dropoffAddress)}</span>
                </div>
              </div>

              {trip.rating !== undefined && trip.rating > 0 && (
                <div className="flex items-center gap-1 pt-2 border-t border-gray-700/50">
                  <span className="text-xs text-gray-500 mr-1">Rating:</span>
                  {renderStars(trip.rating)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
