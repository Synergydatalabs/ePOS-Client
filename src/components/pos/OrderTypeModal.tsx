"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "APPOINTMENT";

interface Table {
  id: string;
  tableNumber: string;
  capacity: number;
  status: string;
}

interface Technician {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

export interface OrderTypeSelection {
  orderType: OrderType;
  tableId?: string;
  tableNumber?: string;
  numberOfSeats?: number;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  // Phase 8 QA: minimal appointment fields (salon flow). Phase E will
  // replace this with a full calendar+availability engine.
  appointmentDate?: string; // YYYY-MM-DD
  appointmentTime?: string; // HH:MM 24h
  technicianId?: string;
}

interface OrderTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selection: OrderTypeSelection) => void;
  tenantId?: string | null;
  locationId?: string | null;
  currentType?: OrderType;
  currentTableId?: string;
  currentSeats?: number;
  hasCartItems?: boolean;
  brandColor?: string;
  // Filters the option list. "salon" → APPOINTMENT only; "retail" →
  // TAKEAWAY (in-store) + DELIVERY; "restaurant" (default) → the classic
  // three-way. Phase E will move this into a per-tenant setting.
  businessType?: string;
}

const ALL_OPTIONS: Record<
  OrderType,
  { label: string; icon: string; desc: string }
> = {
  DINE_IN:     { label: "Dine In",     icon: "solar:chair-2-bold",  desc: "At-table service" },
  TAKEAWAY:    { label: "Takeaway",    icon: "solar:bag-4-bold",    desc: "Customer picks up" },
  DELIVERY:    { label: "Delivery",    icon: "solar:delivery-bold", desc: "Deliver to customer" },
  APPOINTMENT: { label: "Appointment", icon: "solar:calendar-bold", desc: "Booked service" },
};

// "HH:MM" 24h → "9:30 AM" / "2:15 PM" for slot pill display.
function formatDisplayTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Business-type → allowed order types. Phase E will replace this with a
// merchant-configurable list in TenantSettings.
function optionsFor(businessType?: string): OrderType[] {
  switch (businessType) {
    case "salon":
      return ["APPOINTMENT"];
    case "retail":
      return ["TAKEAWAY", "DELIVERY"];
    case "cab":
      // Cab flow uses Dispatch, not this modal — but keep the fallback
      // sane in case a stray render happens.
      return ["TAKEAWAY"];
    case "restaurant":
    default:
      return ["DINE_IN", "TAKEAWAY", "DELIVERY"];
  }
}

