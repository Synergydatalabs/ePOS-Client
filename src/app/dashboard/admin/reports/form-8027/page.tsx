"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { Card } from "@/components/ui";
import { toast } from "sonner";

interface Line {
  amount: number;
  label: string;
  detail?: string;
}

interface Report {
  year: number;
  establishment: {
    tenantName?: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    currency: string;
  };
  lines: {
    line1: Line;
    line2: Line;
    line3: Line;
    line4a: Line;
    line4b: Line;
    line4c: Line;
    line5: Line;
    line6: Line;
    line7: Line;
    line8: Line;
  };
}

// Include current year + last 3 so accountants can pull historical
const yearOptions = () => {
  const now = new Date().getFullYear();
  return [now, now - 1, now - 2, now - 3];
};

export default function Form8027Page() {
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
        fetch(`/api/tenants/${tenantId}/reports/form-8027?${qs.toString()}`),
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

  const formatPrice = (cents: number) => {
    const cur = report?.establishment.currency || "USD";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(
      (cents || 0) / 100
    );
  };

  const downloadCsv = () => {
    if (!report) return;
    const rows = [
      ["Form 8027 — Employer's Annual Tip Income Report"],
      [`Tax year: ${report.year}`],
      [`Establishment: ${report.establishment.tenantName || ""}`],
      [`Location: ${report.establishment.locationName || "All"}`],
      [`Address: ${report.establishment.locationAddress || ""}`],
      [`Currency: ${report.establishment.currency}`],
      [""],
      ["Line", "Label", "Amount", "Notes"],
      ...(Object.entries(report.lines) as Array<[string, Line]>).map(
        ([id, l]) => [id.replace("line", ""), l.label, (l.amount / 100).toFixed(2), l.detail || ""]
      ),
    ];
    const csv = rows.map((r) =>
      r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `form-8027-${report.year}${locationId ? "-" + locationId.slice(0, 8) : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  const linesInOrder: Array<{
    id: keyof Report["lines"];
    tone?: "muted" | "highlight" | "warn";
  }> = [
    { id: "line1" },
    { id: "line2" },
    { id: "line3", tone: "muted" },
    { id: "line4a" },
    { id: "line4b" },
    { id: "line4c", tone: "highlight" },
    { id: "line5" },
    { id: "line6" },
    { id: "line7", tone: "warn" },
    { id: "line8" },
  ];

  return (
    <div>
      <AdminHeader
        title="IRS Form 8027"
        subtitle="Annual employer tip income report — US food/beverage establishments"
      />

      <div className="p-6 space-y-6">
        {/* Filters */}
        <div className="card p-4 flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Tax year
            </label>
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
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Establishment
              </label>
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

        {/* Legal note */}
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-sm text-amber-800 flex items-start gap-2">
          <Icon
            icon="solar:info-circle-bold"
            className="w-5 h-5 flex-shrink-0 mt-0.5"
          />
          <div>
            <p className="font-semibold mb-1">Informational figures only</p>
            <p className="text-xs">
              Transcribe these values onto the official IRS Form 8027 (or into
              your tax software). Form 8027 applies to F&amp;B employers with
              &gt; 10 tipped employees on a typical day. Confirm applicability
              and final figures with your accountant — this is not tax advice.
            </p>
          </div>
        </div>

        {/* Report */}
        {loading ? (
          <div className="card p-12 text-center text-gray-400">
            <Icon
              icon="solar:refresh-linear"
              className="w-8 h-8 animate-spin mx-auto mb-2"
            />
            Computing...
          </div>
        ) : !report ? (
          <div className="card p-12 text-center text-gray-400">
            <p>Unable to load report</p>
          </div>
        ) : (
          <>
            <Card>
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  <p className="text-xs uppercase text-gray-500">Establishment</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {report.establishment.tenantName}
                    {report.establishment.locationName && (
                      <span className="text-gray-500"> · {report.establishment.locationName}</span>
                    )}
                  </p>
                  {report.establishment.locationAddress && (
                    <p className="text-xs text-gray-500">
                      {report.establishment.locationAddress}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase text-gray-500">Tax year</p>
                  <p className="text-2xl font-bold text-gray-900">{report.year}</p>
                </div>
              </div>
            </Card>

            <Card>
              <div className="divide-y divide-gray-100">
                {linesInOrder.map(({ id, tone }) => {
                  const line = report.lines[id];
                  const isCount = id === "line8";
                  return (
                    <div
                      key={id}
                      className={`flex items-baseline gap-4 py-3 ${
                        tone === "highlight"
                          ? "bg-indigo-50 -mx-4 px-4 rounded-lg"
                          : tone === "warn" && line.amount > 0
                            ? "bg-amber-50 -mx-4 px-4 rounded-lg"
                            : ""
                      }`}
                    >
                      <div className="w-16 flex-shrink-0">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-mono rounded ${
                            tone === "muted"
                              ? "bg-gray-100 text-gray-500"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          Line {id.replace("line", "")}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm ${
                            tone === "muted" ? "text-gray-500" : "text-gray-900 font-medium"
                          }`}
                        >
                          {line.label}
                        </p>
                        {line.detail && (
                          <p className="text-xs text-gray-500 mt-0.5">{line.detail}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-lg font-bold tabular-nums ${
                            tone === "muted"
                              ? "text-gray-400"
                              : tone === "warn" && line.amount > 0
                                ? "text-amber-700"
                                : "text-gray-900"
                          }`}
                        >
                          {isCount
                            ? line.amount.toLocaleString()
                            : formatPrice(line.amount)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {report.lines.line7.amount > 0 && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
                <p className="font-semibold mb-1">
                  Tip allocation required: {formatPrice(report.lines.line7.amount)}
                </p>
                <p className="text-xs">
                  Reported tips (Line 4c) fall below 8% of gross receipts. The
                  difference must be allocated across directly tipped employees
                  by hours worked, gross receipts, or another IRS-approved
                  method. Work with your accountant to distribute.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
