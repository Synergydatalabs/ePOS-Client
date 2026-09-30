"use client";

// Dashboard — role-aware.
//
// Staff (POS_STAFF / KITCHEN_STAFF): compact "my in-progress orders"
// board + one big "New Order" CTA. No revenue, no staff-management
// quick actions.
//
// Manager+ (POS_MANAGER / POS_ADMIN / TENANT_OWNER): full KPIs
// (today's orders, revenue, pending payments), in-progress board
// grouped by status, recent-orders list, top-5 items today. The rich
// insight surface the QA feedback asked for.
//
// Data comes from ONE endpoint (/api/tenants/[id]/dashboard) which is
// itself role-aware: staff auth = orders scoped to `createdById=mine`,
// manager+ = full location.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { useLocation } from "@/contexts/LocationContext";

// Force request-time rendering — the parent /dashboard layout wraps
// children in LocationProvider (a client-only React context), which
// static prerender can't materialize. Every page under this route
// depends on live tenant state anyway; nothing here would benefit
// from prerender. AFTER imports (standard ESM order).
export const dynamic = "force-dynamic";

// Kept in sync with the endpoint response.
interface RecentOrder {
  id: string;
  orderNumber: string;
  displayNumber: number;
  orderType: string;
  status: string;
  paymentStatus: string;
  total: number;
  currency: string;
  customerName: string | null;
  tableNumber: string | null;
  createdAt: string;
  locationName: string | null;
  createdByName: string | null;
}

interface UpcomingAppointment {
  id: string;
  orderNumber: string;
  displayNumber: number;
  status: string;
  paymentStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  appointmentDate: string;
  appointmentTime: string | null;
  serviceNames: string[];
  technicianNames: string[];
  total: number;
  currency: string;
}

interface DashboardData {
  scope: { role: string; locationId: string | null; mine: boolean };
  businessType?: string;
  todayOrders: number;
  todayRevenueCents: number;
  currency: string;
  pendingPaymentOrders: number;
  inProgress: {
    NEW: number;
    CONFIRMED: number;
    PREPARING: number;
    READY: number;
    PENDING_PAYMENT: number;
    total: number;
  };
  upcomingAppointments?: UpcomingAppointment[];
  recentOrders: RecentOrder[];
  topItems: { productName: string; qty: number; revenueCents: number }[];
}

// Roles that can see revenue + staff-management + settings quick actions.
// Matches the nav filter in dashboard/layout.tsx — keep the two in sync.
const MANAGER_ROLES = new Set(["TENANT_OWNER", "POS_ADMIN", "POS_MANAGER"]);

