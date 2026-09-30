"use client";

// ============================================================================
// /pos/open-bills/[dvcId]
//
// Per-bill view for an open check that's queued on the terminal. Operator
// lands here from the Open Bills list and picks how to pay:
//   - Pay Full             — drive a single AUTHORIZE for the bill amount
//   - Split Evenly N ways  — guide operator to use the terminal's Split menu
//                            (each split's AUTHORIZE comes back tagged with
//                            check_number, which is what GP cert validated)
//   - Split By Seat        — same; terminal handles the by-seat selection
//
// We could drive split-evenly programmatically by sending N AUTHORIZEs of
// (amount/N) ourselves, but the terminal-side flow is what GP cert ran
// against on 2026-06-29 and what produces the cleanest reference linkage
// per their tooling. Keep that path; revisit programmatic split later if
// operators want it.
// ============================================================================

import { Suspense, useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";

interface PendingBill {
  dvcId: string | null;
  checkNumber: string | null;
  tableNumber: string | null;
  userReference: string | null;
  amount: number | null;
  requestedAmount: number | null;
  timeCreated: string | null;
}

export default function OpenBillDetailPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <OpenBillDetailPageInner />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
    </div>
  );
}

function OpenBillDetailPageInner() {
  const { dvcId } = useParams<{ dvcId: string }>();
  const search = useSearchParams();
  const checkParam = search.get("check") || "";
  const router = useRouter();

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [bill, setBill] = useState<PendingBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTenantId(localStorage.getItem("tap_active_tenant"));
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/payments/uci/pending`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      const match = (data.bills || []).find(
        (b: PendingBill) => b.dvcId === decodeURIComponent(dvcId)
      );
      if (!match) {
        setError(
          "This bill is no longer in the open-bills list — it may have been paid or cancelled. Returning to the list."
        );
        return;
      }
      setBill(match);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [tenantId, dvcId]);

  useEffect(() => {
    if (tenantId) load();
  }, [tenantId, load]);

  const fmt = (cents: number | null) =>
    cents === null ? "—" : `$${(cents / 100).toFixed(2)}`;

  const handlePayFull = () => {
    // For Phase 1 we direct the operator to the terminal — the bill is
    // already on the terminal queue, so the cleanest action is for them to
    // pick it on-device and tap. A future iteration can pop our PaymentModal
    // and drive AUTHORIZE programmatically once we wire it to an existing
    // order id.
    toast.success(
      "Pick this check on the terminal screen → Pay → Pay Full, then tap the card."
    );
  };

  const handleSplitEvenly = () => {
    toast.success(
      "On the terminal: pick this check → Pay → Split → Evenly → choose number of ways."
    );
  };

  const handleSplitBySeat = () => {
    toast.success(
      "On the terminal: pick this check → Pay → Split → By Seat (or 'Split Evenly N ways' on terminal models without per-seat selection)."
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Open Bill" subtitle={checkParam} />
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
            <Icon icon="solar:info-circle-bold" className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-amber-900">Bill not available</p>
              <p className="text-sm text-amber-800 mt-1">{error}</p>
              <button
                onClick={() => router.push("/pos/open-bills")}
                className="mt-3 text-sm font-medium text-amber-900 underline hover:no-underline"
              >
                Back to Open Bills
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title={`Check ${bill.checkNumber || "(no number)"}`}
        subtitle={
          bill.tableNumber
            ? `Table ${bill.tableNumber} • ${bill.userReference || "—"}`
            : bill.userReference || ""
        }
        actions={
          <button
            onClick={() => router.push("/pos/open-bills")}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <Icon icon="solar:arrow-left-bold" className="w-4 h-4" />
            All bills
          </button>
        }
      />

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Bill summary */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Outstanding</p>
            <p className="text-xs text-gray-400 font-mono truncate max-w-[12rem]">{bill.dvcId}</p>
          </div>
          <p className="text-5xl font-bold text-gray-900 mb-6">{fmt(bill.amount)}</p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Original total</p>
              <p className="font-medium text-gray-900 mt-0.5">{fmt(bill.requestedAmount)}</p>
            </div>
            <div>
              <p className="text-gray-500">Opened</p>
              <p className="font-medium text-gray-900 mt-0.5">
                {bill.timeCreated
                  ? new Date(bill.timeCreated).toLocaleTimeString("en-CA", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Payment actions */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm font-semibold text-gray-700 mb-4">How is the guest paying?</p>
          <div className="space-y-3">
            <button
              onClick={handlePayFull}
              className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Icon icon="solar:card-bold" className="w-6 h-6 text-indigo-600" />
                <div className="text-left">
                  <p className="font-semibold text-gray-900">Pay full {fmt(bill.amount)}</p>
                  <p className="text-xs text-gray-600 mt-0.5">Single tap on the terminal</p>
                </div>
              </div>
              <Icon icon="solar:arrow-right-bold" className="w-5 h-5 text-indigo-600" />
            </button>

            <button
              onClick={handleSplitEvenly}
              className="w-full flex items-center justify-between p-4 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Icon icon="solar:users-group-rounded-bold" className="w-6 h-6 text-gray-600" />
                <div className="text-left">
                  <p className="font-semibold text-gray-900">Split evenly</p>
                  <p className="text-xs text-gray-600 mt-0.5">2-way / 3-way / 4-way — terminal prompts each tap</p>
                </div>
              </div>
              <Icon icon="solar:arrow-right-bold" className="w-5 h-5 text-gray-500" />
            </button>

            <button
              onClick={handleSplitBySeat}
              className="w-full flex items-center justify-between p-4 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Icon icon="solar:armchair-bold" className="w-6 h-6 text-gray-600" />
                <div className="text-left">
                  <p className="font-semibold text-gray-900">Split by seat</p>
                  <p className="text-xs text-gray-600 mt-0.5">Pay each seat&apos;s items separately</p>
                </div>
              </div>
              <Icon icon="solar:arrow-right-bold" className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="mt-5 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2">
            <Icon icon="solar:info-circle-bold" className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p>
              The check is already queued on the terminal. Pick it on the device&apos;s &quot;Open
              Bills&quot; screen and the terminal walks the customer through tap → PIN (Interac)
              → receipt.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
