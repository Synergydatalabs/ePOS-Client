"use client";

// Supplier AR aging index — Phase D #75.
//
// One row per merchant with an outstanding balance, sorted by biggest
// owed first. Aging pills give a scannable at-a-glance ("this merchant
// has $5k in 90+"). Click a row to open the detailed statement.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface AgingBreakdown {
  notYetDue: number;
  "1_30": number;
  "31_60": number;
  "61_90": number;
  over_90: number;
}
interface MerchantRow {
  merchantTenantId: string;
  merchantName: string;
  poCount: number;
  totalOutstandingCents: number;
  currency: string;
  aging: AgingBreakdown;
  oldestSubmittedAt: string;
  oldestDaysOverdue: number;
}
interface Totals {
  totalOutstandingCents: number;
  aging: AgingBreakdown;
  currency: string;
  merchantCount: number;
  poCount: number;
}

const fmtMoney = (c: number, currency: string) =>
  `${currency} ${(c / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function SupplierStatementsPage() {
  const [rows, setRows] = useState<MerchantRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [netTermsDays, setNetTermsDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier/statements")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setRows(data.rows);
          setTotals(data.totals);
          setNetTermsDays(data.netTermsDays);
        } else {
          toast.error(data.error || "Failed to load statements");
        }
      })
      .catch(() => toast.error("Failed to load statements"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Statements & AR</h1>
        <p className="text-sm text-gray-500 mt-1">
          Outstanding balances across all merchants. Terms: Net {netTermsDays}{" "}
          (change on your profile).
        </p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-32 bg-gray-100 rounded-2xl" />
          <div className="h-24 bg-gray-100 rounded-2xl" />
        </div>
      ) : !totals || totals.totalOutstandingCents === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
          <Icon
            icon="solar:check-circle-linear"
            className="w-14 h-14 text-emerald-400 mx-auto mb-3"
          />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            All caught up
          </h3>
          <p className="text-sm text-gray-500">
            No outstanding balances right now.
          </p>
        </div>
      ) : (
        <>
          {/* Grand totals card */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-6 mb-6">
            <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">
              Total outstanding
            </p>
            <p className="text-4xl font-bold mb-4">
              {fmtMoney(totals.totalOutstandingCents, totals.currency)}
            </p>
            <p className="text-xs text-slate-400 mb-3">
              Across {totals.merchantCount} merchant
              {totals.merchantCount !== 1 ? "s" : ""} · {totals.poCount} open PO
              {totals.poCount !== 1 ? "s" : ""}
            </p>
            <AgingPills aging={totals.aging} currency={totals.currency} inverted />
          </div>

          {/* Per-merchant list */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">By merchant</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {rows.map((r) => (
                <Link
                  key={r.merchantTenantId}
                  href={`/supplier/statements/${r.merchantTenantId}`}
                  className="block p-5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {r.merchantName}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {r.poCount} open PO{r.poCount !== 1 ? "s" : ""} · oldest{" "}
                        {r.oldestDaysOverdue > 0
                          ? `${r.oldestDaysOverdue}d overdue`
                          : "on time"}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold text-gray-900">
                        {fmtMoney(r.totalOutstandingCents, r.currency)}
                      </p>
                      <p className="text-xs text-gray-500">outstanding</p>
                    </div>
                  </div>
                  <AgingPills aging={r.aging} currency={r.currency} />
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Small aging pill row. `inverted` swaps colors for dark backgrounds
// (used in the grand-total card).
function AgingPills({
  aging,
  currency,
  inverted,
}: {
  aging: AgingBreakdown;
  currency: string;
  inverted?: boolean;
}) {
  const buckets: { key: keyof AgingBreakdown; label: string; tone: string }[] = [
    { key: "notYetDue", label: "Not due", tone: "emerald" },
    { key: "1_30", label: "1–30d", tone: "amber" },
    { key: "31_60", label: "31–60d", tone: "orange" },
    { key: "61_90", label: "61–90d", tone: "red" },
    { key: "over_90", label: "90+d", tone: "rose" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {buckets.map((b) => {
        const v = aging[b.key];
        if (v === 0) return null;
        const bg = inverted
          ? `bg-white/10 text-white`
          : {
              emerald: "bg-emerald-100 text-emerald-800",
              amber: "bg-amber-100 text-amber-900",
              orange: "bg-orange-100 text-orange-900",
              red: "bg-red-100 text-red-800",
              rose: "bg-rose-100 text-rose-800",
            }[b.tone];
        return (
          <span
            key={b.key}
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium ${bg}`}
          >
            <span className="opacity-80">{b.label}</span>
            <span className="font-semibold">{fmtMoney(v, currency)}</span>
          </span>
        );
      })}
    </div>
  );
}
