"use client";

// ============================================================================
// /pos/open-bills
//
// Restaurant operator view of every unpaid bill currently queued on the
// terminal (GP UCI PENDING_TRANSACTION_LIST). Servers use this screen to:
//   - See all open checks across the floor at a glance
//   - Tap into a check and run payment (single-tap → full pay → flows through
//     the existing PaymentModal)
//   - Auto-refresh every 10s so it stays current as new orders queue up
//
// This is the first piece of the GP-cert flow staff actually touch. The rest
// (split payment, by-seat pay, refund) hang off the per-bill detail screen
// once we build that.
// ============================================================================

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";

interface PendingBill {
  dvcId: string | null;
  checkNumber: string | null;
  tableNumber: string | null;
  userReference: string | null; // clerk/server
  amount: number | null;        // cents
  requestedAmount: number | null;
  timeCreated: string | null;
}

interface PendingResponse {
  success?: boolean;
  error?: string;
  terminal?: { id: string; name: string; lane: string };
  count?: number;
  bills?: PendingBill[];
}

const REFRESH_MS = 10_000;

export default function OpenBillsPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [bills, setBills] = useState<PendingBill[]>([]);
  const [terminalName, setTerminalName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  useEffect(() => {
    setTenantId(localStorage.getItem("tap_active_tenant"));
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!tenantId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenants/${tenantId}/payments/uci/pending`);
        const data: PendingResponse = await res.json();
        if (!res.ok || data.error) {
          setError(data.error || `Request failed (${res.status})`);
          setBills([]);
          return;
        }
        setBills(data.bills || []);
        setTerminalName(data.terminal?.name || "");
        setLastRefreshed(new Date());
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setError(msg);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [tenantId]
  );

  // Initial load + auto-refresh
  useEffect(() => {
    if (!tenantId) return;
    load();
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [tenantId, load]);

  const fmtMoney = (cents: number | null) =>
    cents === null ? "—" : `$${(cents / 100).toFixed(2)}`;

  const fmtTime = (iso: string | null) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  };

  const handlePay = (bill: PendingBill) => {
    if (!bill.dvcId) {
      toast.error("This bill has no DVC reference — cannot route payment.");
      return;
    }
    // Hand off to the existing payment flow. We pass the DVC + check number
    // so the payment screen knows this is an open-bill payment (which links
    // the resulting AUTHORIZE TRN to the check_number on the cloud side).
    router.push(
      `/pos/open-bills/${encodeURIComponent(bill.dvcId)}?check=${
        encodeURIComponent(bill.checkNumber || "")
      }`
    );
  };

  if (!tenantId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Open Bills"
        subtitle={
          terminalName
            ? `Live from terminal ${terminalName} • ${bills.length} open`
            : "Live from terminal"
        }
        actions={
          <button
            onClick={() => load()}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <Icon
              icon="solar:refresh-bold"
              className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        }
      />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {lastRefreshed && (
          <p className="text-xs text-gray-500 mb-3">
            Updated {lastRefreshed.toLocaleTimeString("en-CA")} • auto-refreshes every {REFRESH_MS / 1000}s
          </p>
        )}

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-4 flex items-start gap-3">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-red-900">Couldn&apos;t load open bills</p>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        )}

        {!error && bills.length === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <Icon icon="solar:bill-list-bold-duotone" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">No open bills</p>
            <p className="text-sm text-gray-500 mt-1">
              Create an order from POS — it will appear here once it lands on the terminal queue.
            </p>
          </div>
        )}

        {bills.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left text-xs font-bold text-gray-600 uppercase tracking-wider px-4 py-3">Check #</th>
                  <th className="text-left text-xs font-bold text-gray-600 uppercase tracking-wider px-4 py-3">Table</th>
                  <th className="text-left text-xs font-bold text-gray-600 uppercase tracking-wider px-4 py-3">Server</th>
                  <th className="text-right text-xs font-bold text-gray-600 uppercase tracking-wider px-4 py-3">Outstanding</th>
                  <th className="text-right text-xs font-bold text-gray-600 uppercase tracking-wider px-4 py-3">Of total</th>
                  <th className="text-left text-xs font-bold text-gray-600 uppercase tracking-wider px-4 py-3">Opened</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bills.map((b) => (
                  <tr key={b.dvcId || `${b.checkNumber}-${b.tableNumber}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-4">
                      <p className="font-mono text-sm font-medium text-gray-900">{b.checkNumber || "—"}</p>
                      {b.dvcId && (
                        <p className="font-mono text-[10px] text-gray-400 mt-0.5 truncate max-w-[12rem]">{b.dvcId}</p>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-900">{b.tableNumber || "—"}</td>
                    <td className="px-4 py-4 text-sm text-gray-600">{b.userReference || "—"}</td>
                    <td className="px-4 py-4 text-right">
                      <span className="font-semibold text-gray-900">{fmtMoney(b.amount)}</span>
                    </td>
                    <td className="px-4 py-4 text-right text-sm text-gray-500">
                      {fmtMoney(b.requestedAmount)}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-600">{fmtTime(b.timeCreated)}</td>
                    <td className="px-4 py-4 text-right">
                      <button
                        onClick={() => handlePay(b)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                      >
                        Pay
                        <Icon icon="solar:arrow-right-bold" className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
