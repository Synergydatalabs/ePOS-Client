"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import DropInCheckout from "@/components/pay/DropInCheckout";
import WalletButtons from "@/components/pay/WalletButtons";

interface OrderPayment {
  id: string;
  orderNumber: string;
  displayNumber: number;
  total: number;
  subtotal: number;
  taxAmount: number;
  tax2Amount: number;
  tipAmount: number;
  currency: string;
  paymentStatus: string;
  paymentMethod: string;
  location?: {
    name: string;
    tenant?: {
      name: string;
    };
  };
}

export default function OrderPaymentPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const router = useRouter();

  const [order, setOrder] = useState<OrderPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!orderId) {
      setError("No order specified");
      setLoading(false);
      return;
    }

    try {
      // Public API endpoint for order payment status
      const response = await fetch(`/api/pay/${orderId}`);
      const data = await response.json();

      if (data.success) {
        setOrder(data.order);

        // Check if paid
        if (data.order.paymentStatus === "COMPLETED") {
          setIsPaid(true);
          setShowSuccess(true);
        }
      } else {
        setError(data.error || "Order not found");
      }
    } catch (err) {
      setError("Failed to load order");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchOrder();

    // Poll for payment status every 3 seconds
    const interval = setInterval(() => {
      if (!isPaid) {
        fetchOrder();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchOrder, isPaid]);

  const formatCurrency = (amount: number, currency: string = "CAD") => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const handleClose = () => {
    window.close();
    // Fallback if window.close() doesn't work
    router.push("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-600 to-cyan-600 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-white border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-600 to-cyan-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center">
          <Icon icon="solar:danger-triangle-bold" className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Error</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={handleClose}
            className="px-6 py-2 rounded-xl font-semibold text-white bg-gray-900 hover:bg-gray-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Payment Success Screen
  if (showSuccess && order) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center">
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6 animate-bounce">
            <Icon icon="solar:check-circle-bold" className="w-16 h-16 text-green-600" />
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-2">Payment Complete!</h1>
          <p className="text-gray-600 mb-6">Thank you for your purchase</p>

          <div className="bg-gray-50 rounded-2xl p-6 mb-6">
            <p className="text-sm text-gray-500 mb-1">Amount Paid</p>
            <p className="text-4xl font-bold text-gray-900">
              {formatCurrency(order.total, order.currency)}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Order #{order.displayNumber}
            </p>
          </div>

          <button
            onClick={handleClose}
            className="w-full py-3 rounded-xl font-semibold text-white bg-gray-900 hover:bg-gray-800 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // Payment Page
  if (order) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-600 to-cyan-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full">
          {/* Business Name */}
          {order.location?.tenant && (
            <div className="text-center mb-6">
              <p className="text-sm text-gray-500">Payment to</p>
              <p className="text-xl font-bold text-gray-900">{order.location.tenant.name}</p>
              {order.location.name && (
                <p className="text-sm text-gray-500">{order.location.name}</p>
              )}
            </div>
          )}

          {/* Order Number */}
          <div className="text-center mb-4">
            <span className="inline-block px-4 py-1 bg-teal-100 text-teal-700 rounded-full text-sm font-medium">
              Order #{order.displayNumber}
            </span>
          </div>

          {/* Amount */}
          <div className="text-center mb-6">
            <p className="text-sm text-gray-500">Amount Due</p>
            <p className="text-5xl font-bold text-gray-900">
              {formatCurrency(order.total, order.currency)}
            </p>
            {order.tipAmount > 0 && (
              <p className="text-sm text-teal-600 mt-1">
                Includes {formatCurrency(order.tipAmount, order.currency)} tip
              </p>
            )}
          </div>

          {/* Payment Status */}
          <div className="text-center mb-6">
            {order.paymentStatus === "PENDING" ? (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 rounded-full">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                <span className="font-medium">Awaiting Payment</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-full">
                <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
                <span className="font-medium">Paid</span>
              </div>
            )}
          </div>

          {/* Order Details */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm mb-6">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{formatCurrency(order.subtotal, order.currency)}</span>
            </div>
            {order.taxAmount > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Tax</span>
                <span>{formatCurrency(order.taxAmount, order.currency)}</span>
              </div>
            )}
            {order.tax2Amount > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Tax 2</span>
                <span>{formatCurrency(order.tax2Amount, order.currency)}</span>
              </div>
            )}
            {order.tipAmount > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Tip</span>
                <span>{formatCurrency(order.tipAmount, order.currency)}</span>
              </div>
            )}
            <div className="h-px bg-gray-200" />
            <div className="flex justify-between font-semibold text-gray-900">
              <span>Total</span>
              <span>{formatCurrency(order.total, order.currency)}</span>
            </div>
          </div>

          {/* Payment area — wallet buttons + Drop-in card form */}
          {order.paymentStatus === "PENDING" && (
            <div className="space-y-3">
              <p className="text-center text-sm text-gray-500 mb-4">
                Pay securely with Apple Pay, Google Pay, or your card
              </p>

              {/* Wallet buttons (auto-detected per device) */}
              <WalletButtons
                amount={order.total}
                currency={order.currency}
                onWalletToken={async (paymentReference, walletType) => {
                  // Wallet succeeded — process the sale via our existing endpoint
                  try {
                    const res = await fetch("/api/payments/dropin/process-sale", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        paymentReference,
                        walletType, // "APPLEPAY" | "PAY_BY_GOOGLE"
                        amount: order.total,
                        currency: order.currency,
                        orderId: order.id,
                      }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      setIsPaid(true);
                      setShowSuccess(true);
                    } else {
                      alert(data.error || "Payment failed");
                    }
                  } catch (err: any) {
                    alert(err?.message || "Payment failed");
                  }
                }}
                onFallback={() => {
                  document.getElementById("dropin-form-anchor")?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }}
              />

              {/* Drop-in card form */}
              <div id="dropin-form-anchor">
                <DropInCheckout
                  orderId={order.id}
                  amount={order.total}
                  currency={order.currency}
                  description={`Order ${order.orderNumber}`}
                  onSuccess={() => {
                    setIsPaid(true);
                    setShowSuccess(true);
                  }}
                />
              </div>
            </div>
          )}

          {/* Powered by */}
          <div className="mt-6 text-center">
            <p className="text-xs text-gray-400">
              Secure checkout · Powered by <span className="font-semibold">Global Payments</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
