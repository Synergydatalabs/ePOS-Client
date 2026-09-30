"use client";

// Public salon appointment booking flow — Phase E R3.
//
// Five-step wizard shown at /book/[tenantSlug]/[locationSlug] when the
// tenant is a salon. Steps:
//   1. Services  — multi-select from the tenant's bookable service list
//   2. Technician — pick one or leave "No preference" (load-balanced)
//   3. Date + slot — grid of times from the availability engine
//   4. Contact  — name / phone / (optional) email
//   5. Confirm  — review, submit, show confirmation ref
//
// The engine is the source of truth for slot legality — the confirm
// endpoint re-checks so a stolen-slot race is a friendly 409, not a
// silent double-book.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { useRecaptcha } from "@/hooks/useRecaptcha";

interface Service {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMinutes: number;
  imageUrl: string | null;
  currency: string;
}
interface Technician {
  id: string;
  displayName: string;
}
interface Slot {
  startTime: string;
  endTime: string;
  technicianId: string;
  technicianName: string;
}

interface SalonBookingFlowProps {
  tenantSlug: string;
  locationSlug: string;
  tenantName: string;
  locationName: string;
}

type Step = "services" | "technician" | "slot" | "contact" | "confirm" | "done";

function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtMoney(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export default function SalonBookingFlow({
  tenantSlug,
  locationSlug,
  tenantName,
  locationName,
}: SalonBookingFlowProps) {
  const [step, setStep] = useState<Step>("services");

  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);

  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>("");

  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsClosed, setSlotsClosed] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    orderNumber: string;
    displayNumber: number;
  } | null>(null);
  const recaptcha = useRecaptcha();

  // Bootstrap: services + technicians once. Neither changes often.
  useEffect(() => {
    setServicesLoading(true);
    Promise.all([
      fetch(`/api/public/book/${tenantSlug}/locations/${locationSlug}/services`),
      fetch(`/api/public/book/${tenantSlug}/locations/${locationSlug}/technicians`),
    ])
      .then(async ([sr, tr]) => {
        const [sd, td] = await Promise.all([sr.json(), tr.json()]);
        if (sd.success) setServices(sd.services);
        if (td.success) setTechnicians(td.technicians);
      })
      .catch(() => toast.error("Failed to load booking data"))
      .finally(() => setServicesLoading(false));
  }, [tenantSlug, locationSlug]);

  // Refetch slots whenever the inputs change AND we're on the slot step.
  // Debouncing not needed — date/tech changes are always deliberate clicks.
  useEffect(() => {
    if (step !== "slot" || selectedServiceIds.length === 0 || !date) {
      setSlots([]);
      setSlotsClosed(null);
      return;
    }
    setSlotsLoading(true);
    const qs = new URLSearchParams({
      date,
      serviceIds: selectedServiceIds.join(","),
    });
    if (selectedTechnicianId) qs.set("technicianId", selectedTechnicianId);
    fetch(
      `/api/public/book/${tenantSlug}/locations/${locationSlug}/appointment-availability?${qs.toString()}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSlots(d.slots || []);
          setSlotsClosed(d.closed ? d.reason || "Closed" : null);
        } else {
          setSlots([]);
          setSlotsClosed(d.error || "Unavailable");
        }
      })
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [step, date, selectedServiceIds, selectedTechnicianId, tenantSlug, locationSlug]);

  const selectedServices = useMemo(
    () => services.filter((s) => selectedServiceIds.includes(s.id)),
    [services, selectedServiceIds]
  );
  const totalPriceCents = selectedServices.reduce((sum, s) => sum + s.priceCents, 0);
  const totalDurationMins = selectedServices.reduce(
    (sum, s) => sum + s.durationMinutes,
    0
  );
  const currency = services[0]?.currency || "CAD";

  const toggleService = (id: string) =>
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  // De-dup slots by startTime for the picker — with "no preference" the
  // engine returns one slot per available tech; pill grid shows one per
  // time and remembers which tech to book.
  const uniqueSlots = useMemo(() => {
    const seen = new Map<string, Slot>();
    for (const s of slots) {
      if (!seen.has(s.startTime)) seen.set(s.startTime, s);
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );
  }, [slots]);

  const submit = async () => {
    if (!selectedSlot) return;
    setSubmitting(true);
    try {
      // Phase E R5: exec reCAPTCHA before the POST. Server treats an
      // empty token as failure when RECAPTCHA_SECRET_KEY is set.
      const recaptchaToken = await recaptcha.execute("book_appointment");
      const res = await fetch(
        `/api/public/book/${tenantSlug}/locations/${locationSlug}/appointment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName,
            customerPhone,
            customerEmail: customerEmail || undefined,
            serviceIds: selectedServiceIds,
            date,
            time: selectedSlot.startTime,
            technicianId: selectedTechnicianId || undefined,
            notes: notes || undefined,
            recaptchaToken,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Booking failed");
        // Slot conflict → send user back to pick a new one.
        if (res.status === 409) setStep("slot");
        return;
      }
      // Phase E R6: deposit required → redirect to the hosted deposit
      // checkout. The confirmation SMS is deferred until deposit clears
      // (server-side, in the mock-pay endpoint), so the customer should
      // land on /pay/appointment/[id] before they consider themselves
      // "booked". paymentUrl comes back on the same origin.
      if (data.depositRequired && data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }
      setConfirmation({
        orderNumber: data.order.orderNumber,
        displayNumber: data.order.displayNumber,
      });
      setStep("done");
    } catch {
      toast.error("Booking failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Date-pill row: today + next 6 days (7 total).
  const dateOptions = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      value: d.toISOString().slice(0, 10),
      label:
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : d.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              }),
    };
  });

  // Confirmation screen — separate from the wizard body.
  if (step === "done" && confirmation) {
    return (
      <div className="max-w-lg mx-auto text-center p-8 bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
          <Icon icon="solar:check-circle-bold" className="w-10 h-10 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">You're booked</h2>
        <p className="text-slate-500 mb-6">
          Confirmation sent to your phone.
        </p>
        <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2 mb-6">
          <div className="flex justify-between">
            <span className="text-slate-500">Reference</span>
            <span className="font-mono font-semibold text-slate-900">
              {confirmation.orderNumber}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Date</span>
            <span className="text-slate-900">{date}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Time</span>
            <span className="text-slate-900">
              {selectedSlot ? formatTime12(selectedSlot.startTime) : ""}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Total</span>
            <span className="font-semibold text-slate-900">
              {fmtMoney(totalPriceCents, currency)}
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Need to change? Reply to the confirmation SMS or contact{" "}
          {locationName} directly.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Header + progress */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">
          Book an appointment
        </p>
        <h1 className="text-2xl font-bold text-slate-900">{tenantName}</h1>
        <p className="text-sm text-slate-500">{locationName}</p>
      </div>

      {step === "services" && (
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <StepDot n={1} active />
            <h2 className="font-bold text-slate-900">Pick services</h2>
          </div>
          {servicesLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              No services available for online booking yet.
            </p>
          ) : (
            <div className="space-y-2">
              {services.map((s) => {
                const isSelected = selectedServiceIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleService(s.id)}
                    className={`w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${
                        isSelected ? "bg-indigo-600 text-white" : "border-2 border-slate-300"
                      }`}
                    >
                      {isSelected && (
                        <Icon icon="solar:check-linear" className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">{s.name}</p>
                      {s.description && (
                        <p className="text-xs text-slate-500 truncate">
                          {s.description}
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5">
                        {s.durationMinutes} min
                      </p>
                    </div>
                    <span className="font-semibold text-slate-900 flex-shrink-0">
                      {fmtMoney(s.priceCents, s.currency)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
            <div className="text-sm text-slate-500">
              {selectedServices.length > 0 && (
                <>
                  {selectedServices.length} selected · {totalDurationMins} min ·{" "}
                  <span className="font-semibold text-slate-900">
                    {fmtMoney(totalPriceCents, currency)}
                  </span>
                </>
              )}
            </div>
            <button
              onClick={() => setStep("technician")}
              disabled={selectedServiceIds.length === 0}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "technician" && (
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <StepDot n={2} active />
            <h2 className="font-bold text-slate-900">Pick a technician</h2>
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setSelectedTechnicianId("")}
              className={`w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                selectedTechnicianId === ""
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <Icon icon="solar:users-group-rounded-linear" className="w-5 h-5 text-indigo-600" />
              <div>
                <p className="font-medium text-slate-900">No preference</p>
                <p className="text-xs text-slate-500">First available technician</p>
              </div>
            </button>
            {technicians.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTechnicianId(t.id)}
                className={`w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                  selectedTechnicianId === t.id
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                  <Icon icon="solar:user-linear" className="w-5 h-5" />
                </div>
                <p className="font-medium text-slate-900">{t.displayName}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between">
            <button
              onClick={() => setStep("services")}
              className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              Back
            </button>
            <button
              onClick={() => setStep("slot")}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "slot" && (
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <StepDot n={3} active />
            <h2 className="font-bold text-slate-900">Pick a time</h2>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {dateOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setDate(opt.value);
                  setSelectedSlot(null);
                }}
                className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                  date === opt.value
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {slotsLoading ? (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : slotsClosed ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              {slotsClosed}
            </p>
          ) : uniqueSlots.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              No availability on this date. Try another day.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {uniqueSlots.map((s) => {
                const isActive =
                  selectedSlot?.startTime === s.startTime &&
                  selectedSlot?.technicianId === s.technicianId;
                return (
                  <button
                    key={`${s.startTime}-${s.technicianId}`}
                    onClick={() => setSelectedSlot(s)}
                    className={`py-2 px-1 rounded-lg text-sm font-medium border transition-colors ${
                      isActive
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-slate-800 border-slate-200 hover:border-slate-400"
                    }`}
                    title={`with ${s.technicianName}`}
                  >
                    {formatTime12(s.startTime)}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between">
            <button
              onClick={() => setStep("technician")}
              className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              Back
            </button>
            <button
              onClick={() => setStep("contact")}
              disabled={!selectedSlot}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "contact" && (
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <StepDot n={4} active />
            <h2 className="font-bold text-slate-900">Your contact</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Full name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                placeholder="Jane Chen"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Phone <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                placeholder="+1 (555) 123-4567"
              />
              <p className="text-xs text-slate-400 mt-1">
                We'll send a confirmation + reminders here.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                placeholder="jane@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Notes <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none"
                placeholder="e.g. sensitive scalp, allergies…"
              />
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between">
            <button
              onClick={() => setStep("slot")}
              className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              Back
            </button>
            <button
              onClick={() => setStep("confirm")}
              disabled={!customerName.trim() || !customerPhone.trim()}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40"
            >
              Review
            </button>
          </div>
        </section>
      )}

      {step === "confirm" && (
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <StepDot n={5} active />
            <h2 className="font-bold text-slate-900">Confirm</h2>
          </div>
          <div className="space-y-2 mb-4">
            {selectedServices.map((s) => (
              <div key={s.id} className="flex justify-between text-sm">
                <span className="text-slate-700">
                  {s.name}
                  <span className="text-slate-400"> · {s.durationMinutes} min</span>
                </span>
                <span className="text-slate-900">
                  {fmtMoney(s.priceCents, s.currency)}
                </span>
              </div>
            ))}
            <div className="flex justify-between text-sm pt-2 border-t border-slate-100">
              <span className="text-slate-500">Total</span>
              <span className="font-bold text-slate-900">
                {fmtMoney(totalPriceCents, currency)}
              </span>
            </div>
          </div>
          <div className="text-sm text-slate-600 space-y-1 mb-4">
            <p>
              <span className="text-slate-400">Date:</span> {date}
            </p>
            <p>
              <span className="text-slate-400">Time:</span>{" "}
              {selectedSlot ? formatTime12(selectedSlot.startTime) : ""}
            </p>
            <p>
              <span className="text-slate-400">Technician:</span>{" "}
              {selectedTechnicianId
                ? technicians.find((t) => t.id === selectedTechnicianId)?.displayName
                : "No preference"}
            </p>
            <p>
              <span className="text-slate-400">Contact:</span> {customerName} ·{" "}
              {customerPhone}
            </p>
          </div>
          <div className="flex justify-between">
            <button
              onClick={() => setStep("contact")}
              className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              Back
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40"
            >
              {submitting ? "Booking…" : "Confirm Booking"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function StepDot({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
        active ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"
      }`}
    >
      {n}
    </span>
  );
}
