"use client";

// Bill split at dine-in. Opens from PaymentModal when the cashier taps
// "Split Bill". Three modes:
//   EQUAL     — divide the order total by N guests (server enforces the
//               rounding-cent tolerance so the last guest doesn't over-pay).
//   BY_GUEST  — one row per guest, cashier types each amount manually.
//               Live "remaining" indicator keeps the split balanced.
//   SINGLE    — one guest pays it all (equivalent to no split, but useful
//               when the cashier wants to reset to zero splits).
//
// Split-by-item (drag items between guests) is deferred to a follow-up —
// the schema supports it via BillSplitItem.metadata but the UX warrants
// its own dedicated pass.
//
// Payment collection: after committing the split, the modal shows a list
// of splits with a "Collect" button per row. Each collect opens the
// standard PaymentMethod picker (cash/card/interac/gift card) — reuses
// the same visual language as the main PaymentModal, just scoped to one
// split-item at a time.

import { useState, useCallback } from "react";
import { Icon } from "@iconify/react";
import { Modal, Button } from "@/components/ui";
import { toast } from "sonner";

interface SplitItemRow {
  id: string;
  guestName: string | null;
  amount: number;
  tipAmount: number;
  status: string;
  paymentId?: string | null;
  paidAt?: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  orderId: string;
  orderTotal: number;
  currency: string;
  /** Called once every split-item has been paid + the order is closed. */
  onAllPaid?: () => void;
}

type Mode = "config" | "collect";

const MAX_GUESTS = 10;

