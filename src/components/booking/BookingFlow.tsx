"use client";

// ============================================================================
// BookingFlow — multi-step reservation form for the public booking page.
//
// Steps:
//   1. Party size + date  (always visible together — single screen)
//   2. Time slot          (loaded async based on step 1)
//   3. Guest details      (name, phone, email, notes)
//   4. Confirmation       (success screen with code, post-submit)
//
// Designed for mobile-first — large tap targets, sticky CTA, minimal text.
// ============================================================================

import { useEffect, useState, useMemo } from "react";
import { Icon } from "@iconify/react";
import { useRecaptcha } from "@/hooks/useRecaptcha";

interface Slot {
  startsAt: string;
  label: string;
  remaining: number;
}

interface SpecialDate {
  date: string;
  label: string;
  blocked: boolean;
  publicMessage?: string | null;
}

interface BookingFlowProps {
  tenantSlug: string;
  locationSlug: string;
  locationName: string;
  restaurantName: string;
  maxPartySize: number;
  advanceDays: number;
  specialDates: SpecialDate[];
  brandPrimaryColor?: string | null;
}

export default function BookingFlow({
  tenantSlug,
  locationSlug,
  locationName,
  restaurantName,
  maxPartySize,
  advanceDays,
  specialDates,
  brandPrimaryColor,
}: BookingFlowProps) {
  const primary = brandPrimaryColor || "#4f46e5"; // indigo-600 default
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + advanceDays);
    return d.toISOString().slice(0, 10);
  }, [advanceDays]);

  const blockedDates = useMemo(
    () => new Set(specialDates.filter((s) => s.blocked).map((s) => s.date)),
    [specialDates]
  );

  // Form state
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState(today);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [occasion, setOccasion] = useState("");
  const [websiteHoneypot, setWebsiteHoneypot] = useState(""); // bot trap
  const recaptcha = useRecaptcha();

  // Async state
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Success state
  const [confirmation, setConfirmation] = useState<{
    code: string;
    customerName: string;
    partySize: number;
    bookedFor: string;
  } | null>(null);

  // Fetch slots whenever date or partySize changes
  useEffect(() => {
    if (!date || !partySize) return;
    if (blockedDates.has(date)) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    setSelectedSlot(null);
    fetch(
      `/api/public/book/${tenantSlug}/locations/${locationSlug}/availability?date=${date}&partySize=${partySize}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) setSlots(data.slots);
        else setSlots([]);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, partySize, tenantSlug, locationSlug, blockedDates]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    if (!name.trim() || !phone.trim()) {
      setError("Please provide your name and phone number.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Phase E R5: exec reCAPTCHA before the POST.
      const recaptchaToken = await recaptcha.execute("book_reservation");
      const res = await fetch(
        `/api/public/book/${tenantSlug}/locations/${locationSlug}/reserve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: name.trim(),
            customerPhone: phone.trim(),
            customerEmail: email.trim() || undefined,
            partySize,
            bookedFor: selectedSlot.startsAt,
            specialOccasion: occasion || undefined,
            notes: notes.trim() || undefined,
            website: websiteHoneypot,
            recaptchaToken,
          }),
        }
      );
      const data = await res.json();
      if (data.success && data.reservation) {
        setConfirmation({
          code: data.reservation.confirmationCode,
          customerName: data.reservation.customerName,
          partySize: data.reservation.partySize,
          bookedFor: data.reservation.bookedFor,
        });
      } else {
        setError(data.error || "Could not complete booking. Please try again.");
        if (data.retry) {
          // Slot was taken — reload slots
          setSelectedSlot(null);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ============================================================================
  // Confirmation screen
  // ============================================================================
  if (confirmation) {
    const bookedDate = new Date(confirmation.bookedFor);
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
          <Icon icon="solar:check-circle-bold" className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">You're booked!</h2>
        <p className="text-gray-600 mb-6">
          See you at {restaurantName} — {locationName}.
        </p>

        <div className="rounded-xl bg-gray-50 p-5 text-left space-y-2 mb-6">
          <Row label="Confirmation code" value={confirmation.code} mono />
          <Row label="Name" value={confirmation.customerName} />
          <Row label="Party of" value={String(confirmation.partySize)} />
          <Row
            label="When"
            value={bookedDate.toLocaleString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          />
        </div>

        <p className="text-sm text-gray-500">
          We've sent a confirmation to {phone}. Reply <strong>9</strong> there if you need to cancel.
        </p>

        <button
          onClick={() => {
            setConfirmation(null);
            setSelectedSlot(null);
            setName(""); setPhone(""); setEmail(""); setNotes(""); setOccasion("");
          }}
          className="mt-6 text-sm text-gray-600 hover:text-gray-900 underline"
        >
          Book another time
        </button>
      </div>
    );
  }

  // ============================================================================
  // Booking form
  // ============================================================================
  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Step 1: party size + date */}
      <div className="p-5 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span
            className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center"
            style={{ backgroundColor: primary }}
          >
            1
          </span>
          When & how many?
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5 uppercase tracking-wide">
              Party size
            </label>
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setPartySize(Math.max(1, partySize - 1))}
                className="px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-30"
                disabled={partySize <= 1}
                aria-label="Decrease party size"
              >
                <Icon icon="solar:minus-bold" className="w-4 h-4" />
              </button>
              <div className="flex-1 text-center py-2 font-semibold text-gray-900">
                {partySize} {partySize === 1 ? "guest" : "guests"}
              </div>
              <button
                type="button"
                onClick={() => setPartySize(Math.min(maxPartySize, partySize + 1))}
                className="px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-30"
                disabled={partySize >= maxPartySize}
                aria-label="Increase party size"
              >
                <Icon icon="solar:add-square-bold" className="w-4 h-4" />
              </button>
            </div>
            {partySize === maxPartySize && (
              <p className="text-xs text-gray-500 mt-1">
                For larger parties, please call the restaurant.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5 uppercase tracking-wide">
              Date
            </label>
            <input
              type="date"
              value={date}
              min={today}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {blockedDates.has(date) && (
              <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                <Icon icon="solar:close-circle-bold" className="w-3.5 h-3.5" />
                Closed on this date.
                {specialDates.find((s) => s.date === date)?.publicMessage && (
                  <span> {specialDates.find((s) => s.date === date)?.publicMessage}</span>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Step 2: time slots */}
      <div className="p-5 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span
            className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center"
            style={{ backgroundColor: selectedSlot ? primary : "#9ca3af" }}
          >
            2
          </span>
          Pick a time
        </h3>

        {loadingSlots ? (
          <div className="py-8 flex justify-center">
            <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : slots.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-500">
            <Icon icon="solar:calendar-search-bold" className="w-10 h-10 mx-auto text-gray-300 mb-2" />
            {blockedDates.has(date)
              ? "Closed on this date — try another."
              : "Nothing available for that combo. Try a different date or party size."}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {slots.map((slot) => {
              const isSelected = selectedSlot?.startsAt === slot.startsAt;
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  onClick={() => setSelectedSlot(slot)}
                  className={`py-2.5 px-2 rounded-lg text-sm font-medium border transition-all ${
                    isSelected
                      ? "text-white border-transparent"
                      : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                  }`}
                  style={isSelected ? { backgroundColor: primary } : {}}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 3: guest details — only shown after slot picked */}
      {selectedSlot && (
        <div className="p-5 border-b border-gray-100 space-y-4">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span
              className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center"
              style={{ backgroundColor: primary }}
            >
              3
            </span>
            Your details
          </h3>

          <Input
            label="Name *"
            value={name}
            onChange={setName}
            placeholder="First Last"
            autoComplete="name"
            required
          />
          <Input
            label="Mobile phone *"
            type="tel"
            value={phone}
            onChange={setPhone}
            placeholder="+1 416 555 1234"
            autoComplete="tel"
            required
            hint="We'll send confirmation + reminders via WhatsApp or SMS."
          />
          <Input
            label="Email (optional)"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
          />

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5 uppercase tracking-wide">
              Special occasion (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {["birthday", "anniversary", "date", "business"].map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOccasion(occasion === o ? "" : o)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                    occasion === o
                      ? "text-white border-transparent"
                      : "bg-white text-gray-700 border-gray-300"
                  }`}
                  style={occasion === o ? { backgroundColor: primary } : {}}
                >
                  {o.charAt(0).toUpperCase() + o.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5 uppercase tracking-wide">
              Notes for the restaurant (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Allergies, seating preferences, etc."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Honey-pot: hidden from real users via CSS, but bots fill anything they see */}
          <div className="hidden" aria-hidden="true">
            <label>Website (leave blank)</label>
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={websiteHoneypot}
              onChange={(e) => setWebsiteHoneypot(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="px-5 py-3 bg-red-50 border-t border-red-100 text-sm text-red-700 flex items-start gap-2">
          <Icon icon="solar:close-circle-bold" className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Sticky submit */}
      <div className="p-5 bg-gray-50">
        <button
          type="submit"
          disabled={!selectedSlot || !name.trim() || !phone.trim() || submitting}
          className="w-full py-3 px-4 rounded-xl font-semibold text-white text-sm shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ backgroundColor: primary }}
        >
          {submitting ? (
            <>
              <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
              Booking…
            </>
          ) : selectedSlot ? (
            <>
              Confirm booking for {partySize} at {selectedSlot.label}
              <Icon icon="solar:arrow-right-bold" className="w-4 h-4" />
            </>
          ) : (
            "Pick a time above to continue"
          )}
        </button>
        <p className="text-xs text-gray-500 text-center mt-2">
          By booking you agree to receive confirmation messages from {restaurantName}.
        </p>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------------------
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-semibold text-gray-900 ${mono ? "font-mono tracking-wider" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Input({
  label, value, onChange, placeholder, type = "text", required, hint, autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "tel" | "email";
  required?: boolean;
  hint?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
