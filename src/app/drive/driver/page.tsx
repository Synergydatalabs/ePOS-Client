"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { useDriverSession } from "./layout";

interface ActiveTrip {
  id: string;
  status: string;
  customerName: string;
  customerPhone?: string;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedFare: number;
  createdAt: string;
}

interface DayStats {
  tripsCompleted: number;
  earnings: number;
  hoursOnline: number;
}

export default function DriverDashboardPage() {
  const router = useRouter();
  const { session, isOnline, setIsOnline } = useDriverSession();
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [dayStats, setDayStats] = useState<DayStats>({ tripsCompleted: 0, earnings: 0, hoursOnline: 0 });
  const [loading, setLoading] = useState(true);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const locationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const tenantId = session?.tenant.id;
  const driverId = session?.user.id;

  // Load driver data
  const loadDriverData = useCallback(async () => {
    if (!tenantId || !driverId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/drivers/${driverId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.activeTrip) {
          setActiveTrip(data.activeTrip);
        } else {
          setActiveTrip(null);
        }
        if (data.todayStats) {
          setDayStats(data.todayStats);
        }
      }
    } catch (error) {
      console.error("Failed to load driver data:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId, driverId]);

  useEffect(() => {
    loadDriverData();

    // Poll every 10 seconds for new trip assignments
    const poll = setInterval(loadDriverData, 10000);
    return () => clearInterval(poll);
  }, [loadDriverData]);

  // Send location updates when online
  const sendLocation = useCallback(async (position: GeolocationPosition) => {
    if (!tenantId || !driverId) return;

    try {
      await fetch(`/api/tenants/${tenantId}/drivers/${driverId}/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          heading: position.coords.heading,
          speed: position.coords.speed,
        }),
      });
    } catch (error) {
      console.error("Failed to send location:", error);
    }
  }, [tenantId, driverId]);

  const startLocationUpdates = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    // Send initial location
    navigator.geolocation.getCurrentPosition(
      sendLocation,
      (error) => {
        console.error("Geolocation error:", error);
        toast.error("Please enable location access to go online");
      },
      { enableHighAccuracy: true }
    );

    // Send updates every 10 seconds
    locationIntervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        sendLocation,
        (error) => console.error("Location update failed:", error),
        { enableHighAccuracy: true }
      );
    }, 10000);
  }, [sendLocation]);

  const stopLocationUpdates = useCallback(() => {
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
    }
  }, []);

  // Toggle online/offline
  const toggleOnline = async () => {
    setTogglingStatus(true);

    if (!isOnline) {
      // Going online - request GPS first
      if (!navigator.geolocation) {
        toast.error("Geolocation is not supported by your browser");
        setTogglingStatus(false);
        return;
      }

      try {
        await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        });

        setIsOnline(true);
        localStorage.setItem("driver_online", "true");
        startLocationUpdates();
        toast.success("You are now online");
      } catch (error) {
        toast.error("Please enable location access to go online");
      }
    } else {
      // Going offline
      setIsOnline(false);
      localStorage.setItem("driver_online", "false");
      stopLocationUpdates();
      toast.info("You are now offline");
    }

    setTogglingStatus(false);
  };

  // Start/stop location updates when online status changes
  useEffect(() => {
    if (isOnline) {
      startLocationUpdates();
    } else {
      stopLocationUpdates();
    }

    return () => stopLocationUpdates();
  }, [isOnline, startLocationUpdates, stopLocationUpdates]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: session?.tenant.currency || "USD",
    }).format(amount / 100);
  };

  return (
    <div className="p-4 pb-2 space-y-4">
      {/* Online/Offline Toggle */}
      <button
        onClick={toggleOnline}
        disabled={togglingStatus}
        className={`w-full py-5 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3 ${
          isOnline
            ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-600"
            : "bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-750"
        } disabled:opacity-50`}
      >
        {togglingStatus ? (
          <Icon icon="solar:loading-bold" className="w-7 h-7 animate-spin" />
        ) : (
          <Icon
            icon={isOnline ? "solar:power-bold" : "solar:power-linear"}
            className="w-7 h-7"
          />
        )}
        {togglingStatus
          ? "Updating..."
          : isOnline
          ? "GO OFFLINE"
          : "GO ONLINE"}
      </button>

      {/* Waiting for rides animation */}
      {isOnline && !activeTrip && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-6 text-center">
          <div className="relative inline-flex items-center justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Icon icon="solar:map-point-search-bold" className="w-8 h-8 text-emerald-400" />
            </div>
            <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-emerald-500/30 animate-ping" />
          </div>
          <p className="text-white font-medium">Waiting for rides...</p>
          <p className="text-gray-500 text-sm mt-1">You will be notified when a ride is available</p>
        </div>
      )}

      {/* Active Trip Card */}
      {activeTrip && (
        <div className="bg-gray-800/50 border border-emerald-500/20 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">Active Trip</h3>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {activeTrip.status.replace("_", " ")}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Icon icon="solar:user-rounded-bold" className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <span className="text-white">{activeTrip.customerName}</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm">
              <div className="w-4 h-4 mt-0.5 flex-shrink-0">
                <div className="w-3 h-3 rounded-full border-2 border-emerald-400 mx-auto" />
              </div>
              <span className="text-gray-300 line-clamp-1">{activeTrip.pickupAddress}</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <div className="w-4 h-4 mt-0.5 flex-shrink-0">
                <div className="w-3 h-3 rounded-full bg-red-400 mx-auto" />
              </div>
              <span className="text-gray-300 line-clamp-1">{activeTrip.dropoffAddress}</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-700">
            <span className="text-lg font-bold text-white">{formatCurrency(activeTrip.estimatedFare)}</span>
            <button
              onClick={() => router.push("/drive/driver/trip")}
              className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2"
            >
              <Icon icon="solar:arrow-right-linear" className="w-4 h-4" />
              View Trip
            </button>
          </div>
        </div>
      )}

      {/* Today's Stats */}
      <div>
        <h3 className="text-sm font-medium text-gray-500 mb-3 px-1">Today&apos;s Stats</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <Icon icon="solar:route-bold" className="w-6 h-6 text-blue-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-white">{loading ? "-" : dayStats.tripsCompleted}</p>
            <p className="text-xs text-gray-500">Trips</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <Icon icon="solar:wallet-bold" className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-white">{loading ? "-" : formatCurrency(dayStats.earnings)}</p>
            <p className="text-xs text-gray-500">Earned</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <Icon icon="solar:clock-circle-bold" className="w-6 h-6 text-amber-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-white">{loading ? "-" : `${dayStats.hoursOnline.toFixed(1)}h`}</p>
            <p className="text-xs text-gray-500">Online</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      {!isOnline && !activeTrip && (
        <div className="bg-gray-800/30 border border-gray-700/30 rounded-2xl p-6 text-center">
          <Icon icon="solar:sleeping-circle-bold" className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">You&apos;re currently offline</p>
          <p className="text-gray-600 text-sm mt-1">Go online to start receiving ride requests</p>
        </div>
      )}
    </div>
  );
}
