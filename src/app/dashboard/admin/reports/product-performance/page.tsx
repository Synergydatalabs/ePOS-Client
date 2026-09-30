"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { StatCard } from "@/components/ui/Card";

interface ProductRow {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  imageUrl?: string | null;
  category?: { id: string; name: string } | null;
  basePrice: number;
  costPrice: number;
  trackInventory: boolean;
  unitsSold: number;
  orderCount: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  avgPrice: number;
  velocity: number;
  lastSoldAt: string | null;
  currentStock: number | null;
  daysOfStock: number | null;
}

interface ReportData {
  windowDays: number;
  summary: {
    totalProducts: number;
    activeProducts: number;
    deadCount: number;
    slowCount: number;
    totalUnits: number;
    totalRevenue: number;
    totalProfit: number;
    avgVelocity: number;
    topSellerName: string | null;
    topSellerRevenue: number;
  };
  products: ProductRow[];
  topByRevenue: ProductRow[];
  topByUnits: ProductRow[];
  slowMovers: ProductRow[];
  deadStock: ProductRow[];
}

type SortKey =
  | "revenue"
  | "unitsSold"
  | "profit"
  | "margin"
  | "velocity"
  | "daysOfStock";
type ViewTab = "all" | "top" | "slow" | "dead";

const RANGES: Array<{ id: number; label: string }> = [
  { id: 7, label: "7 days" },
  { id: 30, label: "30 days" },
  { id: 60, label: "60 days" },
  { id: 90, label: "90 days" },
];

