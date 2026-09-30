"use client";

// ============================================================================
// ReservationDetailDialog — view + edit a reservation.
//
// Shows full reservation info + guest profile + actions:
//   - Quick status transitions (Mark arrived, Seat now, Mark completed, etc.)
//   - Edit time, party size, table assignment, notes
//   - Cancel reservation (with reason)
// ============================================================================

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import {
  type Reservation,
  type ReservationStatus,
  STATUS_LABEL,
  STATUS_COLOR,
} from "@/lib/reservations/types";

interface ReservationDetailDialogProps {
  open: boolean;
  tenantId: string;
  locationId: string;
  reservationId: string | null;
  onClose: () => void;
  onUpdated: () => void;
}

interface ReservationTableOption {
  id: string;
  tableNumber: string;
  displayLabel?: string | null;
  capacity: number;
}

export default function ReservationDetailDialog({
  open,
  tenantId,
  locationId,
  reservationId,
  onClose,
  onUpdated,
}: ReservationDetailDialogProps) {
  const [r, setR] = useState<Reservation | null>(null);
  const [tables, setTables] = useState<ReservationTableOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    bookedFor: string;
    partySize: number;
    tableId: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    specialOccasion: string;
    notes: string;
    internalNotes: string;
  } | null>(null);

  useEffect(() => {
    if (!open || !reservationId) return;
    setLoading(true);
    setEditing(false);
    Promise.all([
      fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/reservations/${reservationId}`
      ).then((r) => r.json()),
      fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables`).then((r) =>
        r.json()
      ),
    ])
      .then(([resData, tableData]) => {
        setR(resData.reservation);
        setTables(tableData.tables ?? []);
        if (resData.reservation) {
          const r = resData.reservation;
          // Pre-fill edit form (used if user clicks Edit)
          const d = new Date(r.bookedFor);
          setEditForm({
            bookedFor: d.toISOString().slice(0, 16),
            partySize: r.partySize,
            tableId: r.tableId ?? "",
            customerName: r.customerName,
            customerPhone: r.customerPhone ?? "",
            customerEmail: r.customerEmail ?? "",
            specialOccasion: r.specialOccasion ?? "",
            notes: r.notes ?? "",
            internalNotes: r.internalNotes ?? "",
          });
        }
      })
      .catch((err) =>
        toast.error(`Couldn't load reservation: ${err?.message ?? "unknown"}`)
      )
      .finally(() => setLoading(false));
  }, [open, reservationId, tenantId, locationId]);

  if (!open) return null;

  const changeStatus = async (status: ReservationStatus) => {
    if (!r) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/reservations/${r.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Status → ${STATUS_LABEL[status]}`);
      onUpdated();
      onClose();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!r || !editForm) return;
    setBusy(true);
    try {
      const body: any = {
        customerName: editForm.customerName.trim(),
        customerPhone: editForm.customerPhone || null,
        customerEmail: editForm.customerEmail || null,
        partySize: editForm.partySize,
        bookedFor: new Date(editForm.bookedFor).toISOString(),
        tableId: editForm.tableId || null,
        specialOccasion: editForm.specialOccasion || null,
        notes: editForm.notes || null,
        internalNotes: editForm.internalNotes || null,
      };
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/reservations/${r.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success("Reservation updated");
      setEditing(false);
      onUpdated();
      onClose();
    } catch (err: any) {
      toast.error(`Update failed: ${err?.message ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!r) return;
    const reason = prompt("Cancel reason (optional):", "Cancelled by staff");
    if (reason === null) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/reservations/${r.id}?reason=${encodeURIComponent(reason)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Reservation cancelled");
      onUpdated();
      onClose();
    } catch (err: any) {
      toast.error(`Cancel failed: ${err?.message ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            {editing ? "Edit reservation" : r?.customerName ?? "Reservation"}
            {r && !editing && (
              <span
                className={`ml-2 text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status].bg} ${STATUS_COLOR[r.status].text}`}
              >
                {STATUS_LABEL[r.status]}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
          >
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading || !r ? (
            <div className="flex items-center justify-center py-10">
              <Icon icon="solar:refresh-bold" className="w-5 h-5 text-gray-400 animate-spin" />
            </div>
          ) : editing && editForm ? (
            <div className="space-y-3">
              <Field label="Customer name">
                <input
                  type="text"
                  value={editForm.customerName}
                  onChange={(e) =>
                    setEditForm({ ...editForm, customerName: e.target.value })
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <input
                    type="tel"
                    value={editForm.customerPhone}
                    onChange={(e) =>
                      setEditForm({ ...editForm, customerPhone: e.target.value })
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={editForm.customerEmail}
                    onChange={(e) =>
                      setEditForm({ ...editForm, customerEmail: e.target.value })
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date & time">
                  <input
                    type="datetime-local"
                    value={editForm.bookedFor}
                    onChange={(e) =>
                      setEditForm({ ...editForm, bookedFor: e.target.value })
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Party size">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={editForm.partySize}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        partySize: parseInt(e.target.value) || 1,
                      })
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  />
                </Field>
              </div>
              <Field label="Table">
                <select
                  value={editForm.tableId}
                  onChange={(e) => setEditForm({ ...editForm, tableId: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                >
                  <option value="">— No table assigned —</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      Table {t.tableNumber} (fits {t.capacity})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Special occasion">
                <input
                  type="text"
                  value={editForm.specialOccasion}
                  onChange={(e) =>
                    setEditForm({ ...editForm, specialOccasion: e.target.value })
                  }
                  placeholder="Birthday, anniversary..."
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
              </Field>
              <Field label="Notes (guest-provided)">
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm resize-none"
                />
              </Field>
              <Field label="Internal notes (staff only)">
                <textarea
                  value={editForm.internalNotes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, internalNotes: e.target.value })
                  }
                  rows={2}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm resize-none"
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Quick info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="Time">
                  {new Date(r.bookedFor).toLocaleString("en-CA", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Stat>
                <Stat label="Party size">{r.partySize} guests</Stat>
                <Stat label="Table">
                  {r.table ? (
                    <>
                      {r.table.tableNumber}
                      <span className="text-xs text-gray-500">
                        {" "}
                        (fits {r.table.capacity})
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-600">Not assigned</span>
                  )}
                </Stat>
                <Stat label="Duration">{r.estimatedDurationMinutes} min</Stat>
                <Stat label="Phone">{r.customerPhone || "—"}</Stat>
                <Stat label="Email">{r.customerEmail || "—"}</Stat>
              </div>

              {r.specialOccasion && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 text-sm text-purple-900">
                  🎉 <strong>{r.specialOccasion}</strong>
                </div>
              )}

              {r.notes && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                    Guest notes
                  </p>
                  <p className="text-sm italic text-gray-700">"{r.notes}"</p>
                </div>
              )}

              {r.internalNotes && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                    Internal notes
                  </p>
                  <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    {r.internalNotes}
                  </p>
                </div>
              )}

              {/* Guest profile context */}
              {r.guestProfile && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-indigo-900 mb-1">
                    Guest profile
                    {(r.guestProfile.vipTier ?? 0) > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-amber-900">
                        ★ VIP
                      </span>
                    )}
                  </p>
                  <div className="text-xs text-indigo-800 space-y-1">
                    {(r.guestProfile.visitCount ?? 0) > 0 && (
                      <p>{r.guestProfile.visitCount} previous visit(s)</p>
                    )}
                    {(r.guestProfile.allergies?.length ?? 0) > 0 && (
                      <p className="text-red-700">
                        ⚠ Allergies: {r.guestProfile.allergies!.join(", ")}
                      </p>
                    )}
                    {(r.guestProfile.dietaryRestrictions?.length ?? 0) > 0 && (
                      <p className="text-amber-700">
                        Diet: {r.guestProfile.dietaryRestrictions!.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {!loading && r && !editing && (
          <div className="px-5 py-3 border-t border-gray-200 space-y-2">
            {/* Status transitions — quick action chips */}
            <div className="flex flex-wrap gap-1.5">
              {r.status === "CONFIRMED" && (
                <button
                  onClick={() => changeStatus("ARRIVED")}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-purple-100 text-purple-800 hover:bg-purple-200 disabled:opacity-50"
                >
                  Mark arrived
                </button>
              )}
              {(r.status === "CONFIRMED" || r.status === "ARRIVED") && (
                <button
                  onClick={() => changeStatus("SEATED")}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50"
                >
                  Seat now
                </button>
              )}
              {r.status === "SEATED" && (
                <button
                  onClick={() => changeStatus("COMPLETED")}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-50"
                >
                  Mark completed
                </button>
              )}
              {r.status === "CONFIRMED" && (
                <button
                  onClick={() => changeStatus("NO_SHOW")}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-red-100 text-red-800 hover:bg-red-200 disabled:opacity-50"
                >
                  Mark no-show
                </button>
              )}
            </div>

            {/* Edit + Cancel */}
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(true)}
                disabled={busy}
                className="flex-1 px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              >
                Edit
              </button>
              {r.status !== "CANCELLED" && r.status !== "COMPLETED" && (
                <button
                  onClick={handleCancel}
                  disabled={busy}
                  className="px-3 py-1.5 text-sm rounded text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {editing && editForm && (
          <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={busy}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save"}
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
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 mt-0.5">{children}</p>
    </div>
  );
}
