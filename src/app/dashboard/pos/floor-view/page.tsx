"use client";

// ============================================================================
// /dashboard/pos/floor-view — staff-facing live floor view
//
// This is what servers/host see during service. Read-only canvas with live
// status colors, click-to-act on tables.
//
// Lives under /dashboard/pos/ (POS role) not /dashboard/admin/ because
// POS_STAFF needs to use it (admin pages typically require POS_MANAGER+).
// ============================================================================

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import LiveFloorView from "@/components/floor-view/LiveFloorView";

interface LocationOption {
  id: string;
  name: string;
}

export default function StaffFloorViewPage() {
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

  if (!tenantId || loadingLocations) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Floor View" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (locations.length === 0 || !locationId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Floor View" />
        <div className="max-w-md mx-auto py-20 text-center text-gray-600">
          <Icon icon="solar:map-point-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm">No location selected.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AdminHeader
        title="Live Floor"
        subtitle="Real-time table status — tap a table to seat guests, assign servers, mark clean"
        actions={
          locations.length > 1 ? (
            <select
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                localStorage.setItem("tap_active_location", e.target.value);
              }}
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

      <LiveFloorView
        key={locationId}
        tenantId={tenantId}
        locationId={locationId}
      />
    </div>
  );
}
