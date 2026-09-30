"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { Modal, Button } from "@/components/ui";

// Common refund reasons — keep the list short. "Other" reveals a free-text
// note so the operator isn't forced into the wrong bucket.
const REASONS = [
  "Customer request",
  "Wrong item",
  "Damaged / defective",
  "Duplicate charge",
  "Order not fulfilled",
  "Price adjustment",
  "Other",
];

export interface PaymentForRefund {
  id: string;
  method: string; // 'cash' | 'card' | 'interac' | 'gift_card' | 'online'
  amount: number; // cents
  refundedAmount: number; // sum of prior refunds on this payment (cents)
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  orderId: string;
  orderTotal: number;
  currency: string;
  payments: PaymentForRefund[];
  /** Called after a successful refund so caller can re-fetch. */
  onRefunded: (result: RefundResult) => void;
}

interface RefundResult {
  paymentId: string;
  amount: number;
  paymentStatus: "REFUNDED" | "PARTIALLY_REFUNDED";
  giftCard?: { code: string; balance: number };
}

export default function RefundModal({
  isOpen,
  onClose,
  tenantId,
  orderId,
  orderTotal,
  currency,
  payments,
  onRefunded,
}: Props) {
  const refundable = payments.filter(
    (p) => p.amount - p.refundedAmount > 0
  );
  const [paymentId, setPaymentId] = useState<string>(refundable[0]?.id || "");
  const selected = refundable.find((p) => p.id === paymentId);
  const cap = selected ? selected.amount - selected.refundedAmount : 0;

  const [amountStr, setAmountStr] = useState(
    selected ? (cap / 100).toFixed(2) : "0.00"
  );
  const [reasonPreset, setReasonPreset] = useState(REASONS[0]);
  const [reasonNote, setReasonNote] = useState("");
  const [refundTo, setRefundTo] = useState<"ORIGINAL" | "GIFT_CARD">("ORIGINAL");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ giftCard?: { code: string; balance: number } } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
      (cents || 0) / 100
    );

  // Refresh amount default when the operator switches payment.
  const pickPayment = (id: string) => {
    setPaymentId(id);
    const p = refundable.find((x) => x.id === id);
    if (p) setAmountStr(((p.amount - p.refundedAmount) / 100).toFixed(2));
  };

  const amountCents = Math.round(parseFloat(amountStr || "0") * 100);
  const canSubmit =
    !!selected &&
    amountCents > 0 &&
    amountCents <= cap &&
    !submitting;

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const finalReason =
        reasonPreset === "Other"
          ? reasonNote || "Other"
          : reasonNote
            ? `${reasonPreset} — ${reasonNote}`
            : reasonPreset;
      const res = await fetch(
        `/api/tenants/${tenantId}/orders/${orderId}/payment/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId: selected.id,
            amount: amountCents,
            reason: finalReason,
            refundTo,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Refund failed");
        return;
      }
      setResult({ giftCard: data.giftCard });
      onRefunded({
        paymentId: selected.id,
        amount: amountCents,
        paymentStatus: data.paymentStatus,
        giftCard: data.giftCard,
      });
    } catch {
      setError("Refund request failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Success screen — surfaces the gift-card code so the operator can hand
  // it to the customer immediately.
  if (result) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} size="md" title="Refund Complete">
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-green-50 border border-green-100 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-100 flex items-center justify-center">
              <Icon icon="solar:check-circle-bold" className="w-7 h-7 text-green-600" />
            </div>
            <p className="text-sm text-green-700">Refunded</p>
            <p className="text-3xl font-bold text-green-800">
              {formatPrice(amountCents)}
            </p>
          </div>

          {result.giftCard && (
            <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
              <p className="text-xs uppercase opacity-80 mb-1">
                New Gift Card Issued
              </p>
              <div className="flex items-center justify-between">
                <p className="font-mono text-lg font-bold tracking-wider">
                  {result.giftCard.code}
                </p>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(result.giftCard!.code)
                  }
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20"
                  title="Copy code"
                >
                  <Icon icon="solar:copy-linear" className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm opacity-90 mt-2">
                Balance: {formatPrice(result.giftCard.balance)} — hand this to
                the customer.
              </p>
            </div>
          )}

          <Button onClick={onClose} fullWidth>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  if (refundable.length === 0) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} size="md" title="No refundable payments">
        <div className="text-center py-6 text-gray-500">
          <Icon icon="solar:info-circle-bold" className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm">
            All payments on this order have already been fully refunded.
          </p>
        </div>
        <Button onClick={onClose} fullWidth>
          Close
        </Button>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" title="Refund Payment">
      <div className="space-y-4">
        {/* Payment picker — usually just one but split-tender orders can
            have several. */}
        {refundable.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Which payment to refund?
            </label>
            <div className="space-y-2">
              {refundable.map((p) => {
                const remaining = p.amount - p.refundedAmount;
                const active = p.id === paymentId;
                return (
                  <button
                    key={p.id}
                    onClick={() => pickPayment(p.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-colors ${
                      active
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon
                        icon={
                          p.method === "cash"
                            ? "solar:wallet-money-bold"
                            : p.method === "gift_card"
                              ? "solar:gift-bold"
                              : "solar:card-bold"
                        }
                        className="w-5 h-5 text-gray-500"
                      />
                      <span className="text-sm font-medium capitalize">
                        {p.method.replace("_", " ")}
                      </span>
                    </span>
                    <span className="text-sm">
                      <span className="font-semibold text-gray-900">
                        {formatPrice(remaining)}
                      </span>
                      {p.refundedAmount > 0 && (
                        <span className="text-gray-400 ml-1">
                          / {formatPrice(p.amount)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Refund amount ({currency})
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            max={(cap / 100).toFixed(2)}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setAmountStr((cap / 100).toFixed(2))}
              className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              Full ({formatPrice(cap)})
            </button>
            <button
              onClick={() => setAmountStr((cap / 200).toFixed(2))}
              className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              Half
            </button>
          </div>
          {amountCents > cap && (
            <p className="text-xs text-red-600 mt-1">
              Exceeds refundable amount ({formatPrice(cap)})
            </p>
          )}
        </div>

        {/* Refund destination */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Refund to
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                id: "ORIGINAL" as const,
                label: "Original method",
                desc:
                  selected?.method === "cash"
                    ? "Return cash from drawer"
                    : selected?.method === "gift_card"
                      ? "Credit back to the gift card"
                      : "Refund to card on file",
                icon:
                  selected?.method === "cash"
                    ? "solar:wallet-money-bold"
                    : selected?.method === "gift_card"
                      ? "solar:gift-bold"
                      : "solar:card-bold",
              },
              {
                id: "GIFT_CARD" as const,
                label: "New gift card",
                desc: "Issue a digital card the customer can spend later",
                icon: "solar:gift-bold",
              },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setRefundTo(opt.id)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  refundTo === opt.id
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Icon
                  icon={opt.icon}
                  className={`w-5 h-5 mb-1 ${refundTo === opt.id ? "text-indigo-600" : "text-gray-400"}`}
                />
                <p className="font-semibold text-sm text-gray-900">
                  {opt.label}
                </p>
                <p className="text-xs text-gray-500">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reason
          </label>
          <select
            value={reasonPreset}
            onChange={(e) => setReasonPreset(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-sm"
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder={
              reasonPreset === "Other" ? "Describe the reason" : "Optional note"
            }
            className="w-full mt-2 px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-sm"
          />
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700 flex items-start gap-2">
            <Icon
              icon="solar:danger-triangle-bold"
              className="w-5 h-5 flex-shrink-0"
            />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            loading={submitting}
            fullWidth
            className="bg-red-600 hover:bg-red-700"
          >
            Refund {formatPrice(Math.min(amountCents, cap))}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
