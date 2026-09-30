"use client";

// ============================================================================
// WaitlistQueue — main staff UI for the walk-in waitlist.
//
// Shows queue with quick actions:
//   - Notify guest (sends SMS "table almost ready")
//   - Mark confirmed (after guest replies 1)
//   - Seat at table (opens table picker, transitions to SEATED + marks table OCCUPIED)
//   - Remove (cancel entry)
//
// Polls every 10 seconds so multiple hosts see in-sync queue.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface WaitlistEntry {
  id: string;
  customerName: string;
  customerPhone: string;
  partySize: number;
  preferredArea: string | null;
  quotedWaitMinutes: number;
  estimatedSeatingAt: string | null;
  smsSentAt: string | null;
  status: "WAITING" | "NOTIFIED" | "CONFIRMED" | "SEATED" | "NO_SHOW" | "CANCELLED";
  notes: string | null;
  createdAt: string;
  preferredSection?: { id: string; name: string; color: string } | null;
  guestProfile?: {
    id: string;
    firstName: string;
    lastName?: string | null;
    visitCount?: number;
    vipTier?: number;
  } | null;
  seatedAtTable?: { id: string; tableNumber: string } | null;
}

interface TableOption {
  id: string;
  tableNumber: string;
  capacity: number;
  status: string;
}

interface WaitlistQueueProps {
  tenantId: string;
  locationId: string;
  /** Trigger callback when user clicks "Add walk-in" */
  onAddClick: () => void;
}

const POLL_MS = 10000;

const STATUS_META: Record<
  WaitlistEntry["status"],
  { label: string; bg: string; text: string; emoji: string }
> = {
  WAITING: { label: "Waiting", bg: "bg-amber-100", text: "text-amber-800", emoji: "⏳" },
  NOTIFIED: { label: "Notified", bg: "bg-blue-100", text: "text-blue-800", emoji: "📱" },
  CONFIRMED: { label: "Confirmed", bg: "bg-emerald-100", text: "text-emerald-800", emoji: "✅" },
  SEATED: { label: "Seated", bg: "bg-gray-100", text: "text-gray-700", emoji: "🪑" },
  NO_SHOW: { label: "No-show", bg: "bg-red-100", text: "text-red-800", emoji: "🚫" },
  CANCELLED: { label: "Cancelled", bg: "bg-gray-100", text: "text-gray-500", emoji: "❌" },
};

