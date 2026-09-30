"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export interface Location {
  id: string;
  name: string;
  address?: string | null;
  status?: string;
  isDefault?: boolean;
}

interface LocationContextValue {
  locations: Location[];
  activeLocation: Location | null;
  activeLocationId: string | null;
  setActiveLocation: (location: Location) => void;
  canSwitch: boolean; // admin can switch; staff locked if assigned to single location
  refresh: () => Promise<void>;
  loading: boolean;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({
  tenantId,
  userRole,
  assignedLocationIds,
  children,
}: {
  tenantId: string | null;
  userRole?: string | null;
  assignedLocationIds?: string[]; // from membership; empty = all access
  children: ReactNode;
}) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocation, setActiveLocationState] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = userRole === "OWNER" || userRole === "ADMIN" || userRole === "POS_MANAGER";
  const hasMultipleAssigned = (assignedLocationIds?.length || 0) > 1;
  const canSwitch = isAdmin || hasMultipleAssigned || !assignedLocationIds?.length;

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations`);
      const data = await res.json();
      if (data.success) {
        // Filter to assigned locations for non-admins
        let filtered: Location[] = data.locations;
        if (!isAdmin && assignedLocationIds?.length) {
          filtered = filtered.filter((l) => assignedLocationIds.includes(l.id));
        }
        setLocations(filtered);

        // Restore from localStorage or pick default
        const stored = localStorage.getItem("tap_active_location");
        const storedLoc = filtered.find((l) => l.id === stored);
        const defaultLoc = filtered.find((l) => l.isDefault) || filtered[0];
        const picked = storedLoc || defaultLoc || null;
        if (picked) {
          setActiveLocationState(picked);
          localStorage.setItem("tap_active_location", picked.id);
        }
      }
    } catch (err) {
      console.error("Failed to load locations:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, isAdmin, assignedLocationIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveLocation = (location: Location) => {
    if (!canSwitch && activeLocation && location.id !== activeLocation.id) {
      // Staff can't switch
      return;
    }
    setActiveLocationState(location);
    localStorage.setItem("tap_active_location", location.id);
    // Trigger a soft reload of pages that read location
    window.dispatchEvent(new Event("tap_location_changed"));
  };

  return (
    <LocationContext.Provider
      value={{
        locations,
        activeLocation,
        activeLocationId: activeLocation?.id || null,
        setActiveLocation,
        canSwitch,
        refresh,
        loading,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

// Safe default returned when no LocationProvider is above this call —
// specifically during Next's static prerender pass, where the layout's
// client-only providers haven't mounted yet. Returning null-shaped
// values lets the component render an empty shell; the real provider
// hydrates on the client and the first re-render populates everything.
// The safety net is only a shield for prerender / edge misuse — in a
// real request path the provider is always above these consumers.
const EMPTY_CONTEXT: LocationContextValue = {
  locations: [],
  activeLocation: null,
  activeLocationId: null,
  setActiveLocation: () => {},
  canSwitch: false,
  refresh: async () => {},
  loading: true,
};

export function useLocation() {
  const ctx = useContext(LocationContext);
  return ctx ?? EMPTY_CONTEXT;
}
