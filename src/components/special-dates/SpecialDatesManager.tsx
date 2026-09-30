"use client";

// ============================================================================
// SpecialDatesManager — admin UI for block-out dates (closures, private events).
//
// Shows upcoming special dates in a list. Click "+ Add" to define a new one:
//   - Date
//   - Label (e.g. "Christmas Day", "Private buyout")
//   - What to block: reservations / walk-ins / online ordering
//   - Optional public message (shown to customers attempting to book)
//   - Optional custom hours override
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { type SpecialDate } from "@/lib/reservations/types";

interface SpecialDatesManagerProps {
  tenantId: string;
  locationId: string;
}

export default function SpecialDatesManager({
  tenantId,
  locationId,
}: SpecialDatesManagerProps) {
  const [dates, setDates] = useState<SpecialDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const loadDates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/special-dates`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDates(data.dates ?? []);
    } catch (err: any) {
      toast.error(`Couldn't load special dates: ${err?.message ?? "unknown"}`);
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId]);

  useEffect(() => {
    loadDates();
  }, [loadDates]);

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Delete "${label}"? Restaurant will return to normal hours/bookings on this date.`)) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/special-dates/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Special date removed");
      await loadDates();
    } catch (err: any) {
      toast.error(`Delete failed: ${err?.message ?? "unknown"}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {dates.length} upcoming special date{dates.length === 1 ? "" : "s"}
        </p>
        <button
          onClick={() => setCreateOpen(true)}
          className="px-3 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 inline-flex items-center gap-1.5"
        >
          <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
          Add special date
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Icon icon="solar:refresh-bold" className="w-5 h-5 text-gray-400 animate-spin" />
        </div>
      ) : dates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Icon icon="solar:calendar-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No special dates configured</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
            Add closures, holiday hours, or private buyouts to control bookings on
            specific dates.
          </p>
        </div>
      ) : (
        <ul className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {dates.map((d) => (
            <SpecialDateRow
              key={d.id}
              date={d}
              onDelete={() => handleDelete(d.id, d.label)}
            />
          ))}
        </ul>
      )}

      {createOpen && (
        <CreateSpecialDateDialog
          tenantId={tenantId}
          locationId={locationId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            loadDates();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Row
// ============================================================================

function SpecialDateRow({
  date,
  onDelete,
}: {
  date: SpecialDate;
  onDelete: () => void;
}) {
  const d = new Date(date.date);

  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <div className="flex-shrink-0 w-14 text-center bg-indigo-50 border border-indigo-100 rounded-md py-1">
        <div className="text-[10px] uppercase tracking-wider text-indigo-700">
          {d.toLocaleDateString("en-CA", { month: "short" })}
        </div>
        <div className="text-lg font-bold text-indigo-900 leading-none">
          {d.getDate()}
        </div>
        <div className="text-[10px] text-indigo-600">
          {d.toLocaleDateString("en-CA", { weekday: "short" })}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900">{date.label}</p>
        <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {date.blockReservations && (
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800">
              🚫 Reservations blocked
            </span>
          )}
          {date.blockWalkins && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              🚫 Walk-ins blocked
            </span>
          )}
          {date.blockOnline && (
            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
              🚫 Online ordering blocked
            </span>
          )}
          {date.customOpenTime && (
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
              Hours: {date.customOpenTime} – {date.customCloseTime ?? "?"}
            </span>
          )}
        </div>
        {date.publicMessage && (
          <p className="text-xs italic text-gray-600 mt-1">
            Public message: &quot;{date.publicMessage}&quot;
          </p>
        )}
      </div>

      <button
        onClick={onDelete}
        className="flex-shrink-0 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
        title="Delete"
      >
        <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
      </button>
    </li>
  );
}

// ============================================================================
// Create dialog
// ============================================================================

function CreateSpecialDateDialog({
  tenantId,
  locationId,
  onClose,
  onCreated,
}: {
  tenantId: string;
  locationId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [label, setLabel] = useState("");
  const [blockReservations, setBlockReservations] = useState(true);
  const [blockWalkins, setBlockWalkins] = useState(false);
  const [blockOnline, setBlockOnline] = useState(false);
  const [customOpenTime, setCustomOpenTime] = useState("");
  const [customCloseTime, setCustomCloseTime] = useState("");
  const [publicMessage, setPublicMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!label.trim()) {
      toast.error("Label required");
      return;
    }
    if (!blockReservations && !blockWalkins && !blockOnline && !customOpenTime) {
      toast.error("Either block something OR set custom hours — otherwise this date does nothing");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/special-dates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            label: label.trim(),
            blockReservations,
            blockWalkins,
            blockOnline,
            ...(customOpenTime && { customOpenTime }),
            ...(customCloseTime && { customCloseTime }),
            ...(publicMessage && { publicMessage: publicMessage.trim() }),
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success("Special date saved");
      onCreated();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Add special date</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Label">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Christmas Day"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </Field>
          </div>

          <Field label="What's blocked?">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={blockReservations}
                  onChange={(e) => setBlockReservations(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600"
                />
                Block new reservations on this date
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={blockWalkins}
                  onChange={(e) => setBlockWalkins(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600"
                />
                Block walk-in waitlist
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={blockOnline}
                  onChange={(e) => setBlockOnline(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600"
                />
                Block online ordering
              </label>
            </div>
          </Field>

          <details className="border border-gray-200 rounded-md">
            <summary className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-600 cursor-pointer">
              Custom hours (optional)
            </summary>
            <div className="p-3 grid grid-cols-2 gap-3 border-t border-gray-200">
              <Field label="Open">
                <input
                  type="time"
                  value={customOpenTime}
                  onChange={(e) => setCustomOpenTime(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
              </Field>
              <Field label="Close">
                <input
                  type="time"
                  value={customCloseTime}
                  onChange={(e) => setCustomCloseTime(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
              </Field>
            </div>
          </details>

          <Field label="Public message (optional — shown to customers attempting to book)">
            <textarea
              value={publicMessage}
              onChange={(e) => setPublicMessage(e.target.value)}
              placeholder="e.g. Closed for Christmas — see you on the 26th!"
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm resize-none"
            />
          </Field>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="px-4 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save special date"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
