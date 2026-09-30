"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { StatCard } from "@/components/ui/Card";
import { toast } from "sonner";

interface LocationRow {
  locationId: string;
  locationName: string;
  grossReceipts: number;
  taxableSales: number;
  taxCollected: number;
  tax2Collected: number;
  tips: number;
  surcharges: number;
  total: number;
  refunded: number;
  refundedTax: number;
  orderCount: number;
}

interface CategoryRow {
  locationId: string;
  locationName: string;
  categoryId: string;
  categoryName: string;
  ratePercent: number;
  taxableAmount: number;
  taxCollected: number;
}

interface Report {
  period: { start: string; end: string };
  taxLabel: string;
  tax2Label: string;
  locations: LocationRow[];
  categories: CategoryRow[];
  totals: {
    grossReceipts: number;
    taxableSales: number;
    taxCollected: number;
    tax2Collected: number;
    tips: number;
    surcharges: number;
    total: number;
    refunded: number;
    refundedTax: number;
    orderCount: number;
    netTax: number;
  };
}

// Handy pre-built ranges — accountants file monthly/quarterly.
function currentMonth() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
  };
}
function priorMonth() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    end: new Date(now.getFullYear(), now.getMonth(), 0),
  };
}
function currentQuarter() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  return {
    start: new Date(now.getFullYear(), q * 3, 1),
    end: new Date(now.getFullYear(), q * 3 + 3, 0),
  };
}
function currentYear() {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getFullYear(), 11, 31),
  };
}
const toISO = (d: Date) => d.toISOString().slice(0, 10);

