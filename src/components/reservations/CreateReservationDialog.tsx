"use client";

// ============================================================================
// CreateReservationDialog — the 3-tap booking flow.
//
// Steps:
//   1. Pick TIME (date + time slot picker)
//   2. Pick PARTY SIZE (button grid 1-12 + "more...")
//   3. Pick GUEST (autocomplete from existing profiles + create new inline)
//      + optional notes/occasion in same step
//
// Compared to Toast's multi-step form, this is radically simpler — most
// reservations get created in under 15 seconds.
// ============================================================================

import { useState, useEffect, useMemo } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import {
  type GuestProfileSummary,
  COMMON_OCCASIONS,
  generateTimeSlots,
} from "@/lib/reservations/types";

interface CreateReservationDialogProps {
  open: boolean;
  tenantId: string;
  locationId: string;
  /** Pre-fill date (e.g. when clicking on a calendar cell). Defaults to today. */
  defaultDate?: Date;
  /** Pre-fill time (e.g. when clicking on a calendar cell). */
  defaultTime?: string;
  /** Pre-fill table (e.g. when clicking a table in floor plan). */
  defaultTableId?: string;
  onClose: () => void;
  onCreated: (reservationId: string) => void;
}

type Step = "time" | "party" | "guest";

const PARTY_SIZE_PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];

export default function CreateReservationDialog({
  open,
  tenantId,
  locationId,
  defaultDate,
  defaultTime,
  defaultTableId,
  onClose,
  onCreated,
}: CreateReservationDialogProps) {
  const [step, setStep] = useState<Step>("time");

  // Step 1: time
  const [date, setDate] = useState<string>(
    formatDateForInput(defaultDate ?? new Date())
  );
  const [time, setTime] = useState<string>(defaultTime ?? "");

  // Step 2: party
  const [partySize, setPartySize] = useState<number | null>(null);
  const [customSize, setCustomSize] = useState<string>("");

  // Step 3: guest
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GuestProfileSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<GuestProfileSummary | null>(null);
  const [newGuest, setNewGuest] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [occasion, setOccasion] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("time");
      setDate(formatDateForInput(defaultDate ?? new Date()));
      setTime(defaultTime ?? "");
      setPartySize(null);
      setCustomSize("");
      setSearchQuery("");
      setSearchResults([]);
      setSelectedProfile(null);
      setNewGuest({ firstName: "", lastName: "", phone: "", email: "" });
      setOccasion("");
      setNotes("");
    }
  }, [open, defaultDate, defaultTime]);

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/tenants/${tenantId}/locations/${locationId}/guest-profiles?q=${encodeURIComponent(searchQuery)}`
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.profiles ?? []);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchQuery, tenantId, locationId]);

  const timeSlots = useMemo(() => generateTimeSlots(11, 23, 30), []);

  if (!open) return null;

  const canAdvanceTime = !!date && !!time;
  const finalPartySize =
    partySize ?? (customSize ? parseInt(customSize, 10) : NaN);
  const canAdvanceParty = Number.isInteger(finalPartySize) && finalPartySize >= 1;

  const handleCreate = async () => {
    const customerName = selectedProfile
      ? [selectedProfile.firstName, selectedProfile.lastName].filter(Boolean).join(" ")
      : `${newGuest.firstName.trim()} ${newGuest.lastName.trim()}`.trim();

    if (!customerName) {
      toast.error("Guest name required");
      return;
    }
    if (!selectedProfile && !newGuest.phone && !newGuest.email) {
      toast.error("Need phone OR email for new guest");
      return;
    }

    setBusy(true);
    try {
      // Convert date+time to ISO
      const [hh, mm] = time.split(":").map(Number);
      const [yyyy, mo, dd] = date.split("-").map(Number);
      const bookedFor = new Date(yyyy, mo - 1, dd, hh, mm, 0, 0);

      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/reservations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName,
            customerPhone: selectedProfile?.phone ?? newGuest.phone ?? undefined,
            customerEmail: selectedProfile?.email ?? newGuest.email ?? undefined,
            partySize: finalPartySize,
            bookedFor: bookedFor.toISOString(),
            ...(defaultTableId && { tableId: defaultTableId }),
            ...(selectedProfile && { guestProfileId: selectedProfile.id }),
            source: "INTERNAL",
            ...(occasion && { specialOccasion: occasion }),
            ...(notes && { notes }),
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(`Reservation for ${customerName} confirmed`);
      onCreated(data.reservation.id);
      onClose();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header with step indicator */}
        <div className="px-5 py-3 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">New reservation</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
            >
              <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
            </button>
          </div>
          <StepIndicator currentStep={step} />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === "time" && (
            <TimeStep
              date={date}
              time={time}
              onDateChange={setDate}
              onTimeChange={setTime}
              timeSlots={timeSlots}
            />
          )}
          {step === "party" && (
            <PartyStep
              selected={partySize}
              custom={customSize}
              onSelect={(n) => {
                setPartySize(n);
                setCustomSize("");
              }}
              onCustomChange={(v) => {
                setCustomSize(v);
                setPartySize(null);
              }}
            />
          )}
          {step === "guest" && (
            <GuestStep
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              results={searchResults}
              searching={searching}
              selectedProfile={selectedProfile}
              onSelectProfile={setSelectedProfile}
              newGuest={newGuest}
              onNewGuestChange={setNewGuest}
              occasion={occasion}
              onOccasionChange={setOccasion}
              notes={notes}
              onNotesChange={setNotes}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between">
          {step === "time" ? (
            <span />
          ) : (
            <button
              onClick={() => setStep(step === "guest" ? "party" : "time")}
              disabled={busy}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              ← Back
            </button>
          )}

          {step === "time" && (
            <button
              onClick={() => setStep("party")}
              disabled={!canAdvanceTime}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              Next →
            </button>
          )}
          {step === "party" && (
            <button
              onClick={() => setStep("guest")}
              disabled={!canAdvanceParty}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              Next →
            </button>
          )}
          {step === "guest" && (
            <button
              onClick={handleCreate}
              disabled={busy}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {busy ? "Creating..." : "Confirm reservation"}
              <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step indicator
// ============================================================================

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const order: Step[] = ["time", "party", "guest"];
  const currentIdx = order.indexOf(currentStep);
  const labels: Record<Step, string> = {
    time: "Time",
    party: "Party",
    guest: "Guest",
  };

  return (
    <div className="flex items-center gap-1.5 mt-2">
      {order.map((s, i) => {
        const active = i === currentIdx;
        const done = i < currentIdx;
        return (
          <div key={s} className="flex items-center gap-1.5">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                active
                  ? "bg-indigo-600 text-white"
                  : done
                    ? "bg-emerald-500 text-white"
                    : "bg-gray-200 text-gray-500"
              }`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span
              className={`text-xs ${
                active ? "text-indigo-700 font-medium" : "text-gray-500"
              }`}
            >
              {labels[s]}
            </span>
            {i < order.length - 1 && <span className="text-gray-300">›</span>}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Step 1: Time
