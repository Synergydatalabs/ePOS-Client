"use client";

// =============================================================================
// /supplier/subscriptions — list of recurring subscriptions this supplier owns.
//
// Every row shows customer / interval / next-billing / status / invoice count
// + a Cancel button for ACTIVE / PENDING_ACTIVATION / PAST_DUE rows. Detail
// view is deferred to G #2 — for now the row itself carries enough info and
// the customer's individual invoices are already visible under /invoices.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface SubscriptionRow {
  id: string;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  currency: string;
  totalCents: number;
  interval: "MONTHLY" | "ANNUAL" | string;
  intervalCount: number;
  status: "PENDING_ACTIVATION" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | string;
  activatedAt: string | null;
  nextBillingAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  _count: { invoices: number };
}

const STATUS_STYLES: Record<
  string,
  { bg: string; fg: string; label: string; dot: string }
> = {
  PENDING_ACTIVATION: {
    bg: "bg-amber-50",
    fg: "text-amber-800",
    dot: "bg-amber-500",
    label: "Awaiting first payment",
  },
  ACTIVE: {
    bg: "bg-green-50",
    fg: "text-green-800",
    dot: "bg-green-600",
    label: "Active",
  },
  PAST_DUE: {
    bg: "bg-red-50",
    fg: "text-red-800",
    dot: "bg-red-600",
    label: "Past due",
  },
  CANCELLED: {
    bg: "bg-gray-100",
    fg: "text-gray-600",
    dot: "bg-gray-400",
    label: "Cancelled",
  },
};

export default function SupplierSubscriptionsPage() {
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (search.trim()) qs.set("search", search.trim());
      const res = await fetch(`/api/supplier/subscriptions?${qs.toString()}`);
      const data = await res.json();
      if (data.success) setSubs(data.subscriptions);
      else toast.error(data.error || "Failed to load subscriptions");
    } catch {
      toast.error("Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const money = (cents: number, ccy: string) =>
    `${ccy} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const intervalLabel = (row: SubscriptionRow) => {
    if (row.interval === "MONTHLY") {
      return row.intervalCount > 1 ? `Every ${row.intervalCount} months` : "Monthly";
    }
    if (row.interval === "ANNUAL") {
      return row.intervalCount > 1 ? `Every ${row.intervalCount} years` : "Annual";
    }
    return row.interval;
  };

  const handleCancel = async (row: SubscriptionRow) => {
    const reason = prompt(
      `Cancel ${row.customerName}'s ${intervalLabel(row).toLowerCase()} subscription?\n\n` +
        `Reason (optional — visible in the audit log):`
    );
    if (reason === null) return; // user hit escape

    setCancelling(row.id);
    try {
      const res = await fetch(`/api/supplier/subscriptions/${row.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Cancel failed");
        return;
      }
      toast.success("Subscription cancelled");
      load();
    } catch {
      toast.error("Cancel failed");
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscriptions</h1>
          <p className="text-sm text-gray-500 mt-1">
            Recurring billing arrangements. Each one auto-generates a new invoice
            every period; the buyer clicks the emailed pay link to complete each
            payment.
          </p>
        </div>
        <a
          href="/supplier/invoices"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 text-white text-sm font-semibold px-4 py-2 hover:bg-teal-700"
        >
          <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
          New subscription (via Invoices)
        </a>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Icon
            icon="solar:magnifer-linear"
            className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name / email / company"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING_ACTIVATION">Awaiting first payment</option>
          <option value="PAST_DUE">Past due</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400 animate-pulse">
            Loading subscriptions…
          </div>
        ) : subs.length === 0 ? (
          <div className="p-16 text-center">
            <Icon
              icon="solar:refresh-circle-linear"
              className="w-16 h-16 text-gray-300 mx-auto mb-4"
            />
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              No subscriptions yet
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              Start a recurring billing arrangement from the Invoices page — pick{" "}
              <strong>Subscription</strong> at the top of the New Invoice form.
            </p>
            <a
              href="/supplier/invoices"
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 text-white text-sm font-semibold px-4 py-2 hover:bg-teal-700"
            >
              <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
              Go to Invoices
            </a>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Next billing</th>
                <th className="text-right px-4 py-3">Invoices</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((row) => {
                const s = STATUS_STYLES[row.status] || {
                  bg: "bg-gray-100",
                  fg: "text-gray-600",
                  dot: "bg-gray-400",
                  label: row.status,
                };
                const canCancel = row.status !== "CANCELLED";
                return (
                  <tr
                    key={row.id}
                    className="border-t border-gray-100 hover:bg-gray-50/70"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{row.customerName}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[240px]">
                        {row.customerCompany ? (
                          <>
                            {row.customerCompany} · {row.customerEmail}
                          </>
                        ) : (
                          row.customerEmail
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{intervalLabel(row)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900 font-semibold">
                      {money(row.totalCents, row.currency)}
                      <div className="text-xs text-gray-400 font-normal">
                        /{row.interval === "MONTHLY" ? "mo" : "yr"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${s.bg} ${s.fg}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {s.label}
                      </span>
                      {row.status === "CANCELLED" && row.cancelledBy && (
                        <div className="text-[10px] text-gray-400 mt-1">
                          by {row.cancelledBy.toLowerCase().replace(/_/g, " ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">
                      {row.status === "CANCELLED"
                        ? `Cancelled ${fmtDate(row.cancelledAt)}`
                        : row.status === "PENDING_ACTIVATION"
                        ? "After first payment"
                        : fmtDate(row.nextBillingAt)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {row._count.invoices}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canCancel ? (
                        <button
                          onClick={() => handleCancel(row)}
                          disabled={cancelling === row.id}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Icon
                            icon={
                              cancelling === row.id
                                ? "solar:refresh-bold"
                                : "solar:close-circle-linear"
                            }
                            className={`w-4 h-4 ${cancelling === row.id ? "animate-spin" : ""}`}
                          />
                          Cancel
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
