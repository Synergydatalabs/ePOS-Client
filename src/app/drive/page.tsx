"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

type RideType = "standard" | "premium" | "van";
type PaymentMethod = "cash" | "online";

interface RecentDestination {
  address: string;
  usedAt: string;
}

interface FareEstimate {
  fare: number;
  currency: string;
  distance: string;
  duration: string;
}

export default function CustomerBookingPage() {
  const router = useRouter();
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [rideType, setRideType] = useState<RideType>("standard");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [recentDestinations, setRecentDestinations] = useState<RecentDestination[]>([]);
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [booking, setBooking] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);

  // Extract tenantId from URL or use default
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    // Get tenantId from query params or localStorage
    const params = new URLSearchParams(window.location.search);
    const tid = params.get("tenant") || localStorage.getItem("drive_tenant_id");
    if (tid) {
      setTenantId(tid);
      localStorage.setItem("drive_tenant_id", tid);
    }

    // Load recent destinations from localStorage
    const stored = localStorage.getItem("drive_recent_destinations");
    if (stored) {
      try {
        setRecentDestinations(JSON.parse(stored));
      } catch {}
    }
  }, []);

  const detectLocation = async () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }

    setDetectingLocation(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      // Use coordinates as address for now (reverse geocoding would happen server-side)
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);
      setPickupAddress(`${lat}, ${lng}`);
      toast.success("Location detected");
    } catch (error) {
      toast.error("Could not detect location. Please enter address manually.");
    } finally {
      setDetectingLocation(false);
    }
  };

  const getEstimate = async () => {
    if (!tenantId || !pickupAddress || !dropoffAddress) return;

    setLoadingEstimate(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/trips/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupAddress,
          dropoffAddress,
          rideType,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setFareEstimate(data.estimate || {
          fare: 1500,
          currency: "USD",
          distance: "5.2 km",
          duration: "12 min",
        });
      } else {
        // Fallback estimate for demo
        setFareEstimate({
          fare: 1500,
          currency: "USD",
          distance: "~5 km",
          duration: "~12 min",
        });
      }
    } catch (error) {
      // Fallback estimate
      setFareEstimate({
        fare: 1500,
        currency: "USD",
        distance: "~5 km",
        duration: "~12 min",
      });
    } finally {
      setLoadingEstimate(false);
    }
  };

  // Auto-estimate when both addresses are filled
  useEffect(() => {
    if (pickupAddress.length > 3 && dropoffAddress.length > 3) {
      const timer = setTimeout(getEstimate, 800);
      return () => clearTimeout(timer);
    } else {
      setFareEstimate(null);
    }
  }, [pickupAddress, dropoffAddress, rideType]);

  const saveRecentDestination = (address: string) => {
    const updated = [
      { address, usedAt: new Date().toISOString() },
      ...recentDestinations.filter((d) => d.address !== address),
    ].slice(0, 5);
    setRecentDestinations(updated);
    localStorage.setItem("drive_recent_destinations", JSON.stringify(updated));
  };

  const bookRide = async () => {
    if (!tenantId) {
      toast.error("Service not configured");
      return;
    }
    if (!pickupAddress || !dropoffAddress) {
      toast.error("Please enter pickup and dropoff addresses");
      return;
    }
    if (!customerName) {
      toast.error("Please enter your name");
      return;
    }
    if (!customerPhone) {
      toast.error("Please enter your phone number");
      return;
    }

    setBooking(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/trips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupAddress,
          dropoffAddress,
          customerName,
          customerPhone,
          rideType,
          paymentMethod,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        saveRecentDestination(dropoffAddress);
        toast.success("Ride booked! Finding your driver...");
        router.push(`/drive/track/${data.trip?.id || data.tripId || "pending"}`);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to book ride");
      }
    } catch (error) {
      toast.error("Connection error. Please try again.");
    } finally {
      setBooking(false);
    }
  };

  const formatCurrency = (amount: number, currency = "USD") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const rideTypes: { key: RideType; label: string; icon: string; description: string }[] = [
    { key: "standard", label: "Standard", icon: "solar:car-bold", description: "Everyday rides" },
    { key: "premium", label: "Premium", icon: "solar:car-bold", description: "Luxury vehicles" },
    { key: "van", label: "Van", icon: "solar:bus-bold", description: "Groups & luggage" },
  ];

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Where to Section */}
      <div className="space-y-3">
        {/* Pickup */}
        <div className="relative">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-emerald-500" />
          <input
            type="text"
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            placeholder="Pickup location"
            className="w-full pl-10 pr-12 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 placeholder-gray-400 text-sm"
          />
          <button
            onClick={detectLocation}
            disabled={detectingLocation}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-500"
            title="Use my location"
          >
            {detectingLocation ? (
              <Icon icon="solar:loading-bold" className="w-5 h-5 animate-spin" />
            ) : (
              <Icon icon="solar:gps-bold" className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Dropoff */}
        <div className="relative">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-red-500" />
          <input
            type="text"
            value={dropoffAddress}
            onChange={(e) => setDropoffAddress(e.target.value)}
            placeholder="Where to?"
            className="w-full pl-10 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 placeholder-gray-400 text-sm font-medium"
          />
        </div>
      </div>

      {/* Recent Destinations */}
      {recentDestinations.length > 0 && !dropoffAddress && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
            Recent
          </h3>
          <div className="space-y-1">
            {recentDestinations.map((dest, idx) => (
              <button
                key={idx}
                onClick={() => setDropoffAddress(dest.address)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors text-left"
              >
                <Icon icon="solar:clock-circle-linear" className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-700 truncate">{dest.address}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ride Type Selector */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
          Ride Type
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {rideTypes.map((type) => (
            <button
              key={type.key}
              onClick={() => setRideType(type.key)}
              className={`p-3 rounded-xl border-2 transition-all text-center ${
                rideType === type.key
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <Icon
                icon={type.icon}
                className={`w-6 h-6 mx-auto mb-1 ${
                  rideType === type.key ? "text-blue-600" : "text-gray-400"
                }`}
              />
              <p className={`text-xs font-semibold ${
                rideType === type.key ? "text-blue-600" : "text-gray-700"
              }`}>
                {type.label}
              </p>
              <p className="text-[10px] text-gray-400">{type.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Customer Details */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">
          Your Details
        </h3>
        <div className="relative">
          <Icon
            icon="solar:user-rounded-linear"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
          />
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Your name"
            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 placeholder-gray-400 text-sm"
          />
        </div>
        <div className="relative">
          <Icon
            icon="solar:phone-linear"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
          />
          <input
            type="tel"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="Phone number"
            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900 placeholder-gray-400 text-sm"
          />
        </div>
      </div>

      {/* Payment Method */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
          Payment
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setPaymentMethod("cash")}
            className={`p-3 rounded-xl border-2 transition-all flex items-center gap-2 ${
              paymentMethod === "cash"
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <Icon
              icon="solar:wallet-bold"
              className={`w-5 h-5 ${paymentMethod === "cash" ? "text-blue-600" : "text-gray-400"}`}
            />
            <span className={`text-sm font-medium ${
              paymentMethod === "cash" ? "text-blue-600" : "text-gray-700"
            }`}>
              Pay in Car
            </span>
          </button>
          <button
            onClick={() => setPaymentMethod("online")}
            className={`p-3 rounded-xl border-2 transition-all flex items-center gap-2 ${
              paymentMethod === "online"
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <Icon
              icon="solar:card-bold"
              className={`w-5 h-5 ${paymentMethod === "online" ? "text-blue-600" : "text-gray-400"}`}
            />
            <span className={`text-sm font-medium ${
              paymentMethod === "online" ? "text-blue-600" : "text-gray-700"
            }`}>
              Pay Online
            </span>
          </button>
        </div>
      </div>

      {/* Fare Estimate Card */}
      {(fareEstimate || loadingEstimate) && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
          {loadingEstimate ? (
            <div className="flex items-center justify-center py-3">
              <Icon icon="solar:loading-bold" className="w-6 h-6 text-blue-500 animate-spin mr-2" />
              <span className="text-gray-500 text-sm">Calculating fare...</span>
            </div>
          ) : fareEstimate && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-500 text-sm">Estimated Fare</span>
                <span className="text-2xl font-bold text-gray-900">
                  {formatCurrency(fareEstimate.fare, fareEstimate.currency)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Icon icon="solar:route-linear" className="w-3.5 h-3.5" />
                  {fareEstimate.distance}
                </span>
                <span className="flex items-center gap-1">
                  <Icon icon="solar:clock-circle-linear" className="w-3.5 h-3.5" />
                  {fareEstimate.duration}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Book Now Button */}
      <button
        onClick={bookRide}
        disabled={booking || !pickupAddress || !dropoffAddress || !customerName || !customerPhone}
        className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base shadow-lg shadow-blue-600/20"
      >
        {booking ? (
          <>
            <Icon icon="solar:loading-bold" className="w-5 h-5 animate-spin" />
            Booking...
          </>
        ) : (
          <>
            <Icon icon="solar:car-bold" className="w-5 h-5" />
            Book Now
          </>
        )}
      </button>

      {/* No tenant warning */}
      {!tenantId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
          <p className="text-amber-700 text-sm">
            Missing service configuration. Please use a valid booking link.
          </p>
        </div>
      )}
    </div>
  );
}