export default function DashboardPage() {
  const { activeLocationId } = useLocation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [businessType, setBusinessType] = useState("restaurant");

  const isSalon = businessType === "salon";
  const isCab = businessType === "cab";

  useEffect(() => {
    async function fetchDashboard() {
      const tenantId = localStorage.getItem("tap_active_tenant");
      if (!tenantId) {
        setLoading(false);
        return;
      }
      try {
        const [settingsRes, dashRes] = await Promise.all([
          fetch(`/api/tenants/${tenantId}/settings`),
          fetch(
            `/api/tenants/${tenantId}/dashboard${
              activeLocationId ? `?locationId=${activeLocationId}` : ""
            }`
          ),
        ]);
        const settingsJson = await settingsRes.json();
        if (settingsJson.success && settingsJson.tenant?.businessType) {
          setBusinessType(settingsJson.tenant.businessType);
        }
        const dashJson = await dashRes.json();
        if (dashJson.success) {
          setData(dashJson);
        }
      } catch (err) {
        console.error("Failed to fetch dashboard:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchDashboard();
  }, [activeLocationId]);

  const money = useMemo(() => {
    const currency = data?.currency || "CAD";
    return (cents: number) =>
      new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
        cents / 100
      );
  }, [data?.currency]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  const isManager = data ? MANAGER_ROLES.has(data.scope.role) : false;
  const isStaffOnly = !isManager;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isStaffOnly ? "My Shift" : "Dashboard"}
          </h1>
          <p className="text-gray-500">
            {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        {isCab ? (
          <Link
            href="/dashboard/admin/dispatch"
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all"
          >
            <Icon icon="solar:radar-2-bold" className="w-5 h-5" />
            <span>Open Dispatch</span>
          </Link>
        ) : (
          <Link
            href="/dashboard/pos"
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all"
          >
            <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
            <span>{isStaffOnly ? "New Order" : "Open POS"}</span>
          </Link>
        )}
      </div>

      {/* KPI cards — manager+ only. Revenue and staff-management KPIs
          shouldn't be visible to floor staff. */}
      {isManager && data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard
            label="Today's Orders"
            value={data.todayOrders.toString()}
            icon="solar:document-text-bold"
            tone="blue"
          />
          <KpiCard
            label="Today's Revenue"
            value={money(data.todayRevenueCents)}
            icon="solar:dollar-bold"
            tone="green"
          />
          <KpiCard
            label="In Progress"
            value={data.inProgress.total.toString()}
            icon="solar:chef-hat-bold"
            tone="indigo"
          />
          <KpiCard
            label="Pending Payment"
            value={data.pendingPaymentOrders.toString()}
            icon="solar:clock-circle-bold"
            tone="amber"
          />
        </div>
      )}

      {/* Staff — a single "My open orders" KPI. Clear and boring. */}
      {isStaffOnly && data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KpiCard
            label="My Open Orders"
            value={data.inProgress.total.toString()}
            icon="solar:chef-hat-bold"
            tone="indigo"
          />
          <KpiCard
            label="My Orders Today"
            value={data.todayOrders.toString()}
            icon="solar:document-text-bold"
            tone="blue"
          />
        </div>
      )}

      {/* Upcoming appointments — salon only. Renders in place of the
          restaurant Kitchen Board. Includes check-in button per row. */}
      {isSalon && data && (
        <UpcomingAppointmentsCard
          appointments={data.upcomingAppointments || []}
          tenantId={typeof window !== "undefined" ? localStorage.getItem("tap_active_tenant") : null}
          currency={data.currency}
          isManager={isManager}
          onChanged={() => {
            // Force a refetch by bumping the location dep. Simple full
            // reload keeps the code path trivial and gets fresh KPIs
            // (today's count moves after a check-in).
            if (typeof window !== "undefined") window.location.reload();
          }}
        />
      )}

      {/* In-progress board — RESTAURANT/RETAIL/etc only. Hidden for
          salon (which uses the appointments panel above instead). */}
      {!isSalon && data && data.inProgress.total > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {isStaffOnly ? "My Orders in Progress" : "Kitchen Board"}
            </h2>
            <Link
              href="/dashboard/kitchen"
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Open Kitchen Display
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <BucketTile
              label="New"
              count={data.inProgress.NEW}
              tone="blue"
              icon="solar:inbox-bold"
            />
            <BucketTile
              label="Confirmed"
              count={data.inProgress.CONFIRMED}
              tone="indigo"
              icon="solar:check-circle-bold"
            />
            <BucketTile
              label="Preparing"
              count={data.inProgress.PREPARING}
              tone="amber"
              icon="solar:chef-hat-bold"
            />
            <BucketTile
              label="Ready"
              count={data.inProgress.READY}
              tone="green"
              icon="solar:bell-bold"
            />
            <BucketTile
              label="Awaiting Payment"
              count={data.inProgress.PENDING_PAYMENT}
              tone="rose"
              icon="solar:card-bold"
            />
          </div>
        </div>
      )}

      {/* Quick Actions — role-filtered. Staff sees POS + Kitchen only.
          Managers get the fuller strip. */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickAction
            href="/dashboard/pos"
            icon="solar:cash-out-bold"
            label={isStaffOnly ? "Take Order" : "Open POS"}
            tone="indigo"
          />
          {/* Kitchen tile — hidden for salon (no food prep flow). */}
          {!isSalon && (
            <QuickAction
              href="/dashboard/kitchen"
              icon="solar:chef-hat-bold"
              label="Kitchen"
              tone="amber"
            />
          )}
          {/* Appointments quick action — salon only, replaces Kitchen. */}
          {isSalon && (
            <QuickAction
              href="/dashboard/appointments"
              icon="solar:calendar-bold"
              label="Appointments"
              tone="purple"
            />
          )}
          {isManager && (
            <>
              {/* Appointments tile for salon already rendered above as
                  the Kitchen replacement — don't double it up. */}
              {!isSalon && (
                <QuickAction
                  href="/dashboard/display"
                  icon="solar:monitor-bold"
                  label="Customer Display"
                  tone="purple"
                  newTab
                />
              )}
              <QuickAction
                href="/dashboard/settings"
                icon="solar:settings-bold"
                label="Settings"
                tone="gray"
              />
            </>
          )}
        </div>
      </div>

      {/* Recent Orders — the "what's happening right now" list. Both roles
          see this; staff sees only their own rows. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {isStaffOnly ? "My Recent Orders" : "Recent Orders"}
            </h2>
            <Link
              href="/dashboard/pos/orders"
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              View All
            </Link>
          </div>
        </div>

        {data && data.recentOrders.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {data.recentOrders.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-gray-700">
                      #{o.displayNumber}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 truncate">
                        {o.customerName ||
                          (o.tableNumber ? `Table ${o.tableNumber}` : o.orderNumber)}
                      </span>
                      <span className="text-xs text-gray-500">· {o.orderType.replace("_", " ")}</span>
                      {isManager && o.createdByName && (
                        <span className="text-xs text-gray-400">
                          · by {o.createdByName}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(o.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <StatusBadge status={o.status} />
                  {o.paymentStatus !== "COMPLETED" && (
                    <PaymentBadge status={o.paymentStatus} />
                  )}
                  {isManager && (
                    <span className="font-semibold text-gray-900 min-w-[80px] text-right">
                      {money(o.total)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center">
            <Icon
              icon="solar:cart-large-2-linear"
              className="w-12 h-12 text-gray-300 mx-auto mb-4"
            />
            <p className="text-gray-500">
              {isStaffOnly
                ? "You haven't taken any orders yet today."
                : "No orders yet today."}
            </p>
            <Link
              href="/dashboard/pos"
              className="inline-flex items-center gap-2 mt-4 text-indigo-600 hover:text-indigo-700 font-medium"
            >
              <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
              Open POS
            </Link>
          </div>
        )}
      </div>

      {/* Top items today — manager+ only. Useful for prep planning,
          not something a floor staff needs on their board. */}
      {isManager && data && data.topItems.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Top Items Today
          </h2>
          <div className="space-y-2">
            {data.topItems.map((t, i) => (
              <div
                key={t.productName}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-semibold text-gray-400 w-5">
                    {i + 1}
                  </span>
                  <span className="text-sm text-gray-900 truncate">
                    {t.productName}
                  </span>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className="text-xs text-gray-500">
                    {t.qty} sold
                  </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {money(t.revenueCents)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// Small presentational primitives — kept in this file since they're
// dashboard-specific and not needed elsewhere.
// -------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: string;
  tone: "blue" | "green" | "amber" | "indigo";
}) {
  const bg = {
    blue: "bg-blue-100 text-blue-600",
    green: "bg-green-100 text-green-600",
    amber: "bg-amber-100 text-amber-600",
    indigo: "bg-indigo-100 text-indigo-600",
  }[tone];
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-500 text-sm">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${bg}`}>
          <Icon icon={icon} className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}

function BucketTile({
  label,
  count,
  tone,
  icon,
}: {
  label: string;
  count: number;
  tone: "blue" | "indigo" | "amber" | "green" | "rose";
  icon: string;
}) {
  const bg = {
    blue: "bg-blue-50 text-blue-700",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-green-50 text-green-700",
    rose: "bg-rose-50 text-rose-700",
  }[tone];
  const empty = count === 0;
  return (
    <div
      className={`rounded-xl p-4 text-center ${
        empty ? "bg-gray-50 text-gray-400" : bg
      }`}
    >
      <Icon icon={icon} className="w-6 h-6 mx-auto mb-2" />
      <p className={`text-3xl font-bold ${empty ? "text-gray-300" : ""}`}>
        {count}
      </p>
      <p className={`text-xs mt-1 font-medium ${empty ? "text-gray-400" : "opacity-80"}`}>
        {label}
      </p>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  label,
  tone,
  newTab,
}: {
  href: string;
  icon: string;
  label: string;
  tone: "indigo" | "amber" | "purple" | "blue" | "gray";
  // Open in a new browser tab. Used for second-monitor surfaces (Customer
  // Display) so the operator's main POS view isn't disturbed.
  newTab?: boolean;
}) {
  const bg = {
    indigo: "bg-indigo-50 hover:bg-indigo-100 text-indigo-700",
    amber: "bg-amber-50 hover:bg-amber-100 text-amber-700",
    purple: "bg-purple-50 hover:bg-purple-100 text-purple-700",
    blue: "bg-blue-50 hover:bg-blue-100 text-blue-700",
    gray: "bg-gray-50 hover:bg-gray-100 text-gray-700",
  }[tone];
  const className = `flex flex-col items-center gap-2 p-4 rounded-xl transition-colors ${bg}`;
  if (newTab) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        <Icon icon={icon} className="w-8 h-8" />
        <span className="text-sm font-medium">{label}</span>
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      <Icon icon={icon} className="w-8 h-8" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING_PAYMENT: { bg: "bg-rose-100", text: "text-rose-700", label: "Awaiting payment" },
  NEW:             { bg: "bg-blue-100", text: "text-blue-700", label: "New" },
  CONFIRMED:       { bg: "bg-indigo-100", text: "text-indigo-700", label: "Confirmed" },
  PREPARING:       { bg: "bg-amber-100", text: "text-amber-700", label: "Preparing" },
  READY:           { bg: "bg-green-100", text: "text-green-700", label: "Ready" },
  SERVED:          { bg: "bg-emerald-100", text: "text-emerald-700", label: "Served" },
  PICKED_UP:       { bg: "bg-emerald-100", text: "text-emerald-700", label: "Picked up" },
  DELIVERED:       { bg: "bg-emerald-100", text: "text-emerald-700", label: "Delivered" },
  COMPLETED:       { bg: "bg-gray-100", text: "text-gray-700", label: "Completed" },
  CANCELLED:       { bg: "bg-gray-100", text: "text-gray-500", label: "Cancelled" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? {
    bg: "bg-gray-100",
    text: "text-gray-700",
    label: status.replace("_", " "),
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

const PAYMENT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:    { bg: "bg-amber-100", text: "text-amber-800", label: "Unpaid" },
  PROCESSING: { bg: "bg-blue-100",  text: "text-blue-800",  label: "Processing" },
  FAILED:     { bg: "bg-red-100",   text: "text-red-800",   label: "Payment failed" },
  REFUNDED:   { bg: "bg-gray-100",  text: "text-gray-700",  label: "Refunded" },
  PARTIALLY_REFUNDED: { bg: "bg-gray-100", text: "text-gray-700", label: "Partial refund" },
};

function PaymentBadge({ status }: { status: string }) {
  const s = PAYMENT_STYLES[status];
  if (!s) return null;
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ------------------------------------------------------------------------
// Upcoming appointments — salon replacement for the Kitchen Board.
// Renders today + next 2 days grouped by day, with a Check In button
// that flips the order NEW → CONFIRMED via the standard order PUT.
// ------------------------------------------------------------------------
function UpcomingAppointmentsCard({
  appointments,
  tenantId,
  currency,
  isManager,
  onChanged,
}: {
  appointments: UpcomingAppointment[];
  tenantId: string | null;
  currency: string;
  isManager: boolean;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const money = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);

  const checkIn = async (id: string) => {
    if (!tenantId || busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CONFIRMED" }),
      });
      if (!res.ok) {
        console.error("Check-in failed", await res.text().catch(() => ""));
        return;
      }
      onChanged();
    } catch (err) {
      console.error("Check-in error", err);
    } finally {
      setBusyId(null);
    }
  };

  // Group by yyyy-mm-dd for readable day headers.
  const byDay = new Map<string, UpcomingAppointment[]>();
  for (const a of appointments) {
    const key = new Date(a.appointmentDate).toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(a);
  }
  const days = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));

  const todayIso = new Date().toISOString().slice(0, 10);
  const dayLabel = (iso: string) => {
    if (iso === todayIso) return "Today";
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (iso === tomorrow.toISOString().slice(0, 10)) return "Tomorrow";
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  };

  const fmtTime = (hhmm: string | null): string => {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Upcoming Appointments</h2>
        <Link
          href="/dashboard/appointments"
          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
        >
          Open Appointments
        </Link>
      </div>

      {appointments.length === 0 ? (
        <div className="text-center py-8">
          <Icon
            icon="solar:calendar-minimalistic-linear"
            className="w-12 h-12 text-gray-300 mx-auto mb-3"
          />
          <p className="text-gray-500 text-sm">
            No upcoming appointments in the next 3 days.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {days.map(([iso, rows]) => (
            <div key={iso}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {dayLabel(iso)} · {rows.length} appointment{rows.length !== 1 ? "s" : ""}
              </p>
              <div className="space-y-2">
                {rows.map((a) => {
                  const status = STATUS_STYLES[a.status];
                  const canCheckIn = a.status === "NEW";
                  return (
                    <div
                      key={a.id}
                      className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
                    >
                      <div className="w-16 flex-shrink-0 text-center">
                        <p className="text-sm font-bold text-gray-900">
                          {fmtTime(a.appointmentTime)}
                        </p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-gray-900 truncate">
                            {a.customerName || "Guest"}
                          </p>
                          {status && (
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.bg} ${status.text}`}
                            >
                              {status.label}
                            </span>
                          )}
                          {a.paymentStatus !== "COMPLETED" && (
                            <PaymentBadge status={a.paymentStatus} />
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate">
                          {a.serviceNames.join(", ") || "No services"}
                          {a.technicianNames.length > 0 && (
                            <>
                              {" "}· with {a.technicianNames.join(", ")}
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isManager && (
                          <span className="text-sm font-semibold text-gray-900 min-w-[70px] text-right">
                            {money(a.total)}
                          </span>
                        )}
                        {canCheckIn ? (
                          <button
                            onClick={() => checkIn(a.id)}
                            disabled={busyId === a.id}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {busyId === a.id ? "…" : "Check In"}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400 min-w-[70px] text-right">
                            {a.status === "CONFIRMED" ? "Checked in" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
