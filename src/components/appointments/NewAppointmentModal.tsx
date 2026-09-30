"use client";

// Staff-side appointment booking modal — Phase 8 QA.
//
// Opens from the Appointments page's "New Appointment" button. Captures
// everything needed to create a scheduled appointment WITHOUT detouring
// through the POS flow (which is meant for walk-ins).
//
// Flow: services → date → slot → customer → confirm.
// Submits POST /api/tenants/[id]/orders with orderType=APPOINTMENT,
// items[] built from picked services, appointmentDate/Time on the
// order, and technicianId on each item.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Product {
  id: string;
  name: string;
  // Product model uses `basePrice` (cents), not `price`. Optional keeps
  // TypeScript happy in case the API adds/renames.
  basePrice: number;
  prepTimeMinutes: number | null;
}

interface Staff {
  id: string;
  name: string | null;
  email: string;
}

interface Slot {
  startTime: string;
  endTime: string;
  technicianId: string;
  technicianName: string;
}

interface NewAppointmentModalProps {
  tenantId: string;
  locationId: string | null;
  currency: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtMoney(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export default function NewAppointmentModal({
  tenantId,
  locationId,
  currency,
  isOpen,
  onClose,
  onCreated,
}: NewAppointmentModalProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [technicianId, setTechnicianId] = useState<string>("");
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsReason, setSlotsReason] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Load services + staff once when modal opens.
  useEffect(() => {
    if (!isOpen || !tenantId) return;
    // Reset transient state so a re-open doesn't show a stale slot.
    setSelectedServiceIds([]);
    setTechnicianId("");
    setSelectedSlot(null);
    setCustomerName("");
    setCustomerPhone("");
    setNotes("");
    setDate(new Date().toISOString().slice(0, 10));

    Promise.all([
      fetch(`/api/tenants/${tenantId}/products`).then((r) => r.json()),
      fetch(`/api/tenants/${tenantId}/staff`).then((r) => r.json()),
    ])
      .then(([pd, sd]) => {
        if (pd.success)
          setProducts(
            (pd.products || []).filter((p: any) => p.isActive !== false)
          );
        if (sd.success) setStaff(sd.staff || []);
      })
      .catch(() => toast.error("Failed to load menu / staff"));
  }, [isOpen, tenantId]);

  // Refetch slots on date / tech / services change.
  useEffect(() => {
    if (
      !isOpen ||
      !tenantId ||
      !locationId ||
      !date ||
      selectedServiceIds.length === 0
    ) {
      setSlots([]);
      setSlotsReason(null);
      return;
    }
    setSlotsLoading(true);
    const qs = new URLSearchParams({
      locationId,
      date,
      serviceIds: selectedServiceIds.join(","),
    });
    if (technicianId) qs.set("technicianId", technicianId);
    fetch(`/api/tenants/${tenantId}/availability?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSlots(d.availableSlots || []);
          setSlotsReason(d.reason || null);
        } else {
          setSlots([]);
          setSlotsReason(d.error || "Unavailable");
        }
      })
      .catch(() => {
        setSlots([]);
        setSlotsReason("Network error");
      })
      .finally(() => setSlotsLoading(false));
  }, [isOpen, tenantId, locationId, date, technicianId, selectedServiceIds]);

  const selectedServices = useMemo(
    () => products.filter((p) => selectedServiceIds.includes(p.id)),
    [products, selectedServiceIds]
  );
  const totalPriceCents = selectedServices.reduce((s, p) => s + p.basePrice, 0);
  const totalDurationMins = selectedServices.reduce(
    (s, p) => s + (p.prepTimeMinutes || 30),
    0
  );

  const uniqueSlots = useMemo(() => {
    const seen = new Map<string, Slot>();
    for (const s of slots) if (!seen.has(s.startTime)) seen.set(s.startTime, s);
    return Array.from(seen.values()).sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );
  }, [slots]);

  const canSubmit =
    selectedServiceIds.length > 0 &&
    !!selectedSlot &&
    !!customerName.trim() &&
    !submitting;

  const submit = async () => {
    if (!canSubmit || !selectedSlot || !locationId) return;
    setSubmitting(true);
    try {
      // Tech resolution matches SalonBookingFlow: explicit pick wins,
      // else use the engine's load-balanced first slot's tech.
      const finalTechId = technicianId || selectedSlot.technicianId;
      const items = selectedServices.map((p) => ({
        productId: p.id,
        quantity: 1,
        technicianId: finalTechId,
      }));
      const res = await fetch(`/api/tenants/${tenantId}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          orderType: "APPOINTMENT",
          items,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || undefined,
          notes: notes.trim() || undefined,
          appointmentDate: date,
          appointmentTime: selectedSlot.startTime,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data?.error || "Failed to create appointment");
        return;
      }
      toast.success("Appointment created");
      onCreated();
      onClose();
    } catch {
      toast.error("Failed to create appointment");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const dateOptions = Array.from({ length: 14 }, (_, i) => {
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

  const toggleService = (id: string) =>
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">New Appointment</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Book a scheduled appointment on behalf of a customer.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* Services */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Services</h3>
            {products.length === 0 ? (
              <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
                No services in your menu yet. Add services (as Products) first.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {products.map((p) => {
                  const on = selectedServiceIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleService(p.id)}
                      className={`w-full text-left p-2.5 rounded-lg border transition-all flex items-center gap-3 ${
                        on
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center ${
                          on
                            ? "bg-indigo-600 text-white"
                            : "border-2 border-gray-300"
                        }`}
                      >
                        {on && (
                          <Icon icon="solar:check-linear" className="w-3 h-3" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {p.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {p.prepTimeMinutes || 30} min
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {fmtMoney(p.basePrice, currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedServices.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                {selectedServices.length} selected · {totalDurationMins} min ·{" "}
                <span className="font-semibold text-gray-900">
                  {fmtMoney(totalPriceCents, currency)}
                </span>
              </p>
            )}
          </section>

          {/* Technician */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              Technician
            </h3>
            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm text-gray-900"
            >
              <option value="">No preference — first available</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.email}
                </option>
              ))}
            </select>
          </section>

          {/* Date + slot */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              Date & time
            </h3>
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3">
              {dateOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setDate(opt.value);
                    setSelectedSlot(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                    date === opt.value
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {selectedServiceIds.length === 0 ? (
              <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
                Pick at least one service to see available times.
              </p>
            ) : slotsLoading ? (
              <div className="grid grid-cols-4 gap-1.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-9 bg-gray-100 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            ) : uniqueSlots.length === 0 ? (
              <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg text-center">
                No slots available.{" "}
                {slotsReason && <span>({slotsReason})</span>}
              </p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-40 overflow-y-auto">
                {uniqueSlots.map((s) => {
                  const on =
                    selectedSlot?.startTime === s.startTime &&
                    selectedSlot?.technicianId === s.technicianId;
                  return (
                    <button
                      key={`${s.startTime}-${s.technicianId}`}
                      onClick={() => setSelectedSlot(s)}
                      className={`py-1.5 px-1 rounded-lg text-xs font-medium border transition-colors ${
                        on
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-800 border-gray-200 hover:border-gray-400"
                      }`}
                      title={`with ${s.technicianName}`}
                    >
                      {formatTime12(s.startTime)}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Customer */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Customer</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name *"
                className="px-3 py-2 rounded-lg border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
              />
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="px-3 py-2 rounded-lg border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm"
              />
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Notes (optional)"
              className="w-full mt-2 px-3 py-2 rounded-lg border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm resize-none"
            />
          </section>
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-5 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating…" : "Create Appointment"}
          </button>
        </div>
      </div>
    </div>
  );
}