// ============================================================================

function TimeStep({
  date,
  time,
  onDateChange,
  onTimeChange,
  timeSlots,
}: {
  date: string;
  time: string;
  onDateChange: (d: string) => void;
  onTimeChange: (t: string) => void;
  timeSlots: string[];
}) {
  // Quick date chips: Today / Tomorrow / day-after
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const dayAfter = new Date(today.getTime() + 2 * 86400000);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Date
        </label>
        <div className="flex gap-2 mb-2">
          {[
            { label: "Today", d: today },
            { label: "Tomorrow", d: tomorrow },
            { label: dayAfter.toLocaleDateString("en-CA", { weekday: "short" }), d: dayAfter },
          ].map((opt) => {
            const v = formatDateForInput(opt.d);
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => onDateChange(v)}
                className={`px-3 py-1.5 text-sm rounded-md ${
                  date === v
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          min={formatDateForInput(today)}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Time
        </label>
        <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto">
          {timeSlots.map((slot) => {
            const selected = time === slot;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => onTimeChange(slot)}
                className={`px-2 py-1.5 text-sm rounded transition-colors ${
                  selected
                    ? "bg-indigo-600 text-white font-semibold"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}
              >
                {formatTimeFor12h(slot)}
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-gray-500">
          Other time?{" "}
          <input
            type="time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step 2: Party size
// ============================================================================

function PartyStep({
  selected,
  custom,
  onSelect,
  onCustomChange,
}: {
  selected: number | null;
  custom: string;
  onSelect: (n: number) => void;
  onCustomChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
        How many guests?
      </label>
      <div className="grid grid-cols-5 gap-2">
        {PARTY_SIZE_PRESETS.map((n) => {
          const active = selected === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onSelect(n)}
              className={`aspect-square rounded-lg font-bold text-lg transition-colors ${
                active
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Larger party (13+)
        </label>
        <input
          type="number"
          min={13}
          max={200}
          value={custom}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder="e.g. 25"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

// ============================================================================
// Step 3: Guest
// ============================================================================

function GuestStep({
  searchQuery,
  onSearchChange,
  results,
  searching,
  selectedProfile,
  onSelectProfile,
  newGuest,
  onNewGuestChange,
  occasion,
  onOccasionChange,
  notes,
  onNotesChange,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  results: GuestProfileSummary[];
  searching: boolean;
  selectedProfile: GuestProfileSummary | null;
  onSelectProfile: (p: GuestProfileSummary | null) => void;
  newGuest: { firstName: string; lastName: string; phone: string; email: string };
  onNewGuestChange: (g: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
  }) => void;
  occasion: string;
  onOccasionChange: (o: string) => void;
  notes: string;
  onNotesChange: (n: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Guest section */}
      {selectedProfile ? (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-indigo-900">
                {selectedProfile.firstName} {selectedProfile.lastName}
                {(selectedProfile.vipTier ?? 0) > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-amber-900">
                    ★ VIP
                  </span>
                )}
              </p>
              <p className="text-xs text-indigo-800 mt-0.5">
                {selectedProfile.phone || selectedProfile.email}
                {selectedProfile.visitCount ? ` • ${selectedProfile.visitCount} visits` : ""}
              </p>
              {(selectedProfile.allergies?.length ?? 0) > 0 && (
                <p className="text-xs text-red-700 mt-1">
                  ⚠ Allergies: {selectedProfile.allergies!.join(", ")}
                </p>
              )}
              {(selectedProfile.dietaryRestrictions?.length ?? 0) > 0 && (
                <p className="text-xs text-amber-700 mt-1">
                  Diet: {selectedProfile.dietaryRestrictions!.join(", ")}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onSelectProfile(null)}
              className="text-indigo-700 hover:text-indigo-900 text-xs"
            >
              Change
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Search existing */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Existing guest?
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by phone, email, or name..."
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {searching && (
              <p className="text-xs text-gray-500 mt-1">Searching...</p>
            )}
            {!searching && searchQuery.length >= 2 && results.length === 0 && (
              <p className="text-xs text-gray-500 mt-1">No matches. Enter new guest below.</p>
            )}
            {results.length > 0 && (
              <ul className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                {results.map((p) => (
                  <li
                    key={p.id}
                    onClick={() => onSelectProfile(p)}
                    className="px-3 py-2 rounded border border-gray-200 hover:border-indigo-400 cursor-pointer text-sm"
                  >
                    <p className="font-medium">
                      {p.firstName} {p.lastName}
                      {(p.vipTier ?? 0) > 0 && <span className="ml-1 text-amber-600">★</span>}
                    </p>
                    <p className="text-xs text-gray-500">
                      {p.phone || p.email}
                      {p.visitCount ? ` • ${p.visitCount} visits` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* OR new guest */}
          <div className="border-t pt-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Or new guest
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="First name *"
                value={newGuest.firstName}
                onChange={(e) =>
                  onNewGuestChange({ ...newGuest, firstName: e.target.value })
                }
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
              <input
                type="text"
                placeholder="Last name"
                value={newGuest.lastName}
                onChange={(e) =>
                  onNewGuestChange({ ...newGuest, lastName: e.target.value })
                }
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
              <input
                type="tel"
                placeholder="Phone *"
                value={newGuest.phone}
                onChange={(e) =>
                  onNewGuestChange({ ...newGuest, phone: e.target.value })
                }
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
              <input
                type="email"
                placeholder="Email (optional)"
                value={newGuest.email}
                onChange={(e) =>
                  onNewGuestChange({ ...newGuest, email: e.target.value })
                }
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-1">* Need phone OR email</p>
          </div>
        </div>
      )}

      {/* Occasion + notes */}
      <div className="border-t pt-3">
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Special occasion? (optional)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_OCCASIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onOccasionChange(occasion === opt ? "" : opt)}
              className={`px-2.5 py-1 text-xs rounded-full ${
                occasion === opt
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="e.g. seat near window, allergic to nuts, anniversary dessert..."
          rows={2}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm resize-none"
        />
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatDateForInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatTimeFor12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
