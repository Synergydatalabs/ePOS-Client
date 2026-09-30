"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { useDriverSession } from "../layout";

interface DriverProfile {
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  vehicle?: {
    plate: string;
    make: string;
    model: string;
    color: string;
  };
  license?: {
    number: string;
    expiry: string;
  };
  stats?: {
    totalTrips: number;
    rating: number;
    acceptanceRate: number;
  };
}

export default function DriverProfilePage() {
  const router = useRouter();
  const { session } = useDriverSession();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const tenantId = session?.tenant.id;
  const driverId = session?.user.id;

  const loadProfile = useCallback(async () => {
    if (!tenantId || !driverId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/drivers/${driverId}`);
      if (res.ok) {
        const data = await res.json();
        setProfile({
          firstName: data.firstName || session?.user.firstName,
          lastName: data.lastName || session?.user.lastName,
          email: data.email || session?.user.email || "",
          phone: data.phone,
          vehicle: data.vehicle,
          license: data.license,
          stats: data.stats,
        });
      } else {
        // Fallback to session data
        setProfile({
          firstName: session?.user.firstName,
          lastName: session?.user.lastName,
          email: session?.user.email || "",
        });
      }
    } catch (error) {
      console.error("Failed to load profile:", error);
      setProfile({
        firstName: session?.user.firstName,
        lastName: session?.user.lastName,
        email: session?.user.email || "",
      });
    } finally {
      setLoading(false);
    }
  }, [tenantId, driverId, session]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/drive/auth/logout", { method: "POST" });
      localStorage.removeItem("driver_online");
      router.replace("/drive/driver/login");
    } catch (error) {
      console.error("Logout failed:", error);
      toast.error("Logout failed. Please try again.");
      setLoggingOut(false);
    }
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Icon
        key={i}
        icon={i < Math.round(rating) ? "solar:star-bold" : "solar:star-linear"}
        className={`w-4 h-4 ${i < Math.round(rating) ? "text-amber-400" : "text-gray-600"}`}
      />
    ));
  };

  const fullName = profile
    ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || profile.email.split("@")[0]
    : "Driver";

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex flex-col items-center py-6">
          <div className="w-20 h-20 rounded-full bg-gray-800 animate-pulse mb-3" />
          <div className="h-5 bg-gray-800 rounded w-32 animate-pulse mb-1" />
          <div className="h-4 bg-gray-800 rounded w-48 animate-pulse" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-gray-800/50 rounded-xl p-4 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-1/4 mb-3" />
            <div className="h-3 bg-gray-700 rounded w-full mb-2" />
            <div className="h-3 bg-gray-700 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Profile Header */}
      <div className="flex flex-col items-center py-4">
        <div className="w-20 h-20 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center mb-3">
          <Icon icon="solar:user-rounded-bold" className="w-10 h-10 text-gray-500" />
        </div>
        <h2 className="text-xl font-bold text-white">{fullName}</h2>
        <p className="text-gray-500 text-sm">{profile?.email}</p>
        {profile?.stats && (
          <div className="flex items-center gap-1 mt-2">
            {renderStars(profile.stats.rating)}
            <span className="text-gray-400 text-sm ml-1">{profile.stats.rating.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Stats */}
      {profile?.stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-white">{profile.stats.totalTrips}</p>
            <p className="text-xs text-gray-500">Total Trips</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-white">{profile.stats.rating.toFixed(1)}</p>
            <p className="text-xs text-gray-500">Rating</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-white">{profile.stats.acceptanceRate}%</p>
            <p className="text-xs text-gray-500">Accept Rate</p>
          </div>
        </div>
      )}

      {/* Driver Info */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/50">
          <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
            <Icon icon="solar:user-id-bold" className="w-4 h-4" />
            Driver Info
          </h3>
        </div>
        <div className="divide-y divide-gray-700/50">
          <div className="px-4 py-3 flex justify-between">
            <span className="text-gray-500 text-sm">Name</span>
            <span className="text-white text-sm">{fullName}</span>
          </div>
          <div className="px-4 py-3 flex justify-between">
            <span className="text-gray-500 text-sm">Email</span>
            <span className="text-white text-sm">{profile?.email}</span>
          </div>
          {profile?.phone && (
            <div className="px-4 py-3 flex justify-between">
              <span className="text-gray-500 text-sm">Phone</span>
              <a href={`tel:${profile.phone}`} className="text-emerald-400 text-sm">
                {profile.phone}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Vehicle Info */}
      {profile?.vehicle && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50">
            <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
              <Icon icon="solar:car-bold" className="w-4 h-4" />
              Vehicle
            </h3>
          </div>
          <div className="divide-y divide-gray-700/50">
            <div className="px-4 py-3 flex justify-between">
              <span className="text-gray-500 text-sm">Plate</span>
              <span className="text-white text-sm font-mono">{profile.vehicle.plate}</span>
            </div>
            <div className="px-4 py-3 flex justify-between">
              <span className="text-gray-500 text-sm">Make / Model</span>
              <span className="text-white text-sm">{profile.vehicle.make} {profile.vehicle.model}</span>
            </div>
            <div className="px-4 py-3 flex justify-between">
              <span className="text-gray-500 text-sm">Color</span>
              <span className="text-white text-sm">{profile.vehicle.color}</span>
            </div>
          </div>
        </div>
      )}

      {/* License Info */}
      {profile?.license && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50">
            <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
              <Icon icon="solar:document-bold" className="w-4 h-4" />
              License
            </h3>
          </div>
          <div className="divide-y divide-gray-700/50">
            <div className="px-4 py-3 flex justify-between">
              <span className="text-gray-500 text-sm">Number</span>
              <span className="text-white text-sm font-mono">{profile.license.number}</span>
            </div>
            <div className="px-4 py-3 flex justify-between">
              <span className="text-gray-500 text-sm">Expiry</span>
              <span className={`text-sm ${
                new Date(profile.license.expiry) < new Date()
                  ? "text-red-400"
                  : "text-white"
              }`}>
                {new Date(profile.license.expiry).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3 pt-2">
        <button
          onClick={() => toast.info("Change password coming soon")}
          className="w-full py-3 bg-gray-800 text-white rounded-xl font-medium border border-gray-700 flex items-center justify-center gap-2 hover:bg-gray-750 transition-colors"
        >
          <Icon icon="solar:key-bold" className="w-5 h-5 text-gray-400" />
          Change Password
        </button>

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full py-3 bg-red-500/10 text-red-400 rounded-xl font-medium border border-red-500/20 flex items-center justify-center gap-2 hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          {loggingOut ? (
            <Icon icon="solar:loading-bold" className="w-5 h-5 animate-spin" />
          ) : (
            <Icon icon="solar:logout-2-bold" className="w-5 h-5" />
          )}
          {loggingOut ? "Logging out..." : "Log Out"}
        </button>
      </div>

      {/* Footer */}
      <p className="text-center text-gray-600 text-xs pt-2 pb-4">
        Powered by iTAP
      </p>
    </div>
  );
}
