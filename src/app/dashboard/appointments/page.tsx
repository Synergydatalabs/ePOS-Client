"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import Link from "next/link";
import NewAppointmentModal from "@/components/appointments/NewAppointmentModal";
import TakePaymentModal from "@/components/appointments/TakePaymentModal";

interface Appointment {
  id: string;
  orderNumber: string;
  appointmentDate: string;
  appointmentTime: string;
  status: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  total: number;
  paymentStatus: string;
  // Completed payments on this order — deposit rows land here from the
  // /pay/appointment/[id]/mock-pay capture. Server sums to `paidCents`
  // so the "Take Payment" flow charges only the balance.
  payments?: { amount: number; method: string | null }[];
  items: {
    id: string;
    productName: string;
    technicianId?: string;
    technicianName?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    unitPrice: number;
    quantity: number;
    itemTotal: number;
    status: string;
  }[];
}

export default function AppointmentsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [filterTechnician, setFilterTechnician] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [payingAppointment, setPayingAppointment] = useState<Appointment | null>(null);
  // Free-text search across name / phone / email so front-desk staff can
  // pull up "the Ahmed who called about 3pm" without knowing the date.
  const [searchQuery, setSearchQuery] = useState("");
  // Phase 8 QA: day / week toggle. Week view queries a 7-day range
  // (Mon..Sun of the selected date's week) and columns them by day.
  const [view, setView] = useState<"day" | "week">("day");

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  // Compute the Monday..Sunday range for the selected date's week
  // (locale-agnostic; Mon = start-of-week matches most salon calendars).
  const weekRange = useMemo(() => {
    const d = new Date(selectedDate + "T00:00:00");
    const dow = d.getDay(); // 0=Sun..6=Sat
    const daysBackToMonday = (dow + 6) % 7; // Sun→6, Mon→0, Tue→1, ...
    const start = new Date(d);
    start.setDate(d.getDate() - daysBackToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      startISO: start.toISOString().slice(0, 10),
      endISO: end.toISOString().slice(0, 10),
    };
  }, [selectedDate]);

  const loadAppointments = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);

    try {
      const params = new URLSearchParams({
        orderType: "APPOINTMENT",
        limit: "500",
      });
      if (view === "week") {
        params.set("appointmentDateFrom", weekRange.startISO);
        params.set("appointmentDateTo", weekRange.endISO);
      } else {
        params.set("appointmentDate", selectedDate);
      }

      const res = await fetch(`/api/tenants/${tenantId}/orders?${params}`);
      const data = await res.json();

      if (data.success) {
        setAppointments(data.orders || []);
      }

      // Get currency + default location (needed for the New
      // Appointment modal → availability query is per-location).
      const [settingsRes, locsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/settings`),
        fetch(`/api/tenants/${tenantId}/locations`),
      ]);
      const settingsData = await settingsRes.json();
      if (settingsData.success) {
        setCurrency(settingsData.tenant?.currency || "CAD");
      }
      const locsData = await locsRes.json();
      if (locsData.success && Array.isArray(locsData.locations)) {
        const def =
          locsData.locations.find((l: any) => l.isDefault) ||
          locsData.locations[0];
        if (def) setLocationId(def.id);
      }
    } catch {
      toast.error("Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }, [tenantId, selectedDate, view, weekRange]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const formatPrice = (amount: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(amount / 100);

  const formatTime = (time: string) => {
    if (!time) return "";
    const [h, m] = time.split(":");
    const hour = parseInt(h);
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${h12}:${m} ${ampm}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "NEW":
      case "CONFIRMED":
        return "bg-blue-100 text-blue-700";
      case "PREPARING":
        return "bg-amber-100 text-amber-700";
      case "READY":
      case "COMPLETED":
        return "bg-green-100 text-green-700";
      case "CANCELLED":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const getPaymentColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-green-100 text-green-700";
      case "PENDING":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  // Date navigation
  const changeDate = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  const isToday = selectedDate === new Date().toISOString().split("T")[0];

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    if (isToday) return "Today";
    return d.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
  };

  // Sort appointments by time
  const sortedAppointments = [...appointments].sort((a, b) => {
    return (a.appointmentTime || "").localeCompare(b.appointmentTime || "");
  });

  const filteredAppointments = sortedAppointments.filter((apt) => {
    // Technician filter — unchanged.
    if (filterTechnician && !apt.items.some((item) => item.technicianId === filterTechnician)) {
      return false;
    }
    // Free-text search — matches ANY of name / phone (digits only, so
    // "555-1234" and "5551234" both hit) / email. Empty query = pass.
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const qDigits = q.replace(/\D/g, "");
    const name = (apt.customerName || "").toLowerCase();
    const email = (apt.customerEmail || "").toLowerCase();
    const phoneDigits = (apt.customerPhone || "").replace(/\D/g, "");
    return (
      name.includes(q) ||
      email.includes(q) ||
      (qDigits.length > 0 && phoneDigits.includes(qDigits))
    );
  });

  // Get unique technicians from all appointments
  const technicianNames = new Map<string, string>();
  appointments.forEach((apt) => {
    apt.items.forEach((item) => {
      if (item.technicianId && item.technicianName) {
        technicianNames.set(item.technicianId, item.technicianName);
      }
    });
  });

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filteredAppointments.length} appointment{filteredAppointments.length !== 1 ? "s" : ""} for {formatDateLabel(selectedDate)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* New Appointment — opens a dedicated modal instead of
              detouring through POS (POS is walk-in flow). */}
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white bg-purple-600 hover:bg-purple-700 transition-colors"
          >
            <Icon icon="solar:calendar-add-bold" className="w-5 h-5" />
            <span>New Appointment</span>
          </button>

          {/* Search — name / phone / email. Front-desk staff can pull
              up a customer without knowing the date. Combines with the
              technician filter and the date range. */}
          <div className="relative">
            <Icon
              icon="solar:magnifer-linear"
              className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              type="search"
              placeholder="Search name, phone, email"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm bg-white w-56 focus:outline-none focus:border-purple-400"
            />
          </div>

          {/* Technician filter */}
          {technicianNames.size > 0 && (
            <select
              value={filterTechnician}
              onChange={(e) => setFilterTechnician(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white"
            >
              <option value="">All Staff</option>
              {Array.from(technicianNames.entries()).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}

          {/* Day / Week view toggle */}
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
            <button
              onClick={() => setView("day")}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                view === "day"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setView("week")}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                view === "week"
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Week
            </button>
          </div>

          {/* Date navigation — nav step matches the current view: day
              view steps by 1 day, week view steps by 7. */}
          <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1">
            <button
              onClick={() => changeDate(view === "week" ? -7 : -1)}
              className="p-2 rounded-lg hover:bg-gray-100"
            >
              <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-2 py-1 text-sm font-medium text-gray-700 bg-transparent border-none focus:outline-none"
            />
            <button
              onClick={() => changeDate(view === "week" ? 7 : 1)}
              className="p-2 rounded-lg hover:bg-gray-100"
            >
              <Icon icon="solar:arrow-right-linear" className="w-4 h-4" />
            </button>
          </div>

          {!isToday && (
            <button
              onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
              className="px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* Appointments List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse">
              <div className="flex gap-4">
                <div className="w-16 h-16 bg-gray-200 rounded-xl" />
                <div className="flex-1">
                  <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredAppointments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <Icon icon="solar:calendar-minimalistic-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No appointments</h3>
          <p className="text-gray-500 mb-4">No appointments scheduled for {formatDateLabel(selectedDate)}</p>
          <button
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white bg-purple-600 hover:bg-purple-700 transition-colors"
          >
            <Icon icon="solar:calendar-add-bold" className="w-5 h-5" />
            Create Appointment
          </button>
        </div>
      ) : view === "week" ? (
        <WeekGrid
          appointments={filteredAppointments}
          weekStartISO={weekRange.startISO}
          onDayClick={(iso) => {
            setSelectedDate(iso);
            setView("day");
          }}
          formatPrice={formatPrice}
        />
      ) : (
        <div className="space-y-3">
          {filteredAppointments.map((apt) => (
            <div
              key={apt.id}
              className="bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all overflow-hidden"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    {/* Time block */}
                    <div className="w-16 text-center flex-shrink-0">
                      <p className="text-lg font-bold text-gray-900">
                        {apt.appointmentTime ? formatTime(apt.appointmentTime) : "--:--"}
                      </p>
                    </div>

                    <div>
                      {/* Customer */}
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">
                          {apt.customerName || `Appointment ${apt.orderNumber}`}
                        </h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(apt.status)}`}>
                          {apt.status.replace("_", " ")}
                        </span>
                      </div>

                      {apt.customerPhone && (
                        <p className="text-sm text-gray-500 mb-2">
                          <Icon icon="solar:phone-linear" className="w-3.5 h-3.5 inline mr-1" />
                          {apt.customerPhone}
                        </p>
                      )}

                      {/* Services */}
                      <div className="space-y-1.5 mt-2">
                        {apt.items.map((item) => (
                          <div key={item.id} className="flex items-center gap-3 text-sm">
                            <Icon icon="solar:scissors-linear" className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <span className="text-gray-700">{item.productName}</span>
                            {item.technicianName && (
                              <span className="text-xs text-gray-400">
                                with {item.technicianName}
                              </span>
                            )}
                            {item.scheduledStart && item.scheduledEnd && (
                              <span className="text-xs text-gray-400">
                                {formatTime(new Date(item.scheduledStart).toTimeString().slice(0, 5))}
                                {" - "}
                                {formatTime(new Date(item.scheduledEnd).toTimeString().slice(0, 5))}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold text-gray-900">{formatPrice(apt.total)}</p>
                    {(() => {
                      const paidCents = (apt.payments || []).reduce(
                        (s, p) => s + p.amount,
                        0
                      );
                      const balance = Math.max(0, apt.total - paidCents);
                      const fullyPaid = balance <= 0 || apt.paymentStatus === "COMPLETED";
                      return (
                        <>
                          {paidCents > 0 && !fullyPaid && (
                            <p className="text-xs text-emerald-600 mt-1">
                              Deposit {formatPrice(paidCents)} · Due {formatPrice(balance)}
                            </p>
                          )}
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${getPaymentColor(apt.paymentStatus)}`}>
                            {fullyPaid ? "Paid" : paidCents > 0 ? "Deposit paid" : "Unpaid"}
                          </span>
                          {!fullyPaid && (
                            <button
                              onClick={() => setPayingAppointment(apt)}
                              className="mt-2 block ml-auto text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              Take Payment
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dedicated New Appointment modal — replaces the old detour
          through /dashboard/pos. */}
      {tenantId && (
        <NewAppointmentModal
          tenantId={tenantId}
          locationId={locationId}
          currency={currency}
          isOpen={showNewModal}
          onClose={() => setShowNewModal(false)}
          onCreated={() => {
            setShowNewModal(false);
            loadAppointments();
          }}
        />
      )}

      {/* Take Payment sheet. Server-side computes outstanding = total
          − sum(completed payments), so any deposit already paid via the
          public booking flow is automatically deducted at the counter. */}
      {tenantId && payingAppointment && (
        <TakePaymentModal
          tenantId={tenantId}
          orderId={payingAppointment.id}
          orderNumber={payingAppointment.orderNumber}
          customerName={payingAppointment.customerName}
          currency={currency}
          totalCents={payingAppointment.total}
          paidCents={(payingAppointment.payments || []).reduce(
            (s, p) => s + p.amount,
            0
          )}
          onClose={() => setPayingAppointment(null)}
          onCollected={() => loadAppointments()}
        />
      )}
    </div>
  );
}

// Phase 8 QA: 7-column week grid. Groups appointments by day-of-week,
// shows a compact time-first pill per booking. Click day header → jump
// to Day view for that date.
function WeekGrid({
  appointments,
  weekStartISO,
  onDayClick,
  formatPrice,
}: {
  appointments: Appointment[];
  weekStartISO: string;
  onDayClick: (iso: string) => void;
  formatPrice: (cents: number) => string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartISO + "T00:00:00");
    d.setDate(d.getDate() + i);
    return {
      iso: d.toISOString().slice(0, 10),
      short: d.toLocaleDateString(undefined, { weekday: "short" }),
      num: d.getDate(),
      isToday: d.toDateString() === new Date().toDateString(),
    };
  });

  const byDay = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const iso = new Date(a.appointmentDate).toISOString().slice(0, 10);
    if (!byDay.has(iso)) byDay.set(iso, []);
    byDay.get(iso)!.push(a);
  }
  // Sort each day's rows by appointmentTime ascending.
  byDay.forEach((rows) =>
    rows.sort((a, b) => (a.appointmentTime || "").localeCompare(b.appointmentTime || ""))
  );

  const fmtTime12 = (hhmm: string) => {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const rows = byDay.get(d.iso) || [];
        return (
          <div
            key={d.iso}
            className="bg-white rounded-2xl border border-gray-100 min-h-[240px] flex flex-col"
          >
            <button
              onClick={() => onDayClick(d.iso)}
              className={`p-3 border-b border-gray-100 text-left hover:bg-gray-50 rounded-t-2xl ${
                d.isToday ? "bg-indigo-50" : ""
              }`}
            >
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                {d.short}
              </p>
              <p
                className={`text-lg font-bold ${
                  d.isToday ? "text-indigo-700" : "text-gray-900"
                }`}
              >
                {d.num}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">
                {rows.length} appt{rows.length !== 1 ? "s" : ""}
              </p>
            </button>
            <div className="p-2 space-y-1.5 flex-1 overflow-y-auto">
              {rows.length === 0 ? (
                <p className="text-xs text-gray-300 text-center py-6">—</p>
              ) : (
                rows.map((apt) => (
                  <div
                    key={apt.id}
                    className="text-xs p-2 rounded-lg bg-indigo-50 border border-indigo-100"
                  >
                    <p className="font-semibold text-indigo-900">
                      {fmtTime12(apt.appointmentTime)}
                    </p>
                    <p className="text-gray-800 truncate">
                      {apt.customerName || "Guest"}
                    </p>
                    <p className="text-gray-500 text-[10px] truncate">
                      {apt.items[0]?.productName || ""}
                    </p>
                    <p className="text-gray-600 text-[10px] mt-0.5">
                      {formatPrice(apt.total)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
