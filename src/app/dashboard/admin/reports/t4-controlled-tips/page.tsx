"use client";

// T4 Controlled Tips report — Canadian equivalent of IRS Form 8027.
//
// Every CLOSED tip pool distribution is a controlled tip by CRA
// definition (the employer collected + redistributed the tips). Those
// figures go into T4 Box 14 (employment income) and are subject to
// CPP / EI / income tax withholding at payroll.

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { toast } from "sonner";

interface EmployeeRow {
  membershipId: string;
  employeeName: string;
  email: string | null;
  yearTotal: number;
  monthly: Record<string, number>;
}

interface Report {
  year: number;
  establishment: {
    tenantName?: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    province?: string | null;
    currency: string;
  };
  months: string[];
  summary: {
    totalControlledTipsCents: number;
    employeeCount: number;
    distributionCount: number;
  };
  employees: EmployeeRow[];
  note: string;
}

const yearOptions = () => {
  const now = new Date().getFullYear();
  return [now, now - 1, now - 2, now - 3];
};

export default function T4ControlledTipsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [locationId, setLocationId] = useState<string>("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ year: String(year) });
      if (locationId) qs.set("locationId", locationId);
      const [rRes, lRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/reports/t4-controlled-tips?${qs.toString()}`),
        fetch(`/api/tenants/${tenantId}/locations`),
      ]);
      const [rData, lData] = await Promise.all([rRes.json(), lRes.json()]);
      if (rData.success) setReport(rData);
      if (lData.success) setLocations(lData.locations || []);
    } finally {
      setLoading(false);
    }
  }, [tenantId, year, locationId]);

  useEffect(() => {
    load();
  }, [load]);

  const cur = report?.establishment.currency || "CAD";
  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: cur }).format(
      (cents || 0) / 100
    );

  const shortMonth = (mk: string) => {
    // "2026-01" → "Jan"
    const m = parseInt(mk.slice(-2), 10);
    return [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ][m - 1];
  };

  const downloadCsv = () => {
    if (!report) return;
    const header = [
      "Employee",
      "Email",
      "T4 Box 14 (Year total)",
      ...report.months.map(shortMonth),
    ];
    const body = report.employees.map((e) => [
      e.employeeName,
      e.email || "",
      (e.yearTotal / 100).toFixed(2),
      ...report.months.map((mk) => ((e.monthly[mk] || 0) / 100).toFixed(2)),
    ]);
    const meta = [
      ["T4 Controlled Tips — Canadian employer report"],
      [`Tax year: ${report.year}`],
      [`Establishment: ${report.establishment.tenantName || ""}`],
      [`Location: ${report.establishment.locationName || "All"}`],
      [`Province: ${report.establishment.province || ""}`],
      [`Currency: ${cur}`],
      [`Total employees with controlled tips: ${report.summary.employeeCount}`],
      [
        `Total controlled tips: ${formatPrice(
          report.summary.totalControlledTipsCents
        )}`,
      ],
      [""],
    ];
    const rows = [...meta, header, ...body];
    const csv = rows
      .map((r) =>
        r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `t4-controlled-tips-${report.year}${
      locationId ? "-" + locationId.slice(0, 8) : ""
    }.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  return (
    <div>
      <AdminHeader
        title="T4 Controlled Tips (Canada)"
        subtitle="Per-employee controlled tip totals — feeds T4 Box 14 at year-end"
      />

      <div className="p-6 space-y-6">
        {/* Filters */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100 flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tax year</label>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm"
            >
              {yearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          {locations.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Establishment</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm"
              >
                <option value="">All locations (combined)</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={downloadCsv}
            disabled={!report || loading}
            className="ml-auto px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-2"
          >
            <Icon icon="solar:download-linear" className="w-4 h-4" />
            Export CSV
          </button>
        </div>

        {/* Info banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <Icon icon="solar:info-circle-bold" className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Informational figures only</p>
              <p className="text-xs mt-1">
                Add each employee's yearly total to <strong>T4 Box 14</strong> (employment
                income). Withhold CPP / EI / income tax on these amounts as usual.
                Direct tips (customer → employee, no tip pool) are the employee's own
                reporting responsibility and are NOT included in this report.
              </p>
            </div>
          </div>
        </div>

        {loading || !report ? (
          <div className="bg-white rounded-2xl p-8 border border-gray-100 text-sm text-gray-500">
            Loading…
          </div>
        ) : (
          <>
            {/* Establishment header */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Establishment</p>
                <h2 className="text-lg font-semibold text-gray-900 mt-1">
                  {report.establishment.tenantName}
                  {report.establishment.locationName && (
                    <span className="text-gray-500 font-normal"> · {report.establishment.locationName}</span>
                  )}
                </h2>
                {report.establishment.province && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Province: {report.establishment.province}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-gray-500">Tax year</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{report.year}</p>
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl p-5 border border-gray-100">
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Total controlled tips
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {formatPrice(report.summary.totalControlledTipsCents)}
                </p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-gray-100">
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Employees receiving pool
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {report.summary.employeeCount}
                </p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-gray-100">
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  Pool distributions
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {report.summary.distributionCount}
                </p>
              </div>
            </div>

            {/* Per-employee breakdown */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">By employee — T4 Box 14</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sorted by year total, largest first. Monthly columns cross-check
                  payroll-withholding periods.
                </p>
              </div>
              {report.employees.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">
                  No closed tip pools for this year. Close a pool from
                  <span className="mx-1 font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                    Tip Pools
                  </span>
                  to see distributions here.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="text-left px-5 py-2 sticky left-0 bg-gray-50">
                          Employee
                        </th>
                        <th className="text-right px-3 py-2 sticky left-[220px] bg-gray-50">
                          Year total
                        </th>
                        {report.months.map((mk) => (
                          <th key={mk} className="text-right px-2 py-2 font-medium">
                            {shortMonth(mk)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {report.employees.map((e) => (
                        <tr key={e.membershipId} className="hover:bg-gray-50">
                          <td className="px-5 py-2 sticky left-0 bg-white group-hover:bg-gray-50">
                            <div className="font-medium text-gray-900">
                              {e.employeeName}
                            </div>
                            {e.email && (
                              <div className="text-xs text-gray-500">{e.email}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-900 sticky left-[220px] bg-white">
                            {formatPrice(e.yearTotal)}
                          </td>
                          {report.months.map((mk) => {
                            const v = e.monthly[mk] || 0;
                            return (
                              <td
                                key={mk}
                                className={`px-2 py-2 text-right tabular-nums ${
                                  v === 0 ? "text-gray-300" : "text-gray-700"
                                }`}
                              >
                                {v === 0 ? "—" : formatPrice(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
