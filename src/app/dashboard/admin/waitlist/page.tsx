"use client";

// ============================================================================
// /dashboard/admin/waitlist
//
// Walk-in queue management page. Used by hosts during service.
// ============================================================================

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import WaitlistQueue from "@/components/waitlist/WaitlistQueue";
import AddWalkinDialog from "@/components/waitlist/AddWalkinDialog";

interface LocationOption {
  id: string;
  name: string;
}

export default function WaitlistPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
        <AdminHeader title="Waitlist" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (locations.length === 0 || !locationId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Waitlist" />
        <div className="max-w-md mx-auto py-20 text-center text-gray-600">
          <Icon icon="solar:clock-circle-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm">No location selected.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Waitlist"
        subtitle="Manage walk-ins — auto-quoted wait times, SMS notifications when tables are ready"
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

      <div className="max-w-5xl mx-auto px-4 py-6">
        <WaitlistQueue
          key={`${locationId}-${reloadKey}`}
          tenantId={tenantId}
          locationId={locationId}
          onAddClick={() => setAddOpen(true)}
        />
      </div>

      <AddWalkinDialog
        open={addOpen}
        tenantId={tenantId}
        locationId={locationId}
        onClose={() => setAddOpen(false)}
        onAdded={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}
