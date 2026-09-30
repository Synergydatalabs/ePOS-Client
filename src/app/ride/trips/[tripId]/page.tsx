"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import RideMap from "@/components/ride/RideMap";

interface TripDetail {
  id: string;
  tripNumber: string;
  status: string;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffAddress: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  distance: number | null;
  duration: number | null;
  fare: number | null;
  baseFare: number | null;
  distanceFare: number | null;
  timeFare: number | null;
  bookingFee: number | null;
  surcharge: number | null;
  tip: number | null;
  currency: string;
  paymentMethod: string;
  rideType: string;
  passengerCount: number | null;
  driverName: string | null;
  driverPhoto: string | null;
  driverRating: number | null;
  vehiclePlate: string | null;
  vehicle: string | null;
  vehicleType: string | null;
  customerRating: number | null;
  customerFeedback: string | null;
  requestedAt: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string; gradient: string }> = {
  searching:   { label: "Looking for a driver...", color: "text-amber-700",  bg: "bg-amber-50",   icon: "solar:refresh-bold",       gradient: "from-amber-500 to-orange-500" },
  assigned:    { label: "Driver is on the way",   color: "text-blue-700",   bg: "bg-blue-50",    icon: "solar:user-check-bold",    gradient: "from-blue-500 to-cyan-500" },
  arriving:    { label: "Driver is arriving",     color: "text-indigo-700", bg: "bg-indigo-50",  icon: "solar:car-bold",           gradient: "from-indigo-500 to-purple-500" },
  in_progress: { label: "Ride in progress",       color: "text-purple-700", bg: "bg-purple-50",  icon: "solar:route-bold",         gradient: "from-purple-500 to-pink-500" },
  completed:   { label: "Ride completed",         color: "text-green-700",  bg: "bg-green-50",   icon: "solar:check-circle-bold",  gradient: "from-green-500 to-emerald-500" },
  cancelled:   { label: "Ride cancelled",         color: "text-red-700",    bg: "bg-red-50",     icon: "solar:close-circle-bold",  gradient: "from-red-500 to-rose-500" },
};

const VEHICLE_ICONS: Record<string, string> = {
  sedan: "solar:car-bold",
  suv: "solar:bus-bold",
  van: "solar:bus-bold",
  luxury: "solar:star-bold",
};