export default function SalesTaxPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [currency, setCurrency] = useState("CAD");

  const initial = currentMonth();
  const [startDate, setStartDate] = useState(toISO(initial.start));
  const [endDate, setEndDate] = useState(toISO(initial.end));

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
      const qs = new URLSearchParams({ startDate, endDate });
      if (locationId) qs.set("locationId", locationId);
      const [rRes, lRes, sRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/reports/sales-tax?${qs.toString()}`),
        fetch(`/api/tenants/${tenantId}/locations`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);
      const [rData, lData, sData] = await Promise.all([
        rRes.json(),
        lRes.json(),
        sRes.json(),
      ]);
      if (rData.success) setReport(rData);
      if (lData.success) setLocations(lData.locations || []);
      if (sData.success) setCurrency(sData.tenant?.currency || "CAD");
    } finally {
      setLoading(false);
    }
  }, [tenantId, startDate, endDate, locationId]);

  useEffect(() => {
    load();
  }, [load]);

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
      (cents || 0) / 100
    );

  const setRange = (fn: () => { start: Date; end: Date }) => {
    const r = fn();
    setStartDate(toISO(r.start));
    setEndDate(toISO(r.end));
  };

  const downloadCsv = () => {
    if (!report) return;
    const rows: (string | number)[][] = [
      ["Sales Tax Report"],
      [`Period: ${startDate} to ${endDate}`],
      [`Currency: ${currency}`],
      [""],
      ["--- Summary by Location ---"],
      [
        "Location",
        "Orders",
        "Gross Receipts",
        "Taxable Sales",
        `${report.taxLabel} Collected`,
        `${report.tax2Label} Collected`,
        "Tips",
        "Surcharges",
        "Total",
        "Refunded",
        "Refunded Tax",
        "Net Tax",
      ],
      ...report.locations.map((l) => [
        l.locationName,
        l.orderCount,
        (l.grossReceipts / 100).toFixed(2),
        (l.taxableSales / 100).toFixed(2),
        (l.taxCollected / 100).toFixed(2),
        (l.tax2Collected / 100).toFixed(2),
        (l.tips / 100).toFixed(2),
        (l.surcharges / 100).toFixed(2),
        (l.total / 100).toFixed(2),
        (l.refunded / 100).toFixed(2),
        (l.refundedTax / 100).toFixed(2),
        ((l.taxCollected - l.refundedTax) / 100).toFixed(2),
      ]),
      [""],
      ["--- Breakdown by Location × Category ---"],
      [
        "Location",
        "Tax Category",
        "Rate %",
        "Taxable Amount",
        "Tax Collected",
      ],
      ...report.categories.map((c) => [
        c.locationName,
        c.categoryName,
        c.ratePercent.toFixed(2),
        (c.taxableAmount / 100).toFixed(2),
        (c.taxCollected / 100).toFixed(2),
      ]),
      [""],
      ["--- Grand Totals ---"],
      ["Orders", report.totals.orderCount],
      ["Gross Receipts", (report.totals.grossReceipts / 100).toFixed(2)],
      ["Taxable Sales", (report.totals.taxableSales / 100).toFixed(2)],
      [`${report.taxLabel} Collected`, (report.totals.taxCollected / 100).toFixed(2)],
      [`${report.tax2Label} Collected`, (report.totals.tax2Collected / 100).toFixed(2)],
      ["Refunded", (report.totals.refunded / 100).toFixed(2)],
      ["Refunded Tax", (report.totals.refundedTax / 100).toFixed(2)],
      ["Net Tax Owed", (report.totals.netTax / 100).toFixed(2)],
    ];
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-tax-${startDate}-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  return (
    <div>
      <AdminHeader
        title="Sales Tax Report"
        subtitle="Per-location + per-category breakdown for GST/HST, state sales tax, and VAT filings"
      />

      <div className="p-6 space-y-6">
        {/* Range chips */}
        <div className="card p-4 flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            {[
              { label: "This Month", fn: currentMonth },
              { label: "Last Month", fn: priorMonth },
              { label: "This Quarter", fn: currentQuarter },
              { label: "This Year", fn: currentYear },
            ].map((r) => (
              <button
                key={r.label}
                onClick={() => setRange(r.fn)}
                className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                {r.label}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              From
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              To
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm"
            />
          </div>
          {locations.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Location
              </label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm"
              >
                <option value="">All locations</option>
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
            <p>Unable to load</p>
          </div>
        ) : (
          <>
            {/* Grand totals */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard
                title="Gross Receipts"
                value={formatPrice(report.totals.grossReceipts)}
                icon="solar:wallet-money-bold"
                iconColor="text-green-600"
              />
              <StatCard
                title={`${report.taxLabel} Collected`}
                value={formatPrice(report.totals.taxCollected)}
                icon="solar:tag-price-bold"
                iconColor="text-indigo-600"
              />
              <StatCard
                title="Refunded Tax"
                value={formatPrice(report.totals.refundedTax)}
                icon="solar:refresh-circle-bold"
                iconColor="text-amber-600"
              />
              <StatCard
                title="Net Tax Owed"
                value={formatPrice(report.totals.netTax)}
                icon="solar:calculator-bold"
                iconColor={report.totals.netTax >= 0 ? "text-red-600" : "text-gray-600"}
              />
            </div>

            {/* Location summary */}
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">
                  Summary by Location
                </h3>
                <p className="text-xs text-gray-500">
                  One row per store — matches how US state and CA GST/HST returns are filed
                </p>
              </div>
              {report.locations.length === 0 ? (
                <p className="p-6 text-sm text-gray-500 italic">
                  No orders in this window.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium">Location</th>
                        <th className="text-right px-4 py-3 font-medium">Orders</th>
                        <th className="text-right px-4 py-3 font-medium">Gross</th>
                        <th className="text-right px-4 py-3 font-medium">Taxable</th>
                        <th className="text-right px-4 py-3 font-medium">{report.taxLabel}</th>
                        <th className="text-right px-4 py-3 font-medium">{report.tax2Label}</th>
                        <th className="text-right px-4 py-3 font-medium">Refunded Tax</th>
                        <th className="text-right px-4 py-3 font-medium">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {report.locations.map((l) => (
                        <tr key={l.locationId} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {l.locationName}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {l.orderCount}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                            {formatPrice(l.grossReceipts)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                            {formatPrice(l.taxableSales)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                            {formatPrice(l.taxCollected)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                            {formatPrice(l.tax2Collected)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                            {l.refundedTax > 0 ? `-${formatPrice(l.refundedTax)}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900">
                            {formatPrice(l.taxCollected - l.refundedTax)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Category breakdown */}
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">
                  Breakdown by Tax Category
                </h3>
                <p className="text-xs text-gray-500">
                  Needed for GST/HST returns that split standard-rated from zero-rated items
                </p>
              </div>
              {report.categories.length === 0 ? (
                <p className="p-6 text-sm text-gray-500 italic">
                  No category-tagged sales in this window.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium">Location</th>
                        <th className="text-left px-4 py-3 font-medium">Category</th>
                        <th className="text-right px-4 py-3 font-medium">Rate</th>
                        <th className="text-right px-4 py-3 font-medium">Taxable</th>
                        <th className="text-right px-4 py-3 font-medium">Tax Collected</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {report.categories.map((c) => (
                        <tr
                          key={`${c.locationId}|${c.categoryId}`}
                          className="hover:bg-gray-50"
                        >
                          <td className="px-4 py-3 text-gray-700">
                            {c.locationName}
                          </td>
                          <td className="px-4 py-3 text-gray-900 font-medium">
                            {c.categoryName}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                            {c.ratePercent.toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                            {formatPrice(c.taxableAmount)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                            {formatPrice(c.taxCollected)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-800 flex items-start gap-2">
              <Icon
                icon="solar:info-circle-bold"
                className="w-4 h-4 flex-shrink-0 mt-0.5"
              />
              <div>
                <p className="font-semibold mb-1">Filing notes</p>
                <p>
                  Refunded tax is prorated (refund amount ÷ order total) × order tax.
                  Tips and card surcharges are excluded from taxable sales. Gift-card
                  issuance is excluded — tax hits on redemption. Verify final figures
                  with your accountant before filing.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