export default function WaitlistQueue({
  tenantId,
  locationId,
  onAddClick,
}: WaitlistQueueProps) {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const [tables, setTables] = useState<TableOption[]>([]);
  const [seatingEntry, setSeatingEntry] = useState<WaitlistEntry | null>(null);

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/waitlist?showCompleted=${showCompleted}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch (err: any) {
      // silent on polling
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId, showCompleted]);

  useEffect(() => {
    loadEntries();
    const interval = setInterval(loadEntries, POLL_MS);
    return () => clearInterval(interval);
  }, [loadEntries]);

  // Load available tables (for seating)
  useEffect(() => {
    fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables`)
      .then((r) => r.json())
      .then((data) => setTables(data.tables ?? []))
      .catch(() => {});
  }, [tenantId, locationId]);

  const notify = async (entry: WaitlistEntry) => {
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/waitlist/${entry.id}/notify`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.sms?.ok) {
        toast.success(
          data.sms.provider === "dev"
            ? `Dev mode: SMS logged to server console`
            : `SMS sent to ${entry.customerName}`
        );
      } else {
        toast.warning("Marked notified but SMS failed: " + (data.sms?.error || "unknown"));
      }
      await loadEntries();
    } catch (err: any) {
      toast.error(`Notify failed: ${err?.message ?? "unknown"}`);
    }
  };

  const setStatus = async (
    entry: WaitlistEntry,
    status: WaitlistEntry["status"],
    extra: { seatedAtTableId?: string } = {}
  ) => {
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/waitlist/${entry.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, ...extra }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`${entry.customerName} → ${STATUS_META[status].label}`);
      await loadEntries();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    }
  };

  const handleSeat = async (entry: WaitlistEntry, tableId: string) => {
    await setStatus(entry, "SEATED", { seatedAtTableId: tableId });
    setSeatingEntry(null);
  };

  const removeEntry = async (entry: WaitlistEntry) => {
    if (!confirm(`Remove ${entry.customerName} from waitlist?`)) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/waitlist/${entry.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Removed ${entry.customerName}`);
      await loadEntries();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Icon icon="solar:refresh-bold" className="w-5 h-5 text-gray-400 animate-spin" />
      </div>
    );
  }

  const activeCount = entries.filter((e) =>
    ["WAITING", "NOTIFIED", "CONFIRMED"].includes(e.status)
  ).length;

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-700">
          <strong className="text-lg text-gray-900">{activeCount}</strong>
          <span className="ml-1">in queue</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600"
            />
            Show completed today
          </label>
          <button
            onClick={onAddClick}
            className="px-3 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 inline-flex items-center gap-1.5"
          >
            <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
            Add walk-in
          </button>
        </div>
      </div>

      {/* Queue list */}
      {entries.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <Icon icon="solar:clock-circle-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No one is waiting</p>
          <p className="text-xs text-gray-400 mt-1">
            Walk-ins added here will get an SMS when their table is ready.
          </p>
        </div>
      ) : (
        <ul className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {entries.map((e, idx) => (
            <WaitlistRow
              key={e.id}
              entry={e}
              position={idx + 1}
              onNotify={() => notify(e)}
              onConfirm={() => setStatus(e, "CONFIRMED")}
              onSeat={() => setSeatingEntry(e)}
              onRemove={() => removeEntry(e)}
              onNoShow={() => setStatus(e, "NO_SHOW")}
            />
          ))}
        </ul>
      )}

      {/* Seat dialog */}
      {seatingEntry && (
        <SeatDialog
          entry={seatingEntry}
          tables={tables}
          onClose={() => setSeatingEntry(null)}
          onConfirm={(tableId) => handleSeat(seatingEntry, tableId)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function WaitlistRow({
  entry,
  position,
  onNotify,
  onConfirm,
  onSeat,
  onRemove,
  onNoShow,
}: {
  entry: WaitlistEntry;
  position: number;
  onNotify: () => void;
  onConfirm: () => void;
  onSeat: () => void;
  onRemove: () => void;
  onNoShow: () => void;
}) {
  const meta = STATUS_META[entry.status];
  const minsWaited = Math.floor(
    (Date.now() - new Date(entry.createdAt).getTime()) / 60_000
  );
  const overdue = minsWaited > entry.quotedWaitMinutes + 10;

  return (
    <li className="px-4 py-3 flex items-center gap-3">
      {/* Position */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-bold text-sm flex items-center justify-center">
        {position}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900">{entry.customerName}</span>
          {(entry.guestProfile?.vipTier ?? 0) > 0 && (
            <span className="text-xs text-amber-600">★ VIP</span>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded ${meta.bg} ${meta.text}`}>
            {meta.emoji} {meta.label}
          </span>
          {entry.preferredSection && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: entry.preferredSection.color + "33",
                color: entry.preferredSection.color,
              }}
            >
              {entry.preferredSection.name}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>
            <strong>{entry.partySize}</strong> guests
          </span>
          <span>·</span>
          <span>{entry.customerPhone}</span>
          <span>·</span>
          <span>Quoted {entry.quotedWaitMinutes}m</span>
          <span>·</span>
          <span className={overdue ? "text-red-600 font-medium" : ""}>
            Waiting {minsWaited}m
          </span>
        </div>
        {entry.notes && (
          <p className="text-xs italic text-gray-500 mt-1 truncate">&quot;{entry.notes}&quot;</p>
        )}
        {entry.seatedAtTable && (
          <p className="text-xs text-emerald-700 mt-1">
            Seated at Table {entry.seatedAtTable.tableNumber}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex items-center gap-1">
        {entry.status === "WAITING" && (
          <button
            onClick={onNotify}
            className="px-2.5 py-1.5 text-xs font-medium rounded bg-blue-100 text-blue-800 hover:bg-blue-200"
            title="Send SMS — table almost ready"
          >
            <Icon icon="solar:smartphone-bold" className="w-3.5 h-3.5 inline mr-0.5" />
            Notify
          </button>
        )}
        {entry.status === "NOTIFIED" && (
          <button
            onClick={onConfirm}
            className="px-2.5 py-1.5 text-xs font-medium rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
            title="Guest replied 1 — they're coming"
          >
            ✓ Confirm
          </button>
        )}
        {(entry.status === "WAITING" ||
          entry.status === "NOTIFIED" ||
          entry.status === "CONFIRMED") && (
          <>
            <button
              onClick={onSeat}
              className="px-2.5 py-1.5 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Seat
            </button>
            <button
              onClick={onNoShow}
              className="px-2 py-1.5 text-xs text-gray-500 hover:text-red-700 hover:bg-red-50 rounded"
              title="Mark no-show"
            >
              No-show
            </button>
            <button
              onClick={onRemove}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="Remove from queue"
            >
              <Icon icon="solar:trash-bin-trash-bold" className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function SeatDialog({
  entry,
  tables,
  onClose,
  onConfirm,
}: {
  entry: WaitlistEntry;
  tables: TableOption[];
  onClose: () => void;
  onConfirm: (tableId: string) => void;
}) {
  const [selectedTableId, setSelectedTableId] = useState<string>("");

  // Filter to tables that fit + are currently available
  const candidates = tables
    .filter(
      (t) =>
        t.capacity >= entry.partySize &&
        (t.status === "AVAILABLE" || t.status === "CLEANING")
    )
    .sort((a, b) => a.capacity - b.capacity);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            Seat {entry.customerName} ({entry.partySize} guests)
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          <label className="block text-xs font-medium text-gray-600 mb-2">
            Pick a table (fits {entry.partySize}+)
          </label>
          {candidates.length === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
              No available tables fit a party of {entry.partySize}. Wait for one to clear,
              or seat manually via the floor view.
            </p>
          ) : (
            <select
              value={selectedTableId}
              onChange={(e) => setSelectedTableId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">— Choose —</option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  Table {t.tableNumber} (fits {t.capacity}
                  {t.status === "CLEANING" ? " · CLEANING" : ""})
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedTableId && onConfirm(selectedTableId)}
            disabled={!selectedTableId}
            className="px-3 py-1.5 text-sm font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            Seat at table
          </button>
        </div>
      </div>
    </div>
  );
}
