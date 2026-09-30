"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { StatCard } from "@/components/ui/Card";

interface Session {
  id: string;
  status: "OPEN" | "CLOSED";
  openingFloat: number;
  closingCount?: number | null;
  expectedCash?: number | null;
  variance?: number | null;
  openedAt: string;
  closedAt?: string | null;
  location?: { name: string } | null;
  terminal?: { name: string } | null;
  openedBy?: { firstName?: string; lastName?: string; email?: string } | null;
  closedBy?: { firstName?: string; lastName?: string; email?: string } | null;
  _count: { movements: number };
}

const RANGES = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

export default function CashDrawerListPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [range, setRange] = useState(30);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const formatPrice = useCallback(
    (cents: number) =>
      new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
        (cents || 0) / 100
      ),
    [currency]
  );

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ days: String(range) });
      if (statusFilter) qs.set("status", statusFilter);
      const [sessRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/cash-drawer?${qs.toString()}`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);
      const [sessData, settingsData] = await Promise.all([
        sessRes.json(),
        settingsRes.json(),
      ]);
      if (sessData.success) setSessions(sessData.sessions);
      if (settingsData.success) setCurrency(settingsData.tenant?.currency || "CAD");
    } finally {
      setLoading(false);
    }
  }, [tenantId, range, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Simple aggregates for the summary strip
  const openCount = sessions.filter((s) => s.status === "OPEN").length;
  const overShortSum = sessions
    .filter((s) => s.status === "CLOSED")
    .reduce((s, x) => s + (x.variance || 0), 0);
  const closedCount = sessions.length - openCount;

  return (
    <div>
      <AdminHeader
        title="Cash Drawer"
        subtitle="Shift-level cash reconciliation across all your registers"
      />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard
            title="Open Drawers"
            value={loading ? "-" : openCount}
            icon="solar:wallet-2-bold"
            iconColor={openCount > 0 ? "text-green-600" : "text-gray-400"}
          />
          <StatCard
            title="Sessions"
            value={loading ? "-" : `${closedCount} closed`}
            icon="solar:archive-check-bold"
            iconColor="text-indigo-600"
          />
          <StatCard
            title={overShortSum >= 0 ? "Net Over" : "Net Short"}
            value={loading ? "-" : formatPrice(Math.abs(overShortSum))}
            icon={overShortSum >= 0 ? "solar:arrow-up-bold" : "solar:arrow-down-bold"}
            iconColor={overShortSum >= 0 ? "text-green-600" : "text-red-600"}
          />
        </div>

        {/* Filters */}
        <div className="card p-3 flex flex-wrap items-center gap-2">
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
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="ml-auto px-3 py-1.5 rounded-lg border border-gray-200 text-sm"
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>

        {/* Sessions table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400">
              <Icon
                icon="solar:refresh-linear"
                className="w-8 h-8 animate-spin mx-auto mb-2"
              />
              Loading...
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Icon
                icon="solar:wallet-2-bold"
                className="w-12 h-12 mx-auto mb-3"
              />
              <p className="font-medium mb-1">No drawer sessions in this window</p>
              <p className="text-sm">
                Open a drawer from the POS to start tracking cash.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Opened</th>
                    <th className="text-left px-4 py-3 font-medium">Location / Register</th>
                    <th className="text-left px-4 py-3 font-medium">Cashier</th>
                    <th className="text-right px-4 py-3 font-medium">Float</th>
                    <th className="text-right px-4 py-3 font-medium">Expected</th>
                    <th className="text-right px-4 py-3 font-medium">Counted</th>
                    <th className="text-right px-4 py-3 font-medium">Over/Short</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="text-gray-900">
                          {new Date(s.openedAt).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(s.openedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {s.location?.name || "—"}
                        {s.terminal?.name && (
                          <span className="block text-xs text-gray-500">
                            {s.terminal.name}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {s.openedBy?.firstName
                          ? `${s.openedBy.firstName} ${s.openedBy.lastName || ""}`
                          : s.openedBy?.email || "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {formatPrice(s.openingFloat)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {s.expectedCash !== null && s.expectedCash !== undefined
                          ? formatPrice(s.expectedCash)
                          : (
                            <span className="text-gray-400">—</span>
                          )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {s.closingCount !== null && s.closingCount !== undefined
                          ? formatPrice(s.closingCount)
                          : (
                            <span className="text-gray-400">—</span>
                          )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums font-medium ${
                          s.variance == null
                            ? "text-gray-400"
                            : s.variance === 0
                              ? "text-gray-600"
                              : s.variance > 0
                                ? "text-green-600"
                                : "text-red-600"
                        }`}
                      >
                        {s.variance == null
                          ? "—"
                          : `${s.variance >= 0 ? "+" : ""}${formatPrice(s.variance)}`}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded-full border ${
                            s.status === "OPEN"
                              ? "bg-green-50 text-green-700 border-green-200"
                              : "bg-gray-50 text-gray-600 border-gray-200"
                          }`}
                        >
                          {s.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        <Link href={`/dashboard/admin/cash-drawer/${s.id}`}>
                          <Icon
                            icon="solar:alt-arrow-right-linear"
                            className="w-4 h-4"
                          />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