export default function ProductPerformancePage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");
  const [range, setRange] = useState(30);
  const [tab, setTab] = useState<ViewTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

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
      const [rptRes, settingsRes] = await Promise.all([
        fetch(
          `/api/tenants/${tenantId}/reports/product-performance?days=${range}`
        ),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);
      const [rptData, settingsData] = await Promise.all([
        rptRes.json(),
        settingsRes.json(),
      ]);
      if (rptData.success) setData(rptData);
      if (settingsData.success)
        setCurrency(settingsData.tenant?.currency || "CAD");
    } finally {
      setLoading(false);
    }
  }, [tenantId, range]);

  useEffect(() => {
    load();
  }, [load]);

  // Which slice of the report we're rendering — filtered by tab + search
  const shownRows = useMemo(() => {
    if (!data) return [];
    const source =
      tab === "top"
        ? data.topByRevenue
        : tab === "slow"
          ? data.slowMovers
          : tab === "dead"
            ? data.deadStock
            : data.products;
    const filtered = search
      ? source.filter(
          (r) =>
            r.name.toLowerCase().includes(search.toLowerCase()) ||
            r.sku?.toLowerCase().includes(search.toLowerCase()) ||
            r.category?.name.toLowerCase().includes(search.toLowerCase())
        )
      : source;
    const sorted = [...filtered].sort((a, b) => {
      // Null-safe numeric comparator — undefined/null slot to the bottom
      // regardless of direction so they don't clutter the primary view.
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return sorted;
  }, [data, tab, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div>
      <AdminHeader
        title="Product Performance"
        subtitle="Top sellers, slow movers, and stock velocity"
      />

      <div className="p-6 space-y-6">
        {/* Date range chips */}
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r.id
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="Total Revenue"
            value={loading ? "-" : formatPrice(data?.summary.totalRevenue || 0)}
            icon="solar:wallet-money-bold"
            iconColor="text-green-600"
          />
          <StatCard
            title="Units Sold"
            value={loading ? "-" : (data?.summary.totalUnits || 0).toLocaleString()}
            icon="solar:box-bold"
            iconColor="text-indigo-600"
          />
          <StatCard
            title="Top Seller"
            value={loading ? "-" : data?.summary.topSellerName || "—"}
            icon="solar:crown-bold"
            iconColor="text-amber-600"
          />
          <StatCard
            title="Dead Stock"
            value={loading ? "-" : data?.summary.deadCount || 0}
            icon="solar:sleeping-bold"
            iconColor="text-red-600"
          />
        </div>

        {/* Tab strip + search */}
        <div className="card p-1 flex flex-col md:flex-row md:items-center gap-2">
          <div className="flex gap-1 flex-1">
            {(
              [
                { id: "all", label: "All", count: data?.products.length },
                { id: "top", label: "Top Sellers", count: data?.topByRevenue.length },
                {
                  id: "slow",
                  label: "Slow Movers",
                  count: data?.slowMovers.length,
                  tone: "amber",
                },
                {
                  id: "dead",
                  label: "Dead Stock",
                  count: data?.deadStock.length,
                  tone: "red",
                },
              ] as Array<{
                id: ViewTab;
                label: string;
                count?: number;
                tone?: string;
              }>
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 md:flex-initial px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-indigo-600 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                      tab === t.id
                        ? "bg-white/20"
                        : t.tone === "red"
                          ? "bg-red-100 text-red-700"
                          : t.tone === "amber"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative md:w-64 md:ml-2">
            <Icon
              icon="solar:magnifer-linear"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-sm"
            />
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400">
              <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto mb-2" />
              Loading...
            </div>
          ) : shownRows.length === 0 ? (
            <EmptyState tab={tab} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Product</th>
                    <SortableTh
                      label="Units"
                      keyName="unitsSold"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                    />
                    <SortableTh
                      label="Revenue"
                      keyName="revenue"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                    />
                    <SortableTh
                      label="Profit"
                      keyName="profit"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                    />
                    <SortableTh
                      label="Margin"
                      keyName="margin"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                    />
                    <SortableTh
                      label="Velocity"
                      keyName="velocity"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                    />
                    <SortableTh
                      label="Days Left"
                      keyName="daysOfStock"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                    />
                    <th className="text-left px-4 py-3 font-medium">Last Sold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shownRows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {r.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={r.imageUrl}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <Icon
                                icon="solar:box-bold"
                                className="w-4 h-4 text-gray-400"
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">{r.name}</p>
                            <p className="text-xs text-gray-500">
                              {r.category?.name || "Uncategorised"}
                              {r.sku ? ` · ${r.sku}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.unitsSold.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                        {formatPrice(r.revenue)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          r.profit >= 0 ? "text-gray-700" : "text-red-600"
                        }`}
                      >
                        {r.costPrice === 0 && r.unitsSold > 0 ? (
                          <span
                            className="text-amber-600 cursor-help"
                            title="No cost price set — profit shown = revenue"
                          >
                            {formatPrice(r.profit)}*
                          </span>
                        ) : (
                          formatPrice(r.profit)
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.unitsSold > 0 ? `${r.margin.toFixed(0)}%` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {r.velocity > 0
                          ? `${r.velocity.toFixed(2)}/day`
                          : (
                            <span className="text-gray-400">—</span>
                          )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.daysOfStock === null ? (
                          <span className="text-gray-400" title={r.trackInventory ? "No stock data" : "Not tracked"}>
                            —
                          </span>
                        ) : (
                          <span
                            className={
                              r.daysOfStock < 7
                                ? "text-red-600 font-medium"
                                : r.daysOfStock < 14
                                  ? "text-amber-600"
                                  : "text-gray-600"
                            }
                          >
                            {r.daysOfStock}d
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {r.lastSoldAt
                          ? new Date(r.lastSoldAt).toLocaleDateString()
                          : (
                            <span className="text-gray-400">Never</span>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footnote explaining the * marker + slow-mover definition */}
        {!loading && data && (
          <p className="text-xs text-gray-400">
            * Cost price not set — profit shown equals revenue. Set cost prices
            on individual products for accurate margin. Slow movers = products
            selling below 15% of the average velocity ({data.summary.avgVelocity.toFixed(2)}/day).
          </p>
        )}
      </div>
    </div>
  );
}

function SortableTh({
  label,
  keyName,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string;
  keyName: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  const active = sortKey === keyName;
  return (
    <th className="text-right px-4 py-3 font-medium">
      <button
        onClick={() => onClick(keyName)}
        className={`inline-flex items-center gap-1 hover:text-gray-700 ${
          active ? "text-indigo-600" : ""
        }`}
      >
        {label}
        <Icon
          icon={
            active
              ? sortDir === "desc"
                ? "solar:sort-from-top-to-bottom-linear"
                : "solar:sort-from-bottom-to-top-linear"
              : "solar:sort-vertical-linear"
          }
          className="w-3.5 h-3.5"
        />
      </button>
    </th>
  );
}

function EmptyState({ tab }: { tab: ViewTab }) {
  const meta = {
    all: { icon: "solar:box-bold", title: "No products yet", sub: "Add products in Menu → Products." },
    top: {
      icon: "solar:crown-bold",
      title: "No sales in this window",
      sub: "Once orders come in, top sellers show here.",
    },
    slow: {
      icon: "solar:snowflake-bold",
      title: "Nothing is dragging",
      sub: "Every product with sales is moving at a healthy pace.",
    },
    dead: {
      icon: "solar:sleeping-bold",
      title: "Nothing sitting idle",
      sub: "Every active product sold at least once in this window.",
    },
  }[tab];
  return (
    <div className="p-12 text-center text-gray-400">
      <Icon icon={meta.icon} className="w-12 h-12 mx-auto mb-3" />
      <p className="font-medium mb-1 text-gray-600">{meta.title}</p>
      <p className="text-sm">{meta.sub}</p>
    </div>
  );
}