export default function TripDetailPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = use(params);
  const router = useRouter();
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const fetchTrip = useCallback(async () => {
    try {
      const res = await fetch(`/api/ride/trips/${tripId}`);
      const data = await res.json();
      if (data.success) {
        setTrip(data.trip);
        if (data.trip.customerRating) setRating(data.trip.customerRating);
        if (data.trip.customerFeedback) setFeedback(data.trip.customerFeedback);
      } else if (data.error === "Unauthorized") {
        router.replace("/ride/login");
      }
    } catch {
      toast.error("Failed to load trip");
    } finally {
      setLoading(false);
    }
  }, [tripId, router]);

  useEffect(() => {
    fetchTrip();
  }, [fetchTrip]);

  // Poll for updates on active trips
  useEffect(() => {
    if (!trip) return;
    const activeStatuses = ["searching", "assigned", "arriving", "in_progress"];
    if (!activeStatuses.includes(trip.status)) return;

    const interval = setInterval(fetchTrip, 10000); // 10 sec
    return () => clearInterval(interval);
  }, [trip?.status, fetchTrip]);

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: trip?.currency || "CAD" }).format(cents / 100);

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString("en-CA", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel this ride?")) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/ride/trips/${tripId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelled by customer" }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Ride cancelled");
        fetchTrip();
      } else {
        toast.error(data.error || "Failed to cancel");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setCancelling(false);
    }
  };

  const handleRate = async () => {
    if (rating === 0) return;
    setSubmittingRating(true);
    try {
      const res = await fetch(`/api/ride/trips/${tripId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, feedback }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Thanks for your feedback!");
        fetchTrip();
      } else {
        toast.error(data.error || "Failed to submit rating");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSubmittingRating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <Icon icon="solar:refresh-bold" className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Icon icon="solar:map-bold" className="w-16 h-16 text-gray-200 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Trip not found</h2>
          <button onClick={() => router.push("/ride/trips")} className="text-indigo-600 font-medium hover:underline">
            Back to trips
          </button>
        </div>
      </div>
    );
  }

  const sc = STATUS_CONFIG[trip.status] || STATUS_CONFIG.searching;
  const isActive = ["searching", "assigned", "arriving", "in_progress"].includes(trip.status);
  const canCancel = ["searching", "assigned"].includes(trip.status);
  const canRate = trip.status === "completed" && !trip.customerRating;

  const pickup = trip.pickupLat && trip.pickupLng ? { lat: trip.pickupLat, lng: trip.pickupLng, address: trip.pickupAddress } : null;
  const dropoff = trip.dropoffLat && trip.dropoffLng ? { lat: trip.dropoffLat, lng: trip.dropoffLng, address: trip.dropoffAddress } : null;

  return (
    <>
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY}&libraries=places&loading=async`}
        strategy="afterInteractive"
        onLoad={() => setMapsLoaded(true)}
        onReady={() => {
          if (typeof window !== "undefined" && (window as any).google?.maps) {
            setMapsLoaded(true);
          }
        }}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push("/ride/trips")} className="p-2 -ml-2 rounded-xl hover:bg-gray-100 transition-colors">
                <Icon icon="solar:arrow-left-bold" className="w-5 h-5 text-gray-600" />
              </button>
              <div>
                <h1 className="font-bold text-gray-900">Trip #{trip.tripNumber}</h1>
              </div>
            </div>
            {isActive && (
              <div className="flex items-center gap-2 text-xs font-medium text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Live
              </div>
            )}
          </div>
        </header>

        <div className="max-w-3xl mx-auto">
          {/* Map section */}
          <div className="h-64 sm:h-80 relative">
            {mapsLoaded && (pickup || dropoff) ? (
              <RideMap pickup={pickup} dropoff={dropoff} className="w-full h-full" />
            ) : (
              <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                <Icon icon="solar:map-bold" className="w-12 h-12 text-gray-300" />
              </div>
            )}

            {/* Status overlay */}
            <div className="absolute bottom-4 left-4 right-4">
              <div className={`${sc.bg} backdrop-blur-sm rounded-2xl p-4 border border-white/50 shadow-lg`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${sc.gradient} flex items-center justify-center`}>
                    <Icon icon={sc.icon} className={`w-5 h-5 text-white ${trip.status === "searching" ? "animate-spin" : ""}`} />
                  </div>
                  <div>
                    <p className={`font-semibold ${sc.color}`}>{sc.label}</p>
                    {trip.status === "searching" && (
                      <p className="text-xs text-gray-500 mt-0.5">This usually takes 1-3 minutes</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="px-4 sm:px-6 py-6 space-y-5">
            {/* Driver card (if assigned) */}
            {trip.driverName && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                    {trip.driverPhoto ? (
                      <img src={trip.driverPhoto} alt="" className="w-full h-full rounded-2xl object-cover" />
                    ) : (
                      <Icon icon="solar:user-bold" className="w-7 h-7 text-indigo-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900 text-lg">{trip.driverName}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {trip.driverRating && (
                        <span className="flex items-center gap-1 text-sm text-gray-600">
                          <Icon icon="solar:star-bold" className="w-4 h-4 text-amber-400" />
                          {trip.driverRating.toFixed(1)}
                        </span>
                      )}
                      {trip.vehicle && (
                        <span className="text-sm text-gray-500">{trip.vehicle}</span>
                      )}
                    </div>
                  </div>
                  {trip.vehiclePlate && (
                    <div className="px-3 py-2 bg-gray-900 rounded-xl">
                      <p className="text-white font-bold text-sm tracking-wider">{trip.vehiclePlate}</p>
                    </div>
                  )}
                </div>
                {trip.vehicleType && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                    <Icon icon={VEHICLE_ICONS[trip.vehicleType] || "solar:car-bold"} className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500 capitalize">{trip.vehicleType}</span>
                  </div>
                )}
              </div>
            )}

            {/* Route details */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Route</h3>
              <div className="flex gap-3">
                <div className="flex flex-col items-center pt-1.5">
                  <div className="w-3 h-3 rounded-full bg-green-500 ring-4 ring-green-100" />
                  <div className="w-0.5 flex-1 bg-gray-200 my-1.5" />
                  <div className="w-3 h-3 rounded-full bg-red-500 ring-4 ring-red-100" />
                </div>
                <div className="flex-1 space-y-5">
                  <div>
                    <p className="text-xs text-gray-400 font-medium mb-1">PICKUP</p>
                    <p className="text-sm font-medium text-gray-900">{trip.pickupAddress}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium mb-1">DROPOFF</p>
                    <p className="text-sm font-medium text-gray-900">{trip.dropoffAddress}</p>
                  </div>
                </div>
              </div>

              {/* Distance & duration */}
              {(trip.distance || trip.duration) && (
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
                  {trip.distance && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Icon icon="solar:route-bold" className="w-4 h-4 text-indigo-500" />
                      <span className="font-medium">{trip.distance.toFixed(1)} km</span>
                    </div>
                  )}
                  {trip.duration && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Icon icon="solar:clock-circle-bold" className="w-4 h-4 text-indigo-500" />
                      <span className="font-medium">{Math.round(trip.duration)} min</span>
                    </div>
                  )}
                  {trip.passengerCount && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Icon icon="solar:users-group-rounded-bold" className="w-4 h-4 text-indigo-500" />
                      <span className="font-medium">{trip.passengerCount} passenger{trip.passengerCount > 1 ? "s" : ""}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Fare breakdown */}
            {trip.fare && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Fare Details</h3>
                <div className="space-y-3">
                  {trip.baseFare != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Base fare</span>
                      <span className="text-gray-900">{formatPrice(trip.baseFare)}</span>
                    </div>
                  )}
                  {trip.distanceFare != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Distance</span>
                      <span className="text-gray-900">{formatPrice(trip.distanceFare)}</span>
                    </div>
                  )}
                  {trip.timeFare != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Time</span>
                      <span className="text-gray-900">{formatPrice(trip.timeFare)}</span>
                    </div>
                  )}
                  {trip.bookingFee != null && trip.bookingFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Booking fee</span>
                      <span className="text-gray-900">{formatPrice(trip.bookingFee)}</span>
                    </div>
                  )}
                  {trip.surcharge != null && trip.surcharge > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Surcharge</span>
                      <span className="text-gray-900">{formatPrice(trip.surcharge)}</span>
                    </div>
                  )}
                  {trip.tip != null && trip.tip > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Tip</span>
                      <span className="text-green-600 font-medium">{formatPrice(trip.tip)}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-100 pt-3 flex justify-between">
                    <span className="font-bold text-gray-900">Total</span>
                    <span className="font-bold text-lg text-gray-900">{formatPrice(trip.fare)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Icon
                      icon={trip.paymentMethod === "cash" ? "solar:wallet-money-bold" : "solar:card-bold"}
                      className="w-4 h-4"
                    />
                    <span className="capitalize">{trip.paymentMethod}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Timeline</h3>
              <div className="space-y-4">
                {trip.requestedAt && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon icon="solar:map-point-bold" className="w-4 h-4 text-indigo-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Ride requested</p>
                      <p className="text-xs text-gray-500">{formatDateTime(trip.requestedAt)}</p>
                    </div>
                  </div>
                )}
                {trip.assignedAt && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon icon="solar:user-check-bold" className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Driver assigned</p>
                      <p className="text-xs text-gray-500">{formatDateTime(trip.assignedAt)}</p>
                    </div>
                  </div>
                )}
                {trip.startedAt && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon icon="solar:route-bold" className="w-4 h-4 text-purple-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Ride started</p>
                      <p className="text-xs text-gray-500">{formatDateTime(trip.startedAt)}</p>
                    </div>
                  </div>
                )}
                {trip.completedAt && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon icon="solar:check-circle-bold" className="w-4 h-4 text-green-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Ride completed</p>
                      <p className="text-xs text-gray-500">{formatDateTime(trip.completedAt)}</p>
                    </div>
                  </div>
                )}
                {trip.cancelledAt && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon icon="solar:close-circle-bold" className="w-4 h-4 text-red-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Ride cancelled</p>
                      <p className="text-xs text-gray-500">{formatDateTime(trip.cancelledAt)}</p>
                      {trip.cancelReason && (
                        <p className="text-xs text-gray-400 mt-0.5">{trip.cancelReason}</p>
                      )}
                    </div>
                  </div>
                )}
                {!trip.requestedAt && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon icon="solar:calendar-bold" className="w-4 h-4 text-gray-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Booked</p>
                      <p className="text-xs text-gray-500">{formatDateTime(trip.createdAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Rating section (completed trips) */}
            {canRate && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Rate your ride</h3>
                <div className="text-center space-y-4">
                  <div className="flex items-center justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setRating(star)}
                        className="p-1 transition-transform hover:scale-110 active:scale-95"
                      >
                        <Icon
                          icon="solar:star-bold"
                          className={`w-10 h-10 transition-colors ${
                            star <= rating ? "text-amber-400" : "text-gray-200 hover:text-amber-200"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  {rating > 0 && (
                    <>
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="How was your experience? (optional)"
                        rows={3}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                      />
                      <button
                        onClick={handleRate}
                        disabled={submittingRating}
                        className="w-full py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:shadow-xl active:scale-[0.98] transition-all disabled:opacity-60"
                      >
                        {submittingRating ? (
                          <span className="flex items-center justify-center gap-2">
                            <Icon icon="solar:refresh-bold" className="w-5 h-5 animate-spin" /> Submitting...
                          </span>
                        ) : (
                          "Submit Rating"
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Existing rating display */}
            {trip.customerRating && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Your Rating</h3>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Icon
                      key={star}
                      icon="solar:star-bold"
                      className={`w-6 h-6 ${star <= trip.customerRating! ? "text-amber-400" : "text-gray-200"}`}
                    />
                  ))}
                </div>
                {trip.customerFeedback && (
                  <p className="text-sm text-gray-600 mt-2 italic">&ldquo;{trip.customerFeedback}&rdquo;</p>
                )}
              </div>
            )}

            {/* Cancel button */}
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full py-3.5 rounded-2xl border-2 border-red-200 text-red-600 font-semibold hover:bg-red-50 active:scale-[0.98] transition-all disabled:opacity-60"
              >
                {cancelling ? (
                  <span className="flex items-center justify-center gap-2">
                    <Icon icon="solar:refresh-bold" className="w-5 h-5 animate-spin" /> Cancelling...
                  </span>
                ) : (
                  "Cancel Ride"
                )}
              </button>
            )}

            {/* Book another */}
            {!isActive && (
              <button
                onClick={() => router.push("/ride/book")}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:shadow-xl active:scale-[0.98] transition-all"
              >
                Book Another Ride
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
