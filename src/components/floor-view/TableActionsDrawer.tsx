"use client";

// ============================================================================
// TableActionsDrawer — right-side panel showing actions for the selected table.
//
// Shows status-dependent actions:
//   - AVAILABLE → "Seat guests" (party size + server picker) | "Mark as reserved"
//   - OCCUPIED  → guest info + "Open order" | "Mark as cleaning"
//   - CLEANING  → "Mark as available"
//   - RESERVED  → "Seat now" | "Cancel reservation"
//   - BLOCKED   → "Unblock"
//
// Also shows: server assignment dropdown (always available — change anytime),
// reservation chit if any upcoming reservation matches this table.
// ============================================================================

import { useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import {
  type LiveTable,
  type LiveReservation,
  type ServerSummary,
  type LiveTableStatus,
  STATUS_COLORS,
} from "@/lib/floor-view/types";

interface TableActionsDrawerProps {
  tenantId: string;
  locationId: string;
  table: LiveTable | null;
  reservations: LiveReservation[]; // filtered to this table
  servers: ServerSummary[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export default function TableActionsDrawer({
  tenantId,
  locationId,
  table,
  reservations,
  servers,
  onClose,
  onRefresh,
}: TableActionsDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [partySize, setPartySize] = useState<number>(2);

  if (!table) {
    return (
      <div className="w-80 bg-white border-l border-gray-200 p-6 flex flex-col items-center justify-center text-center">
        <Icon icon="solar:hand-pointing-bold" className="w-12 h-12 text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">
          Tap a table on the floor to see actions
        </p>
      </div>
    );
  }

  const updateStatus = async (
    status: LiveTableStatus,
    extra: { guestCount?: number } = {}
  ) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-view/tables/${table.id}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, ...extra }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`Table ${table.tableNumber} → ${STATUS_COLORS[status].label}`);
      await onRefresh();
    } catch (err: any) {
      toast.error(`Update failed: ${err?.message ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  const assignServer = async (serverId: string | null) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-view/tables/${table.id}/assign-server`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(serverId ? "Server assigned" : "Server cleared");
      await onRefresh();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  const minsSeated = table.seatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(table.seatedAt).getTime()) / 60000))
    : 0;

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            Table {table.displayLabel || table.tableNumber}
            <StatusBadge status={table.status} />
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Capacity {table.capacity}
            {table.guestCount ? ` • ${table.guestCount} seated` : ""}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
        >
          <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* OCCUPIED — current session info */}
        {table.status === "OCCUPIED" && table.activeSession && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
            <div className="font-medium text-emerald-900 mb-2">Current session</div>
            <div className="grid grid-cols-2 gap-2 text-xs text-emerald-800">
              <Stat label="Guests">{table.activeSession.guestCount}</Stat>
              <Stat label="Time">{minsSeated}m</Stat>
              <Stat label="Spent">${(table.activeSession.totalSpentCents / 100).toFixed(2)}</Stat>
              <Stat label="Status">{table.activeSession.status}</Stat>
            </div>
          </div>
        )}

        {/* Reservations matching this table */}
        {reservations.length > 0 && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm">
            <div className="font-medium text-purple-900 mb-2 flex items-center gap-2">
              <Icon icon="solar:calendar-bold" className="w-4 h-4" />
              Upcoming reservation
            </div>
            {reservations.map((r) => (
              <div key={r.id} className="text-xs text-purple-800 mb-1.5">
                <div className="font-medium">{r.customerName}</div>
                <div>
                  Party of {r.partySize} at {formatTime(r.bookedFor)}
                </div>
                {r.specialOccasion && (
                  <div className="mt-1 text-purple-700">🎉 {r.specialOccasion}</div>
                )}
                {r.notes && <div className="mt-1 italic text-purple-700">"{r.notes}"</div>}
              </div>
            ))}
          </div>
        )}

        {/* Server assignment */}
        <Field label="Assigned server">
          <select
            value={table.currentServer?.id ?? ""}
            onChange={(e) => assignServer(e.target.value || null)}
            disabled={busy}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">— Not assigned —</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {[s.firstName, s.lastName].filter(Boolean).join(" ") || s.id}
              </option>
            ))}
          </select>
          {table.currentServer?.color && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: table.currentServer.color }}
              />
              Color shows on table tile
            </div>
          )}
        </Field>

        {/* Status-specific actions */}
        {table.status === "AVAILABLE" && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <Field label="Party size">
              <input
                type="number"
                min={1}
                max={table.capacity * 2}
                value={partySize}
                onChange={(e) => setPartySize(parseInt(e.target.value) || 1)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                disabled={busy}
              />
              {partySize > table.capacity && (
                <p className="text-xs text-amber-700 mt-1">
                  ⚠ Over capacity ({table.capacity} seats)
                </p>
              )}
            </Field>
            <button
              onClick={() => updateStatus("OCCUPIED", { guestCount: partySize })}
              disabled={busy}
              className="w-full py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              ✓ Seat guests
            </button>
            <button
              onClick={() => updateStatus("RESERVED")}
              disabled={busy}
              className="w-full py-2 rounded-md bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 disabled:opacity-50"
            >
              Hold for reservation
            </button>
            <button
              onClick={() => updateStatus("BLOCKED")}
              disabled={busy}
              className="w-full py-1.5 rounded-md text-gray-600 text-xs hover:bg-gray-100 disabled:opacity-50"
            >
              Block table
            </button>
          </div>
        )}

        {table.status === "OCCUPIED" && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <button
              onClick={() => {
                toast.info("Order entry coming in Phase 5");
              }}
              disabled={busy}
              className="w-full py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              📝 Open order
            </button>
            <button
              onClick={() => updateStatus("CLEANING")}
              disabled={busy}
              className="w-full py-2 rounded-md bg-amber-50 text-amber-800 text-sm font-medium hover:bg-amber-100 disabled:opacity-50"
            >
              🧹 Guests left → Cleaning
            </button>
          </div>
        )}

        {table.status === "CLEANING" && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <button
              onClick={() => updateStatus("AVAILABLE")}
              disabled={busy}
              className="w-full py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              ✓ Cleaned → Available
            </button>
          </div>
        )}

        {table.status === "RESERVED" && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <Field label="Party size">
              <input
                type="number"
                min={1}
                max={table.capacity * 2}
                value={partySize}
                onChange={(e) => setPartySize(parseInt(e.target.value) || 1)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                disabled={busy}
              />
            </Field>
            <button
              onClick={() => updateStatus("OCCUPIED", { guestCount: partySize })}
              disabled={busy}
              className="w-full py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              ✓ Seat reservation
            </button>
            <button
              onClick={() => updateStatus("AVAILABLE")}
              disabled={busy}
              className="w-full py-1.5 rounded-md text-gray-600 text-xs hover:bg-gray-100 disabled:opacity-50"
            >
              Release reservation
            </button>
          </div>
        )}

        {table.status === "BLOCKED" && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <button
              onClick={() => updateStatus("AVAILABLE")}
              disabled={busy}
              className="w-full py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              Unblock
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-sm font-bold">{children}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: LiveTableStatus }) {
  const info = STATUS_COLORS[status];
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
      style={{ backgroundColor: info.bg, color: "#1F2937", border: `1px solid ${info.ring}` }}
    >
      {info.label}
    </span>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-CA", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
