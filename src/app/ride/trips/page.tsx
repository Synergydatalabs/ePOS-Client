"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";

interface Trip {
  id: string;
  tripNumber: string;
  status: string;
  pickupAddress: string;
  dropoffAddress: string;
  distance: number | null;
  duration: number | null;
  fare: number | null;
  currency: string;
  paymentMethod: string;
  rideType: string;
  driverName: string | null;
  vehiclePlate: string | null;
  vehicle: string | null;
  customerRating: number | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  searching:   { label: "Searching",   color: "text-amber-700",  bg: "bg-amber-50 border-amber-200",   icon: "solar:refresh-bold" },
  assigned:    { label: "Driver Found", color: "text-blue-700",   bg: "bg-blue-50 border-blue-200",     icon: "solar:user-check-bold" },
  arriving:    { label: "Arriving",    color: "text-indigo-700", bg: "bg-indigo-50 border-indigo-200", icon: "solar:car-bold" },
  in_progress: { label: "In Progress", color: "text-purple-700", bg: "bg-purple-50 border-purple-200", icon: "solar:route-bold" },
  completed:   { label: "Completed",   color: "text-green-700",  bg: "bg-green-50 border-green-200",   icon: "solar:check-circle-bold" },
  cancelled:   { label: "Cancelled",   color: "text-red-700",    bg: "bg-red-50 border-red-200",       icon: "solar:close-circle-bold" },
};

export default function TripsPage() {
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<any>(null);

  useEffect(() => {
    // Check auth
    fetch("/api/ride/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.replace("/ride/login");
        else setCustomer(d.customer);
      })
      .catch(() => router.replace("/ride/login"));

    // Fetch trips
    fetch("/api/ride/trips")
      .then((r) => r.json())
      .then((d) => {
        if (d.trips) setTrips(d.trips);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  const formatPrice = (cents: number, currency = "CAD") =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today, ${d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}`;
    } else if (diffDays === 1) {
      return `Yesterday, ${d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}`;
    } else if (diffDays < 7) {
      return d.toLocaleDateString("en-CA", { weekday: "long", hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const activeTrips = trips.filter((t) => ["searching", "assigned", "arriving", "in_progress"].includes(t.status));
  const pastTrips = trips.filter((t) => ["completed", "cancelled"].includes(t.status));

  const handleLogout = async () => {
    await fetch("/api/ride/auth/session", { method: "DELETE" });
    router.replace("/ride/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <Icon icon="solar:refresh-bold" className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/ride/book")} className="p-2 -ml-2 rounded-xl hover:bg-gray-100 transition-colors">
              <Icon icon="solar:arrow-left-bold" className="w-5 h-5 text-gray-600" />
            </button>
            <h1 className="font-bold text-lg text-gray-900">My Trips</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
              <span className="text-sm font-bold text-indigo-600">{customer?.name?.[0]}</span>
            </div>
            <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors">
              <Icon icon="solar:logout-2-bold" className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* Active trips */}
        {activeTrips.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider px-1">Active Rides</h2>
            {activeTrips.map((trip) => {
              const sc = STATUS_CONFIG[trip.status] || STATUS_CONFIG.searching;
              return (
                <button
                  key={trip.id}
                  onClick={() => router.push(`/ride/trips/${trip.id}`)}
                  className="w-full bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-lg hover:shadow-gray-100 hover:border-gray-200 transition-all text-left group"
                >
                  {/* Status badge */}
                  <div className="flex items-center justify-between mb-4">
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${sc.bg}`}>
                      <Icon icon={sc.icon} className={`w-4 h-4 ${sc.color} ${trip.status === "searching" ? "animate-spin" : ""}`} />
                      <span className={`text-xs font-semibold ${sc.color}`}>{sc.label}</span>
                    </div>
                    <span className="text-xs text-gray-400">#{trip.tripNumber}</span>
                  </div>

                  {/* Route */}
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center pt-1">
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500 ring-4 ring-green-100" />
                      <div className="w-0.5 h-8 bg-gray-200 my-1" />
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 ring-4 ring-red-100" />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900 line-clamp-1">{trip.pickupAddress}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 line-clamp-1">{trip.dropoffAddress}</p>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      {trip.driverName && (
                        <span className="flex items-center gap-1.5">
                          <Icon icon="solar:user-bold" className="w-4 h-4" />
                          {trip.driverName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-indigo-600 font-semibold text-sm group-hover:translate-x-0.5 transition-transform">
                      Track <Icon icon="solar:arrow-right-bold" className="w-4 h-4" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Past trips */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider px-1">
            {activeTrips.length > 0 ? "Past Rides" : "Your Rides"}
          </h2>

          {pastTrips.length === 0 && activeTrips.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
                <Icon icon="solar:car-bold" className="w-8 h-8 text-indigo-300" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No trips yet</h3>
              <p className="text-gray-500 mb-6">Book your first ride to get started!</p>
              <button
                onClick={() => router.push("/ride/book")}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 active:scale-[0.98] transition-all"
              >
                <Icon icon="solar:map-point-bold" className="w-5 h-5" />
                Book a Ride
              </button>
            </div>
          )}

          {pastTrips.map((trip) => {
            const sc = STATUS_CONFIG[trip.status] || STATUS_CONFIG.completed;
            return (
              <button
                key={trip.id}
                onClick={() => router.push(`/ride/trips/${trip.id}`)}
                className="w-full bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-lg hover:shadow-gray-100 hover:border-gray-200 transition-all text-left group"
              >
                {/* Top row */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${sc.bg}`}>
                      <Icon icon={sc.icon} className={`w-3.5 h-3.5 ${sc.color}`} />
                      <span className={`text-xs font-medium ${sc.color}`}>{sc.label}</span>
                    </div>
                    <span className="text-xs text-gray-400">#{trip.tripNumber}</span>
                  </div>
                  <span className="text-sm text-gray-500">{formatDate(trip.createdAt)}</span>
                </div>

                {/* Route */}
                <div className="flex gap-3">
                  <div className="flex flex-col items-center pt-1">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <div className="w-0.5 h-6 bg-gray-200 my-0.5" />
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="text-sm text-gray-700 line-clamp-1">{trip.pickupAddress}</p>
                    <p className="text-sm text-gray-700 line-clamp-1">{trip.dropoffAddress}</p>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    {trip.fare && (
                      <span className="font-semibold text-gray-900">{formatPrice(trip.fare, trip.currency)}</span>
                    )}
                    {trip.distance && (
                      <span className="flex items-center gap-1">
                        <Icon icon="solar:route-bold" className="w-3.5 h-3.5" />
                        {trip.distance.toFixed(1)} km
                      </span>
                    )}
                    {trip.driverName && (
                      <span className="flex items-center gap-1">
                        <Icon icon="solar:user-bold" className="w-3.5 h-3.5" />
                        {trip.driverName}
                      </span>
                    )}
                  </div>
                  {trip.customerRating && (
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Icon
                          key={i}
                          icon="solar:star-bold"
                          className={`w-3.5 h-3.5 ${i < trip.customerRating! ? "text-amber-400" : "text-gray-200"}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Book ride FAB */}
        <div className="fixed bottom-6 right-6 z-50">
          <button
            onClick={() => router.push("/ride/book")}
            className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold shadow-xl shadow-indigo-300 hover:shadow-2xl hover:shadow-indigo-400 active:scale-95 transition-all"
          >
            <Icon icon="solar:map-point-add-bold" className="w-5 h-5" />
            Book a Ride
          </button>
        </div>
      </div>
    </div>
  );
}