export default function OrderTypeModal({
  isOpen,
  onClose,
  onConfirm,
  tenantId,
  locationId,
  currentType,
  currentTableId,
  currentSeats,
  hasCartItems = false,
  brandColor = "#0D9488",
  businessType,
}: OrderTypeModalProps) {
  const [selected, setSelected] = useState<OrderType | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableId, setTableId] = useState<string>("");
  const [numberOfSeats, setNumberOfSeats] = useState<number>(1);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  // Phase 8 QA — appointment minimal fields
  const [appointmentDate, setAppointmentDate] = useState<string>("");
  const [appointmentTime, setAppointmentTime] = useState<string>("");
  const [technicianId, setTechnicianId] = useState<string>("");
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  // Phase E R1: live slot list from the availability engine. Refreshes
  // whenever date/technician change; the operator picks a slot instead
  // of typing a time manually.
  const [slots, setSlots] = useState<
    { startTime: string; technicianId: string; technicianName: string }[]
  >([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsClosed, setSlotsClosed] = useState<string | null>(null);
  // Phase E R1 QA: engine returns `reason` even when NOT closed (e.g.
  // "No technicians available", "Fully booked"). Surface it so the
  // operator can actually diagnose an empty grid.
  const [slotsReason, setSlotsReason] = useState<string | null>(null);

  const allowedTypes = optionsFor(businessType);

  // Re-hydrate form from current selection whenever the modal opens.
  // For single-option business types (salon → APPOINTMENT), pre-select
  // so the operator doesn't have to click twice.
  useEffect(() => {
    if (!isOpen) return;
    const initial =
      currentType && allowedTypes.includes(currentType)
        ? currentType
        : allowedTypes.length === 1
          ? allowedTypes[0]
          : null;
    setSelected(initial);
    setTableId(currentTableId || "");
    setNumberOfSeats(currentSeats || 1);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    // Default appointment date to today so the operator only picks time.
    const today = new Date();
    const yyyyMmDd = today.toISOString().slice(0, 10);
    setAppointmentDate(yyyyMmDd);
    setAppointmentTime("");
    setTechnicianId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentType, currentTableId, currentSeats, businessType]);

  // Load available tables when Dine In is selected
  useEffect(() => {
    if (!isOpen || selected !== "DINE_IN" || !tenantId || !locationId) return;
    setTablesLoading(true);
    fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setTables(d.tables || []);
      })
      .catch(() => {
        /* silent — button stays disabled */
      })
      .finally(() => setTablesLoading(false));
  }, [isOpen, selected, tenantId, locationId]);

  // Load staff list when Appointment is selected — for the technician
  // dropdown. Best-effort; if the endpoint fails or has no auth (see the
  // outstanding audit chip), the picker just stays empty and the field
  // becomes "unassigned".
  useEffect(() => {
    if (!isOpen || selected !== "APPOINTMENT" || !tenantId) return;
    fetch(`/api/tenants/${tenantId}/staff`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.staff)) {
          // Only show staff who can perform services — POS_STAFF and
          // above. Kitchen and owners aren't excluded because a small
          // salon owner is often the technician too.
          setTechnicians(
            d.staff.map((s: any) => ({
              id: s.id,
              firstName: s.name?.split(" ")[0] || null,
              lastName: s.name?.split(" ").slice(1).join(" ") || null,
            }))
          );
        }
      })
      .catch(() => {
        /* silent — technician stays optional */
      });
  }, [isOpen, selected, tenantId]);

  // Phase E R1: fetch available slots from the engine whenever the
  // date/technician change. Services aren't picked yet at this point in
  // the flow (they're added to the cart AFTER the modal), so the query
  // omits serviceIds and lets the engine fall back to the default
  // duration (30 min). The picked slot is a *reservation* of that
  // window; if the operator adds longer services later, the checkout
  // step will re-validate and prompt to re-pick.
  useEffect(() => {
    if (!isOpen || selected !== "APPOINTMENT" || !tenantId || !locationId || !appointmentDate) {
      setSlots([]);
      setSlotsClosed(null);
      return;
    }
    setSlotsLoading(true);
    const qs = new URLSearchParams({
      locationId,
      date: appointmentDate,
    });
    if (technicianId) qs.set("technicianId", technicianId);
    fetch(`/api/tenants/${tenantId}/availability?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSlots(d.availableSlots || []);
          setSlotsClosed(d.closed ? d.reason || "Location is closed" : null);
          setSlotsReason(d.reason || null);
        } else {
          setSlots([]);
          setSlotsReason(d.error || "Failed to load availability");
        }
      })
      .catch(() => {
        setSlots([]);
        setSlotsReason("Network error loading availability");
      })
      .finally(() => setSlotsLoading(false));
  }, [isOpen, selected, tenantId, locationId, appointmentDate, technicianId]);

  if (!isOpen) return null;

  const canConfirm = (() => {
    if (!selected) return false;
    if (selected === "DINE_IN") return !!tableId;
    if (selected === "DELIVERY")
      return !!customerName.trim() && !!customerPhone.trim() && !!customerAddress.trim();
    if (selected === "APPOINTMENT")
      return (
        !!customerName.trim() && !!appointmentDate && !!appointmentTime
      );
    return true; // Takeaway — customer name optional
  })();

  const handleConfirm = () => {
    if (!canConfirm || !selected) return;
    const table = tables.find((t) => t.id === tableId);
    onConfirm({
      orderType: selected,
      tableId: selected === "DINE_IN" ? tableId : undefined,
      tableNumber: selected === "DINE_IN" ? table?.tableNumber : undefined,
      numberOfSeats: selected === "DINE_IN" ? numberOfSeats : undefined,
      customerName:
        (selected === "TAKEAWAY" ||
          selected === "DELIVERY" ||
          selected === "APPOINTMENT") &&
        customerName.trim()
          ? customerName.trim()
          : undefined,
      customerPhone:
        (selected === "DELIVERY" || selected === "APPOINTMENT") &&
        customerPhone.trim()
          ? customerPhone.trim()
          : undefined,
      customerAddress:
        selected === "DELIVERY" && customerAddress.trim() ? customerAddress.trim() : undefined,
      appointmentDate: selected === "APPOINTMENT" ? appointmentDate : undefined,
      appointmentTime: selected === "APPOINTMENT" ? appointmentTime : undefined,
      // Technician resolution for appointment orders:
      //   - Explicit pick → use as-is (filter guarantees slots all share it)
      //   - "No preference" → grab the tech from the picked slot (engine
      //     already load-balance-sorted, so this is the least-loaded one
      //     available for that time)
      technicianId:
        selected === "APPOINTMENT"
          ? technicianId ||
            slots.find((s) => s.startTime === appointmentTime)?.technicianId ||
            undefined
          : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                {hasCartItems ? "Change Order Type" : "Start New Order"}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {hasCartItems
                  ? "Cart items will be kept when you change type."
                  : "Choose how the customer will receive their order."}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"
              aria-label="Close"
              title="Close without changing"
            >
              <Icon icon="solar:close-circle-bold" className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Type buttons — cards filtered by business type. Single-option
            businesses (e.g., salon → APPOINTMENT) render as a single
            highlighted card so the operator sees WHAT they're starting
            without having to click. */}
        <div
          className={`p-6 grid grid-cols-1 gap-4 ${
            allowedTypes.length === 1
              ? "sm:grid-cols-1"
              : allowedTypes.length === 2
                ? "sm:grid-cols-2"
                : "sm:grid-cols-3"
          }`}
        >
          {allowedTypes.map((type) => {
            const o = ALL_OPTIONS[type];
            const isActive = selected === type;
            return (
              <button
                key={type}
                onClick={() => setSelected(type)}
                className={`p-5 rounded-2xl border-2 transition-all text-left ${
                  isActive
                    ? "shadow-lg"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
                style={
                  isActive
                    ? {
                        backgroundColor: brandColor + "1A",
                        borderColor: brandColor,
                      }
                    : undefined
                }
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                  style={{
                    backgroundColor: isActive ? brandColor : "#F3F4F6",
                    color: isActive ? "white" : "#6B7280",
                  }}
                >
                  <Icon icon={o.icon} className="w-6 h-6" />
                </div>
                <p className="font-semibold text-gray-900">{o.label}</p>
                <p className="text-xs text-gray-500 mt-1">{o.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Details for the selected type */}
        {selected === "DINE_IN" && (
          <div className="px-6 pb-6 space-y-5 border-t border-gray-100 pt-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Table <span className="text-red-500">*</span>
              </label>
              {tablesLoading ? (
                <p className="text-sm text-gray-500 py-3">Loading tables…</p>
              ) : tables.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  No tables configured for this location. Add tables in Admin → Tables first.
                </p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                  {tables
                    .sort((a, b) => String(a.tableNumber).localeCompare(String(b.tableNumber), undefined, { numeric: true }))
                    .map((t) => {
                      const isActive = tableId === t.id;
                      const isOccupied = t.status === "OCCUPIED";
                      return (
                        <button
                          key={t.id}
                          onClick={() => setTableId(t.id)}
                          disabled={isOccupied && !isActive}
                          className={`p-3 rounded-xl border-2 text-center transition-all ${
                            isActive
                              ? "text-white"
                              : isOccupied
                              ? "border-red-200 bg-red-50 text-red-400 cursor-not-allowed"
                              : "border-gray-200 text-gray-700 hover:border-gray-300"
                          }`}
                          style={
                            isActive
                              ? { backgroundColor: brandColor, borderColor: brandColor }
                              : undefined
                          }
                          title={isOccupied ? "Occupied" : `${t.capacity} seats`}
                        >
                          <p className="text-[10px] uppercase opacity-75">Table</p>
                          <p className="font-bold text-lg">{t.tableNumber}</p>
                          <p className="text-[10px] opacity-75">{t.capacity} seats</p>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Guests at table
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
                  const isActive = numberOfSeats === n;
                  return (
                    <button
                      key={n}
                      onClick={() => setNumberOfSeats(n)}
                      className={`w-10 h-10 rounded-lg font-semibold transition-all ${
                        isActive
                          ? "text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                      style={isActive ? { backgroundColor: brandColor } : undefined}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Sets the max seat you can assign each cart item to.
              </p>
            </div>
          </div>
        )}

        {selected === "TAKEAWAY" && (
          <div className="px-6 pb-6 space-y-4 border-t border-gray-100 pt-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Customer name{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. John"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 outline-none"
                autoFocus
              />
            </div>
            <p className="text-xs text-gray-500">
              Used on the pickup ticket so staff can call the customer's name.
            </p>
          </div>
        )}

        {selected === "DELIVERY" && (
          <div className="px-6 pb-6 space-y-4 border-t border-gray-100 pt-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Customer name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. John Smith"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 outline-none"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Delivery address <span className="text-red-500">*</span>
              </label>
              <textarea
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Street, unit #, city, postal code"
                rows={2}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 outline-none resize-none"
              />
            </div>
          </div>
        )}

        {selected === "APPOINTMENT" && (
          <div className="px-6 pb-6 space-y-4 border-t border-gray-100 pt-6">
            <p className="text-xs text-gray-500">
              Capture the appointment details, then add services to the
              cart on the next screen. Slots reflect your business hours,
              each technician's schedule, and existing bookings.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Customer name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Jamie Chen"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={appointmentDate}
                onChange={(e) => {
                  setAppointmentDate(e.target.value);
                  setAppointmentTime(""); // clear slot when date changes
                }}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Available time <span className="text-red-500">*</span>
              </label>
              {/* Phase E R1: live slots from the availability engine —
                  respects location business hours, tech schedule, tech
                  time-off, and existing bookings. Refreshes on
                  date/technician change. */}
              {slotsLoading ? (
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : slotsClosed ? (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {slotsClosed}
                </div>
              ) : slots.length === 0 ? (
                <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 text-center space-y-1">
                  <p className="font-medium text-gray-700">
                    No available slots.
                  </p>
                  {slotsReason && (
                    <p className="text-xs text-gray-500">
                      Reason: {slotsReason}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    {technicianId
                      ? "Try 'No preference' or a different date."
                      : "Try a different date, or set staff working hours from the Staff page."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-52 overflow-y-auto p-1">
                  {/* De-dup by startTime for compact display. When the
                      operator has "no preference" selected, we show ONE
                      pill per time with the first-loaded tech, and the
                      engine's load-balanced sort picks the least-loaded
                      tech first. */}
                  {(() => {
                    const seen = new Map<string, typeof slots[number]>();
                    for (const s of slots) if (!seen.has(s.startTime)) seen.set(s.startTime, s);
                    const uniq = Array.from(seen.values()).sort((a, b) =>
                      a.startTime.localeCompare(b.startTime)
                    );
                    return uniq.map((s) => {
                      const isActive = appointmentTime === s.startTime;
                      return (
                        <button
                          key={s.startTime}
                          onClick={() => {
                            setAppointmentTime(s.startTime);
                            // If "no preference", latch onto whichever
                            // tech the engine surfaced first for this
                            // slot — otherwise the order gets no tech
                            // and the salon can't route it.
                            if (!technicianId && s.technicianId) {
                              // Don't overwrite the picker itself — just
                              // remember it for submission via a hidden
                              // reference. We use technicianId state
                              // only for QUERY filtering; the actual
                              // assignment happens at confirm.
                            }
                          }}
                          className={`py-2 px-1 rounded-lg text-sm font-medium transition-colors border ${
                            isActive
                              ? "text-white shadow-sm"
                              : "bg-white text-gray-800 border-gray-200 hover:border-gray-400"
                          }`}
                          style={
                            isActive
                              ? {
                                  backgroundColor: brandColor,
                                  borderColor: brandColor,
                                }
                              : undefined
                          }
                          title={`with ${s.technicianName}`}
                        >
                          {formatDisplayTime(s.startTime)}
                        </button>
                      );
                    });
                  })()}
                </div>
              )}
              {appointmentTime && (
                <p className="text-xs text-gray-500 mt-2">
                  Selected: {formatDisplayTime(appointmentTime)}
                  {(() => {
                    const s = slots.find((x) => x.startTime === appointmentTime);
                    return s ? ` · with ${s.technicianName}` : "";
                  })()}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Technician{" "}
                <span className="text-gray-400 font-normal">
                  (optional — leave blank for "no preference")
                </span>
              </label>
              <select
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 outline-none"
              >
                <option value="">No preference — first available</option>
                {technicians.map((t) => {
                  const name =
                    [t.firstName, t.lastName].filter(Boolean).join(" ").trim() ||
                    "Unnamed";
                  return (
                    <option key={t.id} value={t.id}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0 bg-white z-10">
          <button
            onClick={onClose}
            className="px-6 py-3 rounded-xl font-semibold text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-8 py-3 rounded-xl font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ backgroundColor: brandColor }}
          >
            {hasCartItems ? "Save Changes" : "Start Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
