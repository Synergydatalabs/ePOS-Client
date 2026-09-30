"use client";

// ============================================================================
// /dashboard/admin/floor-plan
//
// Hosts the FloorPlanEditor. Resolves tenant + location from localStorage
// (consistent with existing admin pages in this app).
//
// The editor itself takes full viewport height below the header — feels like
// a dedicated tool, not a "page within a page".
// ============================================================================

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import FloorPlanEditor from "@/components/floor-plan/FloorPlanEditor";

interface LocationOption {
  id: string;
  name: string;
}

export default function FloorPlanPage() {
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
        <AdminHeader title="Floor Plan" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Floor Plan" />
        <div className="max-w-md mx-auto py-20 text-center text-gray-600">
          <Icon icon="solar:map-point-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm">
            You need at least one location before creating a floor plan. Add a location in Settings first.
          </p>
        </div>
      </div>
    );
  }

  return (
    // w-full is explicit (some parent flex containers don't grow children by default)
    <div className="min-h-screen bg-gray-50 flex flex-col w-full">
      <AdminHeader
        title="Floor Plan"
        subtitle="Arrange tables, sections, and seating for your dining room"
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

      {locationId && (
        <FloorPlanEditor
          key={locationId}
          tenantId={tenantId}
          locationId={locationId}
        />
      )}
    </div>
  );
}
