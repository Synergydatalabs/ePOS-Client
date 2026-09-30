"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { useDriverSession } from "../layout";

interface Trip {
  id: string;
  status: string;
  customerName: string;
  customerPhone?: string;
  pickupAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffAddress: string;
  dropoffLat?: number;
  dropoffLng?: number;
  estimatedFare: number;
  distance?: number;
  createdAt: string;
  startedAt?: string;
}

export default function DriverActiveTripPage() {
  const router = useRouter();
  const { session } = useDriverSession();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const tenantId = session?.tenant.id;
  const driverId = session?.user.id;

  // Load active trip
  const loadTrip = useCallback(async () => {
    if (!tenantId || !driverId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/drivers/${driverId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.activeTrip) {
          setTrip(data.activeTrip);
        } else {
          setTrip(null);
        }
      }
    } catch (error) {
      console.error("Failed to load trip:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId, driverId]);

  useEffect(() => {
    loadTrip();
    const poll = setInterval(loadTrip, 5000);
    return () => clearInterval(poll);
  }, [loadTrip]);

  // Elapsed time counter for IN_PROGRESS trips
  useEffect(() => {
    if (trip?.status !== "IN_PROGRESS" || !trip.startedAt) return;

    const startTime = new Date(trip.startedAt).getTime();
    const updateElapsed = () => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [trip?.status, trip?.startedAt]);

  const updateTripStatus = async (newStatus: string) => {
    if (!tenantId || !trip) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/trips/${trip.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setTrip((prev) => prev ? { ...prev, status: newStatus } : null);
          toast.success(`Trip status updated`);

          if (newStatus === "COMPLETED") {
            router.push("/drive/driver");
          }
        } else {
          toast.error(data.error || "Failed to update status");
        }
      } else {
        toast.error("Failed to update trip status");
      }
    } catch (error) {
      toast.error("Connection error");
    } finally {
      setActionLoading(false);
    }
  };

  const cancelTrip = async () => {
    if (!tenantId || !trip) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/trips/${trip.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });

      if (res.ok) {
        toast.info("Trip cancelled");
        router.push("/drive/driver");
      } else {
        toast.error("Failed to cancel trip");
      }
    } catch (error) {
      toast.error("Connection error");
    } finally {
      setActionLoading(false);
      setShowCancelConfirm(false);
    }
  };

  const openMapsNavigation = (address: string, lat?: number, lng?: number) => {
    const destination = lat && lng
      ? `${lat},${lng}`
      : encodeURIComponent(address);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destination}`, "_blank");
  };

  const formatElapsed = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: session?.tenant.currency || "USD",
    }).format(amount / 100);
  };

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="bg-gray-800/50 rounded-2xl p-6 animate-pulse">
          <div className="h-6 bg-gray-700 rounded w-1/3 mb-4" />
          <div className="h-4 bg-gray-700 rounded w-full mb-2" />
          <div className="h-4 bg-gray-700 rounded w-2/3 mb-4" />
          <div className="h-12 bg-gray-700 rounded w-full" />
        </div>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <Icon icon="solar:map-point-wave-bold" className="w-20 h-20 text-gray-700 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">No Active Trip</h2>
        <p className="text-gray-500 mb-6">Go online to receive ride requests</p>
        <button
          onClick={() => router.push("/drive/driver")}
          className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Trip Status Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${
        trip.status === "IN_PROGRESS"
          ? "bg-blue-500/10 border-b border-blue-500/20"
          : trip.status === "DRIVER_ARRIVED"
          ? "bg-amber-500/10 border-b border-amber-500/20"
          : "bg-emerald-500/10 border-b border-emerald-500/20"
      }`}>
        <span className={`text-sm font-semibold ${
          trip.status === "IN_PROGRESS"
            ? "text-blue-400"
            : trip.status === "DRIVER_ARRIVED"
            ? "text-amber-400"
            : "text-emerald-400"
        }`}>
          {trip.status === "ASSIGNED" && "Navigate to Pickup"}
          {trip.status === "DRIVER_ARRIVED" && "Waiting for Passenger"}
          {trip.status === "IN_PROGRESS" && "Trip in Progress"}
        </span>
        {trip.status === "IN_PROGRESS" && (
          <span className="text-blue-400 font-mono font-bold text-lg">
            {formatElapsed(elapsedTime)}
          </span>
        )}
      </div>

      {/* Trip Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Customer Info */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center">
                <Icon icon="solar:user-rounded-bold" className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="font-medium text-white">{trip.customerName}</p>
                <p className="text-xs text-gray-500">Customer</p>
              </div>
            </div>
            {trip.customerPhone && (
              <a
                href={`tel:${trip.customerPhone}`}
                className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center"
              >
                <Icon icon="solar:phone-bold" className="w-5 h-5 text-emerald-400" />
              </a>
            )}
          </div>
        </div>

        {/* Addresses */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-4 space-y-4">
          {/* Pickup */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-3 h-3 rounded-full border-2 border-emerald-400" />
              <span className="text-xs font-medium text-gray-500 uppercase">Pickup</span>
            </div>
            <p className="text-white text-sm ml-5">{trip.pickupAddress}</p>
            {trip.status === "ASSIGNED" && (
              <button
                onClick={() => openMapsNavigation(trip.pickupAddress, trip.pickupLat, trip.pickupLng)}
                className="mt-2 ml-5 flex items-center gap-1.5 text-emerald-400 text-sm font-medium"
              >
                <Icon icon="solar:map-arrow-right-bold" className="w-4 h-4" />
                Navigate
              </button>
            )}
          </div>

          <div className="border-l-2 border-dashed border-gray-700 ml-1.5 h-4" />

          {/* Dropoff */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <span className="text-xs font-medium text-gray-500 uppercase">Dropoff</span>
            </div>
            <p className="text-white text-sm ml-5">{trip.dropoffAddress}</p>
            {trip.status === "IN_PROGRESS" && (
              <button
                onClick={() => openMapsNavigation(trip.dropoffAddress, trip.dropoffLat, trip.dropoffLng)}
                className="mt-2 ml-5 flex items-center gap-1.5 text-blue-400 text-sm font-medium"
              >
                <Icon icon="solar:map-arrow-right-bold" className="w-4 h-4" />
                Navigate
              </button>
            )}
          </div>
        </div>

        {/* Fare */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Estimated Fare</span>
            <span className="text-xl font-bold text-white">{formatCurrency(trip.estimatedFare)}</span>
          </div>
          {trip.distance && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-gray-500 text-sm">Distance</span>
              <span className="text-gray-300 text-sm">{(trip.distance / 1000).toFixed(1)} km</span>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t border-gray-800 space-y-3 bg-gray-950">
        {/* Status-based action buttons */}
        {trip.status === "ASSIGNED" && (
          <>
            <button
              onClick={() => openMapsNavigation(trip.pickupAddress, trip.pickupLat, trip.pickupLng)}
              className="w-full py-4 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
            >
              <Icon icon="solar:map-arrow-right-bold" className="w-5 h-5" />
              Navigate to Pickup
            </button>
            <button
              onClick={() => updateTripStatus("DRIVER_ARRIVED")}
              disabled={actionLoading}
              className="w-full py-4 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {actionLoading ? (
                <Icon icon="solar:loading-bold" className="w-5 h-5 animate-spin" />
              ) : (
                <Icon icon="solar:map-point-bold" className="w-5 h-5" />
              )}
              I&apos;ve Arrived
            </button>
          </>
        )}

        {trip.status === "DRIVER_ARRIVED" && (
          <button
            onClick={() => updateTripStatus("IN_PROGRESS")}
            disabled={actionLoading}
            className="w-full py-4 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {actionLoading ? (
              <Icon icon="solar:loading-bold" className="w-5 h-5 animate-spin" />
            ) : (
              <Icon icon="solar:play-bold" className="w-5 h-5" />
            )}
            Start Trip
          </button>
        )}

        {trip.status === "IN_PROGRESS" && (
          <button
            onClick={() => updateTripStatus("COMPLETED")}
            disabled={actionLoading}
            className="w-full py-4 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {actionLoading ? (
              <Icon icon="solar:loading-bold" className="w-5 h-5 animate-spin" />
            ) : (
              <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
            )}
            Complete Trip
          </button>
        )}

        {/* Cancel button */}
        {trip.status !== "IN_PROGRESS" && !showCancelConfirm && (
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="w-full py-3 bg-gray-800 text-red-400 rounded-xl font-medium hover:bg-gray-750 transition-colors border border-gray-700"
          >
            Cancel Trip
          </button>
        )}

        {/* Cancel confirmation */}
        {showCancelConfirm && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <p className="text-red-400 text-sm text-center mb-3">Are you sure you want to cancel this trip?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 py-2.5 bg-gray-800 text-gray-300 rounded-xl font-medium border border-gray-700"
              >
                No, Keep
              </button>
              <button
                onClick={cancelTrip}
                disabled={actionLoading}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? "Cancelling..." : "Yes, Cancel"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
