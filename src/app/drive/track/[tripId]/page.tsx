"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface TripDetails {
  id: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  estimatedFare: number;
  currency: string;
  customerName: string;
  driver?: {
    firstName: string;
    lastName?: string;
    phone?: string;
    rating?: number;
    vehicle?: {
      plate: string;
      color: string;
      make: string;
      model: string;
    };
  };
  estimatedArrival?: string;
  createdAt: string;
}

const STATUS_STEPS = [
  { key: "SEARCHING", label: "Searching for driver", icon: "solar:magnifer-bold" },
  { key: "ASSIGNED", label: "Driver assigned", icon: "solar:user-check-bold" },
  { key: "DRIVER_EN_ROUTE", label: "Driver en route", icon: "solar:car-bold" },
  { key: "DRIVER_ARRIVED", label: "Driver arrived", icon: "solar:map-point-bold" },
  { key: "IN_PROGRESS", label: "Trip in progress", icon: "solar:route-bold" },
  { key: "COMPLETED", label: "Trip completed", icon: "solar:check-circle-bold" },
];

export default function TripTrackingPage() {
  const params = useParams();
  const router = useRouter();
  const tripId = params.tripId as string;

  const [trip, setTrip] = useState<TripDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("drive_tenant_id")
    : null;

  const loadTrip = useCallback(async () => {
    if (!tenantId || !tripId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/trips/${tripId}`);
      if (res.ok) {
        const data = await res.json();
        setTrip(data.trip || data);
      }
    } catch (error) {
      console.error("Failed to load trip:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId, tripId]);

  useEffect(() => {
    loadTrip();

    // Auto-refresh every 5 seconds
    const poll = setInterval(loadTrip, 5000);
    return () => clearInterval(poll);
  }, [loadTrip]);

  const cancelTrip = async () => {
    if (!tenantId || !tripId) return;

    setCancelling(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/trips/${tripId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });

      if (res.ok) {
        toast.info("Ride cancelled");
        router.push("/drive");
      } else {
        toast.error("Failed to cancel ride");
      }
    } catch (error) {
      toast.error("Connection error");
    } finally {
      setCancelling(false);
      setShowCancelConfirm(false);
    }
  };

  const getStatusIndex = (status: string) => {
    // Map ASSIGNED to DRIVER_EN_ROUTE for display
    const idx = STATUS_STEPS.findIndex((s) => s.key === status);
    return idx >= 0 ? idx : 0;
  };

  const formatCurrency = (amount: number, currency = "USD") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-2xl p-6 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/2 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gray-200 rounded-full" />
                  <div className="h-4 bg-gray-200 rounded flex-1" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <Icon icon="solar:map-point-wave-bold" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Trip not found</h2>
        <p className="text-gray-500 mb-6">This trip may have been cancelled or does not exist.</p>
        <button
          onClick={() => router.push("/drive")}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700"
        >
          Book a New Ride
        </button>
      </div>
    );
  }

  const currentStep = getStatusIndex(trip.status);
  const isCancelled = trip.status === "CANCELLED";
  const isCompleted = trip.status === "COMPLETED";
  const canCancel = !isCancelled && !isCompleted && trip.status !== "IN_PROGRESS";

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Trip Status Steps */}
      <div className="bg-gray-50 rounded-2xl p-5">
        <h2 className="text-lg font-bold text-gray-900 mb-4">
          {isCancelled ? "Ride Cancelled" : isCompleted ? "Ride Completed" : "Your Ride"}
        </h2>

        {isCancelled ? (
          <div className="text-center py-4">
            <Icon icon="solar:close-circle-bold" className="w-12 h-12 text-red-400 mx-auto mb-2" />
            <p className="text-gray-500">This ride has been cancelled</p>
          </div>
        ) : (
          <div className="space-y-0">
            {STATUS_STEPS.map((step, idx) => {
              const isActive = idx === currentStep;
              const isDone = idx < currentStep;
              const isFuture = idx > currentStep;

              return (
                <div key={step.key} className="flex items-start gap-3">
                  {/* Step indicator */}
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isDone
                        ? "bg-emerald-500"
                        : isActive
                        ? "bg-blue-500 animate-pulse"
                        : "bg-gray-200"
                    }`}>
                      {isDone ? (
                        <Icon icon="solar:check-read-bold" className="w-4 h-4 text-white" />
                      ) : (
                        <Icon
                          icon={step.icon}
                          className={`w-4 h-4 ${isActive ? "text-white" : "text-gray-400"}`}
                        />
                      )}
                    </div>
                    {idx < STATUS_STEPS.length - 1 && (
                      <div className={`w-0.5 h-8 ${
                        isDone ? "bg-emerald-500" : "bg-gray-200"
                      }`} />
                    )}
                  </div>

                  {/* Step label */}
                  <div className="pt-1.5 pb-4">
                    <p className={`text-sm font-medium ${
                      isDone
                        ? "text-emerald-600"
                        : isActive
                        ? "text-blue-600"
                        : "text-gray-400"
                    }`}>
                      {step.label}
                      {isActive && !isCompleted && (
                        <span className="ml-2 inline-block w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Driver Info Card */}
      {trip.driver && (
        <div className="bg-gray-50 rounded-2xl p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Your Driver
          </h3>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
              <Icon icon="solar:user-rounded-bold" className="w-6 h-6 text-gray-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900">
                {trip.driver.firstName} {trip.driver.lastName || ""}
              </p>
              {trip.driver.rating && (
                <div className="flex items-center gap-1">
                  <Icon icon="solar:star-bold" className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs text-gray-500">{trip.driver.rating.toFixed(1)}</span>
                </div>
              )}
            </div>
            {trip.driver.phone && (
              <a
                href={`tel:${trip.driver.phone}`}
                className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center"
              >
                <Icon icon="solar:phone-bold" className="w-5 h-5 text-emerald-600" />
              </a>
            )}
          </div>

          {/* Vehicle info */}
          {trip.driver.vehicle && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-3 text-sm text-gray-600">
              <div className="flex items-center gap-1.5">
                <Icon icon="solar:car-bold" className="w-4 h-4 text-gray-400" />
                <span>{trip.driver.vehicle.color} {trip.driver.vehicle.make} {trip.driver.vehicle.model}</span>
              </div>
              <span className="font-mono font-semibold text-gray-900 bg-gray-200 px-2 py-0.5 rounded">
                {trip.driver.vehicle.plate}
              </span>
            </div>
          )}

          {/* ETA */}
          {trip.estimatedArrival && trip.status !== "COMPLETED" && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-2">
              <Icon icon="solar:clock-circle-bold" className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-gray-600">
                Estimated arrival: <span className="font-semibold text-gray-900">{trip.estimatedArrival}</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Trip Details */}
      <div className="bg-gray-50 rounded-2xl p-4">
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 mt-1 rounded-full border-2 border-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Pickup</p>
              <p className="text-sm text-gray-900">{trip.pickupAddress}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 mt-1 rounded-full bg-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Dropoff</p>
              <p className="text-sm text-gray-900">{trip.dropoffAddress}</p>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-gray-500">Estimated Fare</span>
          <span className="text-lg font-bold text-gray-900">
            {formatCurrency(trip.estimatedFare, trip.currency)}
          </span>
        </div>
      </div>

      {/* Cancel Button */}
      {canCancel && (
        <>
          {!showCancelConfirm ? (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="w-full py-3 bg-white text-red-500 rounded-xl font-medium border border-red-200 hover:bg-red-50 transition-colors"
            >
              Cancel Ride
            </button>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-600 text-sm text-center mb-3">
                Are you sure you want to cancel this ride?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 py-2.5 bg-white text-gray-700 rounded-xl font-medium border border-gray-200"
                >
                  Keep Ride
                </button>
                <button
                  onClick={cancelTrip}
                  disabled={cancelling}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {cancelling ? "Cancelling..." : "Yes, Cancel"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Completed / Back button */}
      {(isCompleted || isCancelled) && (
        <button
          onClick={() => router.push("/drive")}
          className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
        >
          Book Another Ride
        </button>
      )}
    </div>
  );
}
