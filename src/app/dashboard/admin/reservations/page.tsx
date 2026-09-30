"use client";

// ============================================================================
// /dashboard/admin/reservations
//
// Reservations admin — list view + calendar view toggle.
//   - Date range picker (today / tomorrow / this week / custom)
//   - Status filter chips
//   - "+ New reservation" button → 3-tap dialog
//   - Click row/chip → detail dialog
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import CreateReservationDialog from "@/components/reservations/CreateReservationDialog";
import ReservationDetailDialog from "@/components/reservations/ReservationDetailDialog";
import ReservationList from "@/components/reservations/ReservationList";
import ReservationCalendar from "@/components/reservations/ReservationCalendar";
import { type Reservation, type ReservationStatus } from "@/lib/reservations/types";

type ViewMode = "list" | "calendar";

interface LocationOption {
  id: string;
  name: string;
}

export default function ReservationsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);

  // Data
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  // View state
  const [view, setView] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<ReservationStatus[]>([
    "CONFIRMED",
    "ARRIVED",
    "SEATED",
  ]);
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    // Start of THIS week (Sunday)
    const diff = d.getDay();
    d.setDate(d.getDate() - diff);
    return d;
  });

  // Free-text search across name / phone / email — host station uses it
  // to pull up "the Ahmed who called about 7pm" without knowing the date.
  const [searchQuery, setSearchQuery] = useState("");

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<{
    date?: Date;
    time?: string;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Tenant + location
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

  // Data load
  const dateRange = useMemo(() => {
    if (view === "calendar") {
      const to = new Date(weekStart);
      to.setDate(to.getDate() + 7);
      return { from: weekStart, to };
    }
    // List view: today + next 30 days by default
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 30);
    return { from, to };
  }, [view, weekStart]);

  const loadReservations = useCallback(async () => {
    if (!tenantId || !locationId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
        ...(statusFilter.length > 0 && { status: statusFilter.join(",") }),
        limit: "500",
      });
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/reservations?${params.toString()}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReservations(data.reservations ?? []);
    } catch (err: any) {
      toast.error(`Couldn't load reservations: ${err?.message ?? "unknown"}`);
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId, dateRange.from, dateRange.to, statusFilter]);

  useEffect(() => {
    loadReservations();
  }, [loadReservations]);

  if (!tenantId || loadingLocations) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Reservations" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (locations.length === 0 || !locationId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Reservations" />
        <div className="max-w-md mx-auto py-20 text-center text-gray-600">
          <Icon icon="solar:calendar-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm">No location selected.</p>
        </div>
      </div>
    );
  }

  // Local search across whatever the current date + status query returned.
  // Matches partial name / email / any position within the phone digits.
  const filteredReservations = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return reservations;
    const qDigits = q.replace(/\D/g, "");
    return reservations.filter((r) => {
      const name = (r.customerName || "").toLowerCase();
      const email = (r.customerEmail || "").toLowerCase();
      const phoneDigits = (r.customerPhone || "").replace(/\D/g, "");
      return (
        name.includes(q) ||
        email.includes(q) ||
        (qDigits.length > 0 && phoneDigits.includes(qDigits))
      );
    });
  })();

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Reservations"
        subtitle="Bookings, waitlist, and guest planning"
        actions={
          <button
            onClick={() => {
              setCreateDefaults(null);
              setCreateOpen(true);
            }}
            className="px-3 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 inline-flex items-center gap-1.5"
          >
            <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
            New reservation
          </button>
        }
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Controls bar */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* View toggle */}
          <div className="inline-flex rounded-md border border-gray-300 bg-white">
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-sm rounded-l-md ${
                view === "list" ? "bg-indigo-600 text-white" : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Icon icon="solar:list-bold" className="w-4 h-4 inline mr-1" />
              List
            </button>
            <button
              onClick={() => setView("calendar")}
              className={`px-3 py-1.5 text-sm rounded-r-md ${
                view === "calendar"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Icon icon="solar:calendar-bold" className="w-4 h-4 inline mr-1" />
              Calendar
            </button>
          </div>

          {/* Calendar week nav (only in calendar mode) */}
          {view === "calendar" && (
            <div className="inline-flex items-center gap-2 bg-white border border-gray-300 rounded-md px-2 py-1">
              <button
                onClick={() => {
                  const d = new Date(weekStart);
                  d.setDate(d.getDate() - 7);
                  setWeekStart(d);
                }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <Icon icon="solar:alt-arrow-left-bold" className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium px-2">
                {weekStart.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}{" "}
                –{" "}
                {new Date(
                  weekStart.getTime() + 6 * 86400000
                ).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
              </span>
              <button
                onClick={() => {
                  const d = new Date(weekStart);
                  d.setDate(d.getDate() + 7);
                  setWeekStart(d);
                }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <Icon icon="solar:alt-arrow-right-bold" className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  d.setDate(d.getDate() - d.getDay());
                  setWeekStart(d);
                }}
                className="ml-1 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-50 rounded"
              >
                This week
              </button>
            </div>
          )}

          {/* Search — name / phone / email. Client-side filter across
              whatever the current date + status query returned. */}
          <div className="relative">
            <Icon
              icon="solar:magnifer-linear"
              className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              type="search"
              placeholder="Search name, phone, email"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-1.5 rounded-md border border-gray-300 text-sm bg-white w-56 focus:outline-none focus:border-indigo-400"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-500 mr-1">Status:</span>
            {(
              [
                "CONFIRMED",
                "ARRIVED",
                "SEATED",
                "COMPLETED",
                "NO_SHOW",
                "CANCELLED",
              ] as ReservationStatus[]
            ).map((s) => {
              const active = statusFilter.includes(s);
              return (
                <button
                  key={s}
                  onClick={() =>
                    setStatusFilter((prev) =>
                      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                    )
                  }
                  className={`px-2 py-0.5 rounded-full border ${
                    active
                      ? "bg-indigo-600 border-indigo-600 text-white"
                      : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {s.replace("_", " ").toLowerCase()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : view === "list" ? (
          <ReservationList
            reservations={filteredReservations}
            onSelect={(r) => setSelectedId(r.id)}
          />
        ) : (
          <ReservationCalendar
            reservations={filteredReservations}
            weekStart={weekStart}
            onSelect={(r) => setSelectedId(r.id)}
            onEmptyCellClick={(date, time) => {
              setCreateDefaults({ date, time });
              setCreateOpen(true);
            }}
          />
        )}
      </div>

      {/* Dialogs */}
      <CreateReservationDialog
        open={createOpen}
        tenantId={tenantId}
        locationId={locationId}
        defaultDate={createDefaults?.date}
        defaultTime={createDefaults?.time}
        onClose={() => {
          setCreateOpen(false);
          setCreateDefaults(null);
        }}
        onCreated={() => {
          loadReservations();
        }}
      />

      <ReservationDetailDialog
        open={selectedId !== null}
        tenantId={tenantId}
        locationId={locationId}
        reservationId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={() => {
          loadReservations();
        }}
      />
    </div>
  );
}
