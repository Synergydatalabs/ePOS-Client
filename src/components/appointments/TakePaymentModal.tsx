"use client";

// TakePaymentModal
// ----------------
// Salon-focused mini-payment sheet used from the Appointments list. The
// customer already has an Order (created by public booking or by the
// walk-in New Appointment modal) and may have paid a deposit online — so
// the operator collects only the balance owing at the counter.
//
// This is deliberately NOT the general POS PaymentModal: no cart, no
// split-tender UI, no tips. Just three lines (total / paid / due) and a
// Cash + Card pair of buttons. The server-side payment endpoint is the
// SAME one the POS uses (POST /orders/[id]/payment), which already sums
// completed payments to compute `outstanding` — so the deposit is
// deducted naturally without any extra math on the client.

import { useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface TakePaymentModalProps {
  tenantId: string;
  orderId: string;
  orderNumber: string;
  customerName?: string;
  currency: string;
  totalCents: number;
  paidCents: number;
  onClose: () => void;
  onCollected: () => void;
}

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100
  );
}

export default function TakePaymentModal({
  tenantId,
  orderId,
  orderNumber,
  customerName,
  currency,
  totalCents,
  paidCents,
  onClose,
  onCollected,
}: TakePaymentModalProps) {
  const [processing, setProcessing] = useState<"CASH" | "CARD" | null>(null);
  const balance = Math.max(0, totalCents - paidCents);

  const collect = async (method: "CASH" | "CARD") => {
    if (balance <= 0) return;
    setProcessing(method);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/orders/${orderId}/payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Omit `amount` — server defaults to outstanding, so the
          // deposit-adjusted balance is what actually posts.
          body: JSON.stringify({ method }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Payment failed");
      }
      toast.success(
        `${fmt(data.applied || balance, currency)} collected on ${method.toLowerCase()}`
      );
      onCollected();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Payment failed");
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Take Payment</h2>
            <p className="text-sm text-gray-500 mt-1">
              {customerName || "Customer"} · Ref {orderNumber}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg"
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-2">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Order total</span>
            <span className="font-medium">{fmt(totalCents, currency)}</span>
          </div>
          {paidCents > 0 && (
            <div className="flex justify-between text-sm text-green-700">
              <span>Deposit paid</span>
              <span className="font-medium">−{fmt(paidCents, currency)}</span>
            </div>
          )}
          <div className="border-t border-gray-100 pt-2 flex justify-between text-base font-semibold text-gray-900">
            <span>Balance due</span>
            <span>{fmt(balance, currency)}</span>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 grid grid-cols-2 gap-3">
          <button
            onClick={() => collect("CASH")}
            disabled={balance <= 0 || processing !== null}
            className="py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            <Icon icon="solar:banknote-2-bold" className="w-5 h-5" />
            {processing === "CASH" ? "Processing…" : "Cash"}
          </button>
          <button
            onClick={() => collect("CARD")}
            disabled={balance <= 0 || processing !== null}
            className="py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            <Icon icon="solar:card-bold" className="w-5 h-5" />
            {processing === "CARD" ? "Processing…" : "Card"}
          </button>
        </div>

        {balance <= 0 && (
          <div className="px-6 pb-6">
            <p className="text-xs text-gray-500 text-center">
              Fully paid — nothing to collect.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
