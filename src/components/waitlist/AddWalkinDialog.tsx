"use client";

// ============================================================================
// AddWalkinDialog — quick form for adding a walk-in to the waitlist.
//
// One screen (not multi-step like reservations) because walk-ins need to
// happen FAST at the host stand. Average host should add an entry in <10 sec.
// ============================================================================

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface AddWalkinDialogProps {
  open: boolean;
  tenantId: string;
  locationId: string;
  onClose: () => void;
  onAdded: () => void;
}

interface SectionOption {
  id: string;
  name: string;
  color: string;
}

const PARTY_SIZE_PRESETS = [1, 2, 3, 4, 5, 6, 8];

export default function AddWalkinDialog({
  open,
  tenantId,
  locationId,
  onClose,
  onAdded,
}: AddWalkinDialogProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [partySize, setPartySize] = useState<number>(2);
  const [preferredSectionId, setPreferredSectionId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [busy, setBusy] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setCustomerName("");
      setCustomerPhone("");
      setPartySize(2);
      setPreferredSectionId("");
      setNotes("");
    }
  }, [open]);

  // Load sections for picker (from the default floor plan)
  useEffect(() => {
    if (!open) return;
    fetch(`/api/tenants/${tenantId}/locations/${locationId}/floor-view`)
      .then((r) => r.json())
      .then((data) => setSections(data.sections ?? []))
      .catch(() => {});
  }, [open, tenantId, locationId]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!customerName.trim()) {
      toast.error("Customer name required");
      return;
    }
    if (!customerPhone.trim()) {
      toast.error("Phone required (so we can SMS when ready)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/waitlist`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim(),
            partySize,
            ...(preferredSectionId && { preferredSectionId }),
            ...(notes && { notes: notes.trim() }),
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(
        `Added ${customerName} — quoted ${data.entry.quotedWaitMinutes} min`
      );
      onAdded();
      onClose();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Add walk-in to waitlist</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <Field label="Customer name">
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Sarah Kim"
              autoFocus
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>

          {/* Phone */}
          <Field label="Phone (for SMS when ready)">
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="e.g. 416-555-1234"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>

          {/* Party size */}
          <Field label="Party size">
            <div className="grid grid-cols-7 gap-1.5">
              {PARTY_SIZE_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPartySize(n)}
                  className={`py-2 rounded font-semibold text-sm transition-colors ${
                    partySize === n
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={1}
              max={50}
              value={partySize}
              onChange={(e) => setPartySize(Math.max(1, parseInt(e.target.value) || 1))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1 text-xs"
              placeholder="Custom (larger party)"
            />
          </Field>

          {/* Preferred section (optional) */}
          {sections.length > 0 && (
            <Field label="Preferred area (optional)">
              <div className="flex gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setPreferredSectionId("")}
                  className={`px-2.5 py-1 text-xs rounded-full border ${
                    !preferredSectionId
                      ? "bg-gray-100 border-gray-400 text-gray-800"
                      : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  Any
                </button>
                {sections.map((s) => {
                  const active = preferredSectionId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setPreferredSectionId(s.id)}
                      className={`px-2.5 py-1 text-xs rounded-full border ${
                        active ? "border-gray-900" : "border-gray-300 hover:border-gray-400"
                      }`}
                      style={{
                        backgroundColor: active ? s.color : s.color + "20",
                        color: active ? "#fff" : s.color,
                      }}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {/* Notes */}
          <Field label="Notes (optional)">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. window seat, high chair, allergic to nuts"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
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
            className="px-4 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? "Adding..." : "Add to queue"}
            <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
