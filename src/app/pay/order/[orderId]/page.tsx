"use client";

// Public MCO pay page for a mobile-POS order.
//
// This is what the customer lands on when they scan the staff phone's QR
// during card checkout. Everything happens on the customer's own device:
//   1. Fetch order details (public — orderId is a UUID)
//   2. Render MonerisOrderCheckoutSection which mounts the hosted MCO
//      widget in an iframe
//   3. Customer taps in card / wallet, Moneris handles PCI-scope
//   4. On approval: /verify marks the order paid → this page flips to a
//      success view
//   5. Staff's mobile app polls order status separately and moves to
//      OrderPaidScreen on its side
//
// Intentionally does NOT reuse /pay/[orderId] (which is the older GP
// Drop-in page). Kept separate so the mobile POS flow evolves without
// touching the web-POS/customer-driven flow.

import { Suspense, use, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import MonerisOrderCheckoutSection from "./MonerisOrderCheckoutSection";

type PayStatus = "PENDING" | "COMPLETED" | "PROCESSING" | "FAILED" | "CANCELLED" | "REFUNDED" | "PARTIALLY_REFUNDED";

interface OrderInfo {
  id: string;
  orderNumber: string;
  displayNumber: number | null;
  currency: string;
  amountCents: number;   // remaining balance, not order.total
  paymentStatus: PayStatus;
  status: string;
  tenantName: string;
}

export default function PayOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  return (
    <Suspense fallback={<Fallback />}>
      <Inner params={params} />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-600 border-t-transparent" />
    </div>
  );
}

function Inner({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [paidJustNow, setPaidJustNow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/pay/order/${orderId}/info`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;
        setOrder(data.order);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  if (loading) return <Fallback />;

  if (error || !order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
            <Icon icon="solar:danger-triangle-bold" className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">
            We couldn&apos;t open this payment link
          </h1>
          <p className="text-sm text-gray-500">
            {error || "The order was not found. Ask the cashier for a new link."}
          </p>
        </div>
      </div>
    );
  }

  const isPaid = paidJustNow || order.paymentStatus === "COMPLETED";
  const amountLabel = formatAmount(order.amountCents, order.currency);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-lg font-semibold text-gray-900">{order.tenantName}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Order #{order.displayNumber ?? order.orderNumber}
          </p>
          <div className="mt-4 text-3xl font-bold text-emerald-700">{amountLabel}</div>
        </div>

        {isPaid ? (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 mx-auto mb-4 flex items-center justify-center">
              <Icon icon="solar:check-circle-bold" className="w-9 h-9 text-emerald-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Payment received</h2>
            <p className="text-sm text-gray-500">
              You can close this page — your receipt is on the way.
            </p>
          </div>
        ) : (
          <MonerisOrderCheckoutSection
            orderId={order.id}
            amountLabel={amountLabel}
            onPaid={() => setPaidJustNow(true)}
          />
        )}

        <p className="text-center text-xs text-gray-400 mt-4">
          Powered by Oreugo · Card handled securely by Moneris
        </p>
      </div>
    </div>
  );
}

function formatAmount(cents: number, currency: string): string {
  const whole = Math.floor(cents / 100);
  const rem = (cents % 100).toString().padStart(2, "0");
  const symbol =
    currency === "CAD" || currency === "USD"
      ? "$"
      : currency === "GBP"
      ? "£"
      : currency === "EUR"
      ? "€"
      : `${currency} `;
  return `${symbol}${whole}.${rem}`;
}