export default function BillSplitModal({
  isOpen,
  onClose,
  tenantId,
  orderId,
  orderTotal,
  currency,
  onAllPaid,
}: Props) {
  const [mode, setMode] = useState<Mode>("config");
  const [splitItems, setSplitItems] = useState<SplitItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);

  // Config-form state — only used in Mode = "config"
  const [splitType, setSplitType] = useState<"EQUAL" | "BY_GUEST">("EQUAL");
  const [guestCount, setGuestCount] = useState(2);
  const [manualAmounts, setManualAmounts] = useState<string[]>(["0.00", "0.00"]);

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
      (cents || 0) / 100
    );

  // Load any existing split when the modal opens. If the order is
  // already split (e.g. the cashier bounced out and came back), jump
  // straight to the collect view.
  const load = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/orders/${orderId}/split`
      );
      const data = await res.json();
      if (data.success && data.split) {
        setSplitItems(data.split.items);
        setMode("collect");
      }
    } finally {
      setLoading(false);
    }
  }, [isOpen, tenantId, orderId]);

  // Fire once on open. useEffect not useCallback so we don't re-run on
  // every rerender.
  useState(() => {
    load();
    return null;
  });

  const adjustGuestCount = (delta: number) => {
    const next = Math.max(2, Math.min(MAX_GUESTS, guestCount + delta));
    setGuestCount(next);
    // Resize the manual-amounts array in step with guest count.
    setManualAmounts((prev) => {
      const arr = [...prev];
      while (arr.length < next) arr.push("0.00");
      arr.length = next;
      return arr;
    });
  };

  const setManualAt = (i: number, value: string) => {
    setManualAmounts((prev) => {
      const arr = [...prev];
      arr[i] = value;
      return arr;
    });
  };

  const commitSplit = async () => {
    setLoading(true);
    try {
      let splits: Array<{ guestName: string; amount: number }>;
      if (splitType === "EQUAL") {
        // Divide orderTotal evenly. Floor each share, hand extra cents
        // to the last N guests so Σ shares === orderTotal exactly.
        const base = Math.floor(orderTotal / guestCount);
        const remainder = orderTotal - base * guestCount;
        splits = Array.from({ length: guestCount }, (_, i) => ({
          guestName: `Guest ${i + 1}`,
          amount: base + (i < remainder ? 1 : 0),
        }));
      } else {
        splits = manualAmounts.map((s, i) => ({
          guestName: `Guest ${i + 1}`,
          amount: Math.round(parseFloat(s || "0") * 100),
        }));
      }

      const res = await fetch(
        `/api/tenants/${tenantId}/orders/${orderId}/split`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ splitType, splits }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setSplitItems(data.split.items);
        setMode("collect");
      } else {
        toast.error(data.error || "Could not save split");
      }
    } finally {
      setLoading(false);
    }
  };

  const collect = async (splitItemId: string, method: string) => {
    setPaying(splitItemId);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/orders/${orderId}/split/${splitItemId}/pay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setSplitItems((prev) =>
          prev.map((s) =>
            s.id === splitItemId ? { ...s, status: "COMPLETED" } : s
          )
        );
        toast.success(
          data.orderClosed ? "Order closed" : `Paid — ${data.remainingUnpaid} remaining`
        );
        if (data.orderClosed) {
          onAllPaid?.();
          setTimeout(onClose, 600);
        }
      } else {
        toast.error(data.error || "Payment failed");
      }
    } finally {
      setPaying(null);
    }
  };

  const manualTotal = manualAmounts.reduce(
    (s, v) => s + Math.round(parseFloat(v || "0") * 100),
    0
  );
  const remaining = orderTotal - manualTotal;
  const canCommitManual = Math.abs(remaining) <= manualAmounts.length; // tolerance

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Split the Bill"
      subtitle={`Order total ${formatPrice(orderTotal)}`}
    >
      {loading ? (
        <div className="py-12 text-center text-gray-400">
          <Icon
            icon="solar:refresh-linear"
            className="w-8 h-8 animate-spin mx-auto"
          />
        </div>
      ) : mode === "config" ? (
        <div className="space-y-4">
          {/* Split-type toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              How to split
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    id: "EQUAL" as const,
                    label: "Split Evenly",
                    icon: "solar:equal-bold",
                  },
                  {
                    id: "BY_GUEST" as const,
                    label: "Custom Amounts",
                    icon: "solar:users-group-rounded-bold",
                  },
                ]
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSplitType(t.id)}
                  className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-colors ${
                    splitType === t.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <Icon
                    icon={t.icon}
                    className={`w-6 h-6 ${splitType === t.id ? "text-indigo-600" : "text-gray-400"}`}
                  />
                  <span className="text-sm font-medium text-gray-900">
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {splitType === "EQUAL" ? (
            <div className="p-4 rounded-2xl bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700">
                  Number of guests
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => adjustGuestCount(-1)}
                    disabled={guestCount <= 2}
                    className="w-8 h-8 rounded-full border border-gray-200 hover:bg-gray-100 disabled:opacity-40 flex items-center justify-center"
                  >
                    <Icon icon="solar:minus-linear" className="w-4 h-4" />
                  </button>
                  <span className="text-2xl font-bold text-gray-900 w-8 text-center tabular-nums">
                    {guestCount}
                  </span>
                  <button
                    onClick={() => adjustGuestCount(1)}
                    disabled={guestCount >= MAX_GUESTS}
                    className="w-8 h-8 rounded-full border border-gray-200 hover:bg-gray-100 disabled:opacity-40 flex items-center justify-center"
                  >
                    <Icon icon="solar:add-linear" className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="text-center py-3 bg-white rounded-xl">
                <p className="text-xs uppercase text-gray-500">Each pays</p>
                <p className="text-3xl font-bold text-gray-900">
                  {formatPrice(Math.floor(orderTotal / guestCount))}
                </p>
                {orderTotal % guestCount !== 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    ({orderTotal % guestCount} guest{orderTotal % guestCount === 1 ? "" : "s"} pay
                    {orderTotal % guestCount === 1 ? "s" : ""} 1¢ more)
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <label className="font-medium text-gray-700">
                  Custom amounts
                </label>
                <span
                  className={`font-semibold tabular-nums ${
                    Math.abs(remaining) <= manualAmounts.length
                      ? remaining === 0
                        ? "text-green-600"
                        : "text-gray-600"
                      : "text-red-600"
                  }`}
                >
                  {remaining >= 0 ? "Remaining " : "Over by "}
                  {formatPrice(Math.abs(remaining))}
                </span>
              </div>
              <div className="space-y-2">
                {manualAmounts.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 w-14">
                      Guest {i + 1}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={v}
                      onChange={(e) => setManualAt(i, e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-right tabular-nums"
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <button
                  onClick={() => adjustGuestCount(1)}
                  disabled={manualAmounts.length >= MAX_GUESTS}
                  className="text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-40"
                >
                  + Add guest
                </button>
                <button
                  onClick={() => adjustGuestCount(-1)}
                  disabled={manualAmounts.length <= 2}
                  className="text-gray-500 hover:text-gray-700 disabled:opacity-40"
                >
                  − Remove last
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={onClose} fullWidth>
              Cancel
            </Button>
            <Button
              onClick={commitSplit}
              disabled={
                loading ||
                (splitType === "BY_GUEST" && !canCommitManual)
              }
              loading={loading}
              fullWidth
            >
              Continue to Collect
            </Button>
          </div>
        </div>
      ) : (
        // ── Collect mode ─────────────────────────────────────────────
        <CollectView
          splitItems={splitItems}
          formatPrice={formatPrice}
          paying={paying}
          onCollect={collect}
        />
      )}
    </Modal>
  );
}

// Per-split payment row: shows guest name + amount + a compact set of
// method buttons. Tapping a method commits the payment immediately —
// no separate confirm step. Keeps the flow fast for restaurant tables
// where guests are already holding out cards.
function CollectView({
  splitItems,
  formatPrice,
  paying,
  onCollect,
}: {
  splitItems: SplitItemRow[];
  formatPrice: (cents: number) => string;
  paying: string | null;
  onCollect: (splitItemId: string, method: string) => void;
}) {
  const unpaid = splitItems.filter((s) => s.status !== "COMPLETED");
  const paid = splitItems.filter((s) => s.status === "COMPLETED");

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100 flex items-baseline justify-between">
        <span className="text-sm font-medium text-indigo-900">
          Progress
        </span>
        <span className="text-sm font-semibold text-indigo-900">
          {paid.length} / {splitItems.length} paid
        </span>
      </div>

      <div className="space-y-2">
        {splitItems.map((s) => {
          const isPaid = s.status === "COMPLETED";
          const isPaying = paying === s.id;
          return (
            <div
              key={s.id}
              className={`p-3 rounded-xl border ${
                isPaid
                  ? "bg-green-50 border-green-200"
                  : "bg-white border-gray-200"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-gray-900">
                    {s.guestName || "Guest"}
                  </p>
                  <p className="text-lg font-bold text-gray-900 tabular-nums">
                    {formatPrice(s.amount + (s.tipAmount || 0))}
                  </p>
                </div>
                {isPaid && (
                  <Icon
                    icon="solar:check-circle-bold"
                    className="w-6 h-6 text-green-600"
                  />
                )}
              </div>
              {!isPaid && (
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { id: "CASH", label: "Cash", icon: "solar:wallet-money-bold" },
                    { id: "CARD", label: "Card", icon: "solar:card-bold" },
                    { id: "INTERAC", label: "Interac", icon: "solar:card-transfer-bold" },
                    { id: "GIFT_CARD", label: "Gift", icon: "solar:gift-bold" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => onCollect(s.id, m.id)}
                      disabled={!!paying}
                      className="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-700 hover:text-indigo-700 text-xs font-medium transition-colors disabled:opacity-40"
                    >
                      <Icon
                        icon={isPaying ? "solar:refresh-linear" : m.icon}
                        className={`w-4 h-4 ${isPaying ? "animate-spin" : ""}`}
                      />
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {unpaid.length === 0 && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-center text-green-800">
          <Icon
            icon="solar:check-circle-bold"
            className="w-8 h-8 mx-auto mb-2"
          />
          <p className="font-semibold">All splits paid</p>
        </div>
      )}
    </div>
  );
}
