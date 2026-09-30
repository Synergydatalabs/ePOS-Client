"use client";

// ============================================================================
// /dashboard/admin/restaurant-media
//
// Hosts the RestaurantMediaGallery. Same tenant/location resolution pattern
// as floor plan page.
// ============================================================================

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import RestaurantMediaGallery from "@/components/restaurant-media/RestaurantMediaGallery";

interface LocationOption {
  id: string;
  name: string;
}

export default function RestaurantMediaPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);

  useEffect(() => {
    setTenantId(localStorage.getItem("tap_active_tenant"));
    setLocationId(localStorage.getItem("tap_active_location"));
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/tenants/${tenantId}/locations`)
      .then((r) => r.json())
      .then((data) => {
        const list: LocationOption[] = data.locations ?? [];
        setLocations(list);
        if (!locationId && list[0]) {
          setLocationId(list[0].id);
          localStorage.setItem("tap_active_location", list[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingLocations(false));
  }, [tenantId, locationId]);

  const handleLocationChange = (id: string) => {
    setLocationId(id);
    localStorage.setItem("tap_active_location", id);
  };

  if (!tenantId || loadingLocations) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Restaurant Media" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Restaurant Media" />
        <div className="max-w-md mx-auto py-20 text-center text-gray-600">
          <Icon icon="solar:map-point-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm">Add a location in Settings first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Restaurant Media"
        subtitle="Photos, videos, and 360° panoramas — shown on the customer booking page"
        actions={
          locations.length > 1 ? (
            <select
              value={locationId ?? ""}
              onChange={(e) => handleLocationChange(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          ) : null
        }
      />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {locationId && (
          <RestaurantMediaGallery
            key={locationId}
            tenantId={tenantId}
            locationId={locationId}
          />
        )}
      </div>
    </div>
  );
}
