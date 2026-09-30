"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AddressAutocomplete from "@/components/ride/AddressAutocomplete";
import RideMap from "@/components/ride/RideMap";

interface Location { lat: number; lng: number; address: string; placeId: string }
interface Estimate { fareRuleId: string; vehicleType: string; name: string; total: number; estimatedMinutes: number; distanceKm: number; baseFare: number; distanceFare: number; timeFare: number; bookingFee: number }

const VEHICLE_ICONS: Record<string, { icon: string; label: string; desc: string }> = {
  sedan:   { icon: "solar:car-bold", label: "Sedan", desc: "Comfortable, up to 4" },
  suv:     { icon: "solar:bus-bold", label: "SUV", desc: "Spacious, up to 5" },
  van:     { icon: "solar:bus-bold", label: "Van", desc: "Group ride, up to 7" },
  luxury:  { icon: "solar:star-bold", label: "Luxury", desc: "Premium experience" },
};

export default function BookRidePage() {
  const router = useRouter();
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Booking state
  const [pickup, setPickup] = useState<Location | null>(null);
  const [dropoff, setDropoff] = useState<Location | null>(null);
  const [distanceKm, setDistanceKm] = useState(0);
  const [durationMin, setDurationMin] = useState(0);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [selectedType, setSelectedType] = useState("sedan");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [passengers, setPassengers] = useState(1);
  const [booking, setBooking] = useState(false);
  const [step, setStep] = useState<"address" | "options" | "confirm">("address");

  // Auth check
  useEffect(() => {
    fetch("/api/ride/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) router.replace("/ride/login");
        else { setCustomer(d.customer); setLoading(false); }
      })
      .catch(() => router.replace("/ride/login"));
  }, [router]);

  // Route calculated callback
  const onRouteCalculated = useCallback((km: number, min: number) => {
    setDistanceKm(km);
    setDurationMin(min);
    setStep("options");
  }, []);

  // Fetch fare estimates when route is calculated
  useEffect(() => {
    if (distanceKm <= 0 || durationMin <= 0) return;

    fetch("/api/ride/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distanceKm, durationMinutes: durationMin }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.estimates) setEstimates(d.estimates); })
      .catch(() => toast.error("Failed to get fare estimates"));
  }, [distanceKm, durationMin]);

  const selectedEstimate = estimates.find((e) => e.vehicleType === selectedType) || estimates[0];

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

  const handleBook = async () => {
    if (!pickup || !dropoff || !selectedEstimate) return;
    setBooking(true);
    try {
      const res = await fetch("/api/ride/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupAddress: pickup.address, pickupLat: pickup.lat, pickupLng: pickup.lng,
          dropoffAddress: dropoff.address, dropoffLat: dropoff.lat, dropoffLng: dropoff.lng,
          vehicleType: selectedType, fareRuleId: selectedEstimate.fareRuleId,
          estimatedDistanceKm: distanceKm, estimatedDurationMinutes: durationMin,
          estimatedFare: selectedEstimate.total,
          paymentMethod, rideType: "standard", passengerCount: passengers,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Ride booked! Looking for a driver...");
        router.push(`/ride/trips/${data.trip.id}`);
      } else {
        toast.error(data.error || "Failed to book ride");
      }
    } catch { toast.error("Something went wrong"); }
    finally { setBooking(false); }
  };

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
    <>
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY}&libraries=places&loading=async`}
        strategy="afterInteractive"
        onLoad={() => setMapsLoaded(true)}
        onReady={() => {
          // fires on re-mount if the script tag is already in the DOM
          if (typeof window !== "undefined" && (window as any).google?.maps) {
            setMapsLoaded(true);
          }
        }}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Icon icon="solar:car-bold" className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-lg text-gray-900">{customer?.tenantName || "Ride"}</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => router.push("/ride/trips")} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                <Icon icon="solar:route-bold" className="w-4 h-4" /> My Trips
              </button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="text-sm font-bold text-indigo-600">{customer?.name?.[0]}</span>
                </div>
                <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors">
                  <Icon icon="solar:logout-2-bold" className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main content */}
        <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)]">
          {/* Left panel — Booking form */}
          <div className="w-full lg:w-[420px] xl:w-[460px] flex-shrink-0 bg-white border-r border-gray-100 overflow-y-auto">
            <div className="p-6 space-y-6">
              {/* Greeting */}
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Where to, {customer?.name?.split(" ")[0]}?
                </h1>
                <p className="text-gray-500 mt-1">Enter your pickup and destination</p>
              </div>

              {/* Address inputs */}
              <div className="space-y-3">
                <div className="relative">
                  <div className="absolute left-6 top-[52px] w-0.5 h-6 bg-gray-200 z-10" />
                  {mapsLoaded ? (
                    <AddressAutocomplete
                      placeholder="Pickup location"
                      icon="solar:map-point-bold"
                      iconColor="text-green-500"
                      value={pickup?.address}
                      onSelect={(p) => setPickup(p)}
                      onClear={() => { setPickup(null); setEstimates([]); setStep("address"); }}
                      autoFocus
                    />
                  ) : (
                    <div className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl text-gray-400 text-[15px]">Loading maps...</div>
                  )}
                </div>
                {mapsLoaded ? (
                  <AddressAutocomplete
                    placeholder="Where to?"
                    icon="solar:map-point-bold"
                    iconColor="text-red-500"
                    value={dropoff?.address}
                    onSelect={(p) => setDropoff(p)}
                    onClear={() => { setDropoff(null); setEstimates([]); setStep("address"); }}
                  />
                ) : (
                  <div className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl text-gray-400 text-[15px]">Loading maps...</div>
                )}
              </div>

              {/* Route info */}
              {distanceKm > 0 && (
                <div className="flex items-center gap-4 px-4 py-3 bg-indigo-50 rounded-2xl">
                  <div className="flex items-center gap-2 text-sm text-indigo-700">
                    <Icon icon="solar:route-bold" className="w-4 h-4" />
                    <span className="font-semibold">{distanceKm.toFixed(1)} km</span>
                  </div>
                  <div className="w-px h-4 bg-indigo-200" />
                  <div className="flex items-center gap-2 text-sm text-indigo-700">
                    <Icon icon="solar:clock-circle-bold" className="w-4 h-4" />
                    <span className="font-semibold">{Math.round(durationMin)} min</span>
                  </div>
                </div>
              )}

              {/* Vehicle type selection */}
              {step !== "address" && estimates.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-gray-900">Choose your ride</h3>
                  <div className="space-y-2">
                    {estimates.map((est) => {
                      const config = VEHICLE_ICONS[est.vehicleType] || VEHICLE_ICONS.sedan;
                      const isSelected = selectedType === est.vehicleType;
                      return (
                        <button
                          key={est.vehicleType}
                          onClick={() => { setSelectedType(est.vehicleType); setStep("confirm"); }}
                          className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                            isSelected
                              ? "border-indigo-500 bg-indigo-50 shadow-sm"
                              : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isSelected ? "bg-indigo-100" : "bg-gray-100"}`}>
                            <Icon icon={config.icon} className={`w-6 h-6 ${isSelected ? "text-indigo-600" : "text-gray-500"}`} />
                          </div>
                          <div className="flex-1 text-left">
                            <div className="font-semibold text-gray-900">{config.label}</div>
                            <div className="text-sm text-gray-500">{config.desc} &middot; {Math.round(est.estimatedMinutes)} min</div>
                          </div>
                          <div className={`text-lg font-bold ${isSelected ? "text-indigo-600" : "text-gray-900"}`}>
                            {formatPrice(est.total)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Payment & options */}
              {step === "confirm" && selectedEstimate && (
                <div className="space-y-4">
                  {/* Payment method */}
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                    <div className="flex items-center gap-3">
                      <Icon icon={paymentMethod === "cash" ? "solar:wallet-money-bold" : "solar:card-bold"} className="w-5 h-5 text-gray-600" />
                      <span className="font-medium text-gray-900">
                        {paymentMethod === "cash" ? "Cash" : "Card"}
                      </span>
                    </div>
                    <button
                      onClick={() => setPaymentMethod(paymentMethod === "cash" ? "card" : "cash")}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      Change
                    </button>
                  </div>

                  {/* Passengers */}
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                    <div className="flex items-center gap-3">
                      <Icon icon="solar:users-group-rounded-bold" className="w-5 h-5 text-gray-600" />
                      <span className="font-medium text-gray-900">{passengers} Passenger{passengers > 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setPassengers(Math.max(1, passengers - 1))} className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100">
                        <Icon icon="solar:minus-circle-bold" className="w-4 h-4 text-gray-600" />
                      </button>
                      <span className="w-6 text-center font-semibold">{passengers}</span>
                      <button onClick={() => setPassengers(Math.min(7, passengers + 1))} className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100">
                        <Icon icon="solar:add-circle-bold" className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </div>

                  {/* Fare breakdown */}
                  <div className="p-4 bg-gray-50 rounded-2xl space-y-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Base fare</span><span>{formatPrice(selectedEstimate.baseFare)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Distance ({selectedEstimate.distanceKm} km)</span><span>{formatPrice(selectedEstimate.distanceFare)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Time ({Math.round(selectedEstimate.estimatedMinutes)} min)</span><span>{formatPrice(selectedEstimate.timeFare)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Booking fee</span><span>{formatPrice(selectedEstimate.bookingFee)}</span>
                    </div>
                    <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-gray-900">
                      <span>Estimated total</span><span>{formatPrice(selectedEstimate.total)}</span>
                    </div>
                  </div>

                  {/* Book button */}
                  <button
                    onClick={handleBook}
                    disabled={booking}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-lg shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {booking ? (
                      <span className="flex items-center justify-center gap-2">
                        <Icon icon="solar:refresh-bold" className="w-5 h-5 animate-spin" /> Booking...
                      </span>
                    ) : (
                      `Book ${VEHICLE_ICONS[selectedType]?.label || "Ride"} — ${formatPrice(selectedEstimate.total)}`
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right panel — Map */}
          <div className="flex-1 relative min-h-[300px] lg:min-h-0">
            {mapsLoaded ? (
              <RideMap
                pickup={pickup}
                dropoff={dropoff}
                onRouteCalculated={onRouteCalculated}
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                <div className="text-center">
                  <Icon icon="solar:map-bold" className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-400">Loading map...</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
