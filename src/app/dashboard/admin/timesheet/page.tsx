"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { StatCard } from "@/components/ui/Card";

interface Membership {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
}

interface Entry {
  id: string;
  status: "ACTIVE" | "ON_BREAK" | "CLOSED";
  clockedInAt: string;
  clockedOutAt?: string | null;
  totalMinutes?: number | null;
  breakMinutes?: number | null;
  notes?: string | null;
  membership: Membership;
  location?: { name: string } | null;
  breaks: Array<{
    id: string;
    type: string;
    startedAt: string;
    endedAt?: string | null;
    minutes?: number | null;
  }>;
}

interface SummaryRow {
  membership: Membership;
  totalMinutes: number;
  breakMinutes: number;
  shiftCount: number;
  avgShiftMinutes: number;
}

const RANGES = [
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
];

export default function TimesheetPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [range, setRange] = useState(7);
  const [tab, setTab] = useState<"summary" | "entries">("summary");
  const [summary, setSummary] = useState<{
    rows: SummaryRow[];
    summary: {
      totalShifts: number;
      totalMinutes: number;
      totalBreakMinutes: number;
      staffCount: number;
    };
  } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [sumRes, entRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/time-clock/summary?days=${range}`),
        fetch(`/api/tenants/${tenantId}/time-clock?days=${range}`),
      ]);
      const [sumData, entData] = await Promise.all([
        sumRes.json(),
        entRes.json(),
      ]);
      if (sumData.success) setSummary(sumData);
      if (entData.success) setEntries(entData.entries);
    } finally {
      setLoading(false);
    }
  }, [tenantId, range]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <AdminHeader
        title="Timesheet"
        subtitle="Staff hours and shift history for payroll and scheduling"
      />

      <div className="p-6 space-y-6">
        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="Total Hours"
            value={loading ? "-" : formatHours(summary?.summary.totalMinutes || 0)}
            icon="solar:clock-circle-bold"
            iconColor="text-indigo-600"
          />
          <StatCard
            title="Shifts"
            value={loading ? "-" : summary?.summary.totalShifts || 0}
            icon="solar:calendar-mark-bold"
            iconColor="text-teal-600"
          />
          <StatCard
            title="Break Hours"
            value={loading ? "-" : formatHours(summary?.summary.totalBreakMinutes || 0)}
            icon="solar:cup-hot-bold"
            iconColor="text-amber-600"
          />
          <StatCard
            title="Staff Working"
            value={loading ? "-" : summary?.summary.staffCount || 0}
            icon="solar:users-group-rounded-bold"
            iconColor="text-purple-600"
          />
        </div>

        {/* Range + tab */}
        <div className="card p-3 flex items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setRange(r.days)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  range === r.days
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-1">
            {(
              [
                { id: "summary", label: "By Staff" },
                { id: "entries", label: "All Shifts" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {tab === "summary" ? (
          <SummaryTable
            rows={summary?.rows || []}
            loading={loading}
          />
        ) : (
          <EntriesTable entries={entries} loading={loading} />
        )}
      </div>
    </div>
  );
}

function SummaryTable({
  rows,
  loading,
}: {
  rows: SummaryRow[];
  loading: boolean;
}) {
  if (loading) return <Loading />;
  if (rows.length === 0)
    return <Empty message="No closed shifts in this window" />;
  const maxMinutes = rows[0]?.totalMinutes || 1;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Staff</th>
              <th className="text-right px-4 py-3 font-medium">Shifts</th>
              <th className="text-right px-4 py-3 font-medium">Total Hours</th>
              <th className="text-right px-4 py-3 font-medium">Breaks</th>
              <th className="text-right px-4 py-3 font-medium">Avg Shift</th>
              <th className="text-left px-4 py-3 font-medium w-1/4">Distribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.membership.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">
                    {r.membership.firstName
                      ? `${r.membership.firstName} ${r.membership.lastName || ""}`
                      : r.membership.email}
                  </p>
                  <p className="text-xs text-gray-500 capitalize">
                    {r.membership.role?.toLowerCase().replace("_", " ")}
                  </p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.shiftCount}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                  {formatHours(r.totalMinutes)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                  {formatHours(r.breakMinutes)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                  {formatHours(r.avgShiftMinutes)}
                </td>
                <td className="px-4 py-3">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{
                        width: `${Math.round((r.totalMinutes / maxMinutes) * 100)}%`,
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EntriesTable({
  entries,
  loading,
}: {
  entries: Entry[];
  loading: boolean;
}) {
  if (loading) return <Loading />;
  if (entries.length === 0)
    return <Empty message="No shifts in this window" />;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Staff</th>
              <th className="text-left px-4 py-3 font-medium">Location</th>
              <th className="text-left px-4 py-3 font-medium">Clock in</th>
              <th className="text-left px-4 py-3 font-medium">Clock out</th>
              <th className="text-right px-4 py-3 font-medium">Hours</th>
              <th className="text-right px-4 py-3 font-medium">Breaks</th>
              <th className="text-center px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">
                    {e.membership.firstName
                      ? `${e.membership.firstName} ${e.membership.lastName || ""}`
                      : e.membership.email}
                  </p>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {e.location?.name || "—"}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {formatDateTime(e.clockedInAt)}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {e.clockedOutAt ? formatDateTime(e.clockedOutAt) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                  {e.totalMinutes != null ? formatHours(e.totalMinutes) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                  {e.breakMinutes != null ? formatHours(e.breakMinutes) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded-full border ${
                      e.status === "ACTIVE"
                        ? "bg-green-50 text-green-700 border-green-200"
                        : e.status === "ON_BREAK"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-gray-50 text-gray-600 border-gray-200"
                    }`}
                  >
                    {e.status.toLowerCase().replace("_", " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="card p-12 text-center text-gray-400">
      <Icon
        icon="solar:refresh-linear"
        className="w-8 h-8 animate-spin mx-auto mb-2"
      />
      Loading...
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="card p-12 text-center text-gray-400">
      <Icon icon="solar:clock-circle-bold" className="w-12 h-12 mx-auto mb-3" />
      <p className="font-medium mb-1 text-gray-600">{message}</p>
    </div>
  );
}

function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
