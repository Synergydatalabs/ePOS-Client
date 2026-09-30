"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import DropInCheckout from "@/components/pay/DropInCheckout";
import WalletButtons from "@/components/pay/WalletButtons";
import BrandPanel from "@/components/pay/BrandPanel";

interface OrderItem {
  id: string;
  productName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  modifiersTotal: number;
  itemTotal: number;
  modifiers: { modifierName: string; price: number }[];
}

interface Order {
  id: string;
  orderNumber: string;
  displayNumber: number;
  status: string;
  paymentStatus: string;
  subtotal: number;
  taxAmount: number;
  tax2Amount?: number;
  tipAmount: number;
  total: number;
  currency: string;
  items: OrderItem[];
}

interface Settings {
  tipEnabled: boolean;
  tipPresets: number[];
  tipCustomEnabled: boolean;
  taxLabel: string;
  tax2Label?: string;
}

type PaymentMethod = "card" | "apple_pay" | "google_pay" | "qr";

export default function TablePaymentPage() {
  const params = useParams();
  const router = useRouter();
  const qrCode = params.qrCode as string;
  const orderId = params.orderId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tenantInfo, setTenantInfo] = useState<{
    id: string;
    name: string | null;
    logoUrl: string | null;
  } | null>(null);
  const [selectedTip, setSelectedTip] = useState<number | "custom" | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [processing, setProcessing] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);

  // Card form state
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardName, setCardName] = useState("");

  // Detect if Apple Pay or Google Pay is available
  const [applePayAvailable, setApplePayAvailable] = useState(false);
  const [googlePayAvailable, setGooglePayAvailable] = useState(false);

  // Brand the "Powered by …" footer.  Oreugo is a Global Payments partner
  // and wants GP attribution; on every other host (iTap proper) we display
  // iTap even though GP is still doing the processing under the hood.
  const [poweredBy, setPoweredBy] = useState("iTap");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname.toLowerCase();
    setPoweredBy(host.includes("oreugo") ? "Global Payments" : "iTap");
  }, []);

  // Get guest token from storage
  const getGuestToken = useCallback(() => {
    return localStorage.getItem(`tap_guest_${qrCode}`);
  }, [qrCode]);

  // Check for mobile payment availability
  useEffect(() => {
    // Check for Apple Pay (Safari on iOS/macOS)
    if (typeof window !== "undefined") {
      // @ts-ignore
      if (window.ApplePaySession && window.ApplePaySession.canMakePayments()) {
        setApplePayAvailable(true);
      }

      // Check for Google Pay (Chrome on Android)
      const isAndroid = /Android/i.test(navigator.userAgent);
      const isChrome = /Chrome/i.test(navigator.userAgent);
      if (isAndroid && isChrome) {
        setGooglePayAvailable(true);
      }
    }
  }, []);

  // Load order details
  const loadOrder = useCallback(async () => {
    const guestToken = getGuestToken();
    if (!guestToken) {
      setError("Session expired. Please scan the QR code again.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/table/${qrCode}/pay/${orderId}`, {
        headers: { "x-guest-token": guestToken },
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || "Order not found");
        return;
      }

      setOrder(data.order);
      setSettings(data.settings);
      if (data.tenant) setTenantInfo(data.tenant);

      // Check if already paid
      if (data.order.paymentStatus === "COMPLETED") {
        setPaymentComplete(true);
      }
    } catch (err) {
      setError("Failed to load order");
    } finally {
      setLoading(false);
    }
  }, [qrCode, orderId, getGuestToken]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // Poll for payment status (for QR code payments)
  useEffect(() => {
    if (paymentMethod === "qr" && !paymentComplete) {
      const interval = setInterval(loadOrder, 3000);
      return () => clearInterval(interval);
    }
  }, [paymentMethod, paymentComplete, loadOrder]);

  // Calculate tip amount. When POS pre-set a tip on the order
  // (Phase 8 QA), we use THAT and skip the picker entirely — the
  // finalTotal has to include the pre-set tip or the customer would
  // pay less than what the POS captured.
  const tipAmount = (() => {
    if (!order) return 0;
    if (order.tipAmount > 0) return order.tipAmount;
    if (selectedTip === "custom") {
      const tip = parseFloat(customTip);
      return isNaN(tip) ? 0 : Math.round(tip * 100);
    }
    if (typeof selectedTip === "number") {
      return Math.round((order.subtotal * selectedTip) / 100);
    }
    return 0;
  })();

  // Calculate final total
  const finalTotal = order
    ? order.subtotal + order.taxAmount + (order.tax2Amount || 0) + tipAmount
    : 0;

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: order?.currency || "CAD",
    }).format(amount / 100);
  };

  // Format card number with spaces
  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, "").replace(/[^0-9]/gi, "");
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || "";
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    return parts.length ? parts.join(" ") : v;
  };

  // Format expiry date
  const formatExpiry = (value: string) => {
    const v = value.replace(/\s+/g, "").replace(/[^0-9]/gi, "");
    if (v.length >= 2) {
      return v.substring(0, 2) + "/" + v.substring(2, 4);
    }
    return v;
  };

  // Process payment
  const processPayment = async () => {
    const guestToken = getGuestToken();
    if (!guestToken || !order) return;

    // Validate card details if card payment
    if (paymentMethod === "card") {
      if (cardNumber.replace(/\s/g, "").length < 16) {
        toast.error("Please enter a valid card number");
        return;
      }
      if (cardExpiry.length < 5) {
        toast.error("Please enter a valid expiry date");
        return;
      }
      if (cardCvc.length < 3) {
        toast.error("Please enter a valid CVC");
        return;
      }
    }

    setProcessing(true);
    try {
      const res = await fetch(`/api/table/${qrCode}/pay/${orderId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-guest-token": guestToken,
        },
        body: JSON.stringify({
          method: paymentMethod === "card" ? "CARD" : paymentMethod === "apple_pay" ? "APPLE_PAY" : paymentMethod === "google_pay" ? "GOOGLE_PAY" : "QR",
          tipAmount,
          // In production, you would tokenize the card details before sending
          // For demo, we just simulate the payment
        }),
      });

      const data = await res.json();
      if (data.success) {
        setPaymentComplete(true);
        toast.success("Payment successful!");
      } else {
        toast.error(data.error || "Payment failed");
      }
    } catch (err) {
      toast.error("Payment failed");
    } finally {
      setProcessing(false);
    }
  };

  // Apple Pay / Google Pay are handled natively by the Drop-in UI when
  // enabled on the GP merchant account. No separate handlers needed —
  // user taps the single "Pay" button which opens the Drop-in form.

  // Return to menu with order status
  const returnToMenu = () => {
    router.push(`/table/${qrCode}?orderStatus=${order?.displayNumber}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Icon
            icon="solar:loading-bold"
            className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4"
          />
          <p className="text-gray-500">Loading payment...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <Icon
            icon="solar:danger-triangle-bold"
            className="w-16 h-16 text-red-400 mx-auto mb-4"
          />
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Error</h1>
          <p className="text-gray-500 mb-4">{error}</p>
          <button
            onClick={() => router.push(`/table/${qrCode}`)}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Back to Menu
          </button>
        </div>
      </div>
    );
  }

  // Payment Success Screen
  if (paymentComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-500 to-emerald-600 p-4">
        <div className="text-center max-w-sm bg-white rounded-3xl p-8 shadow-2xl">
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
            <Icon
              icon="solar:check-circle-bold"
              className="w-16 h-16 text-green-500"
            />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Payment Successful!
          </h1>
          <p className="text-gray-500 mb-2">
            Your order #{order?.displayNumber} has been sent to the kitchen.
          </p>
          <p className="text-lg font-semibold text-green-600 mb-6">
            {formatPrice(finalTotal)}
          </p>

          {/* Order Status Card */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-center gap-2 text-amber-600">
              <Icon icon="solar:chef-hat-bold" className="w-5 h-5" />
              <span className="font-medium">Being Prepared</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Your order is now being prepared by the kitchen
            </p>
          </div>

          <button
            onClick={returnToMenu}
            className="w-full py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 active:bg-indigo-800"
          >
            Order More
          </button>
        </div>
      </div>
    );
  }

  // QR Code Payment View
  if (paymentMethod === "qr") {
    const paymentUrl = typeof window !== "undefined"
      ? `${window.location.origin}/pay/${orderId}`
      : "";

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white shadow-sm sticky top-0 z-40">
          <div className="px-4 py-4 flex items-center gap-3">
            <button
              onClick={() => setPaymentMethod(null)}
              className="p-2 -ml-2 hover:bg-gray-100 rounded-lg"
            >
              <Icon icon="solar:arrow-left-linear" className="w-6 h-6 text-gray-600" />
            </button>
            <div>
              <h1 className="font-semibold text-gray-900">Scan to Pay</h1>
              <p className="text-sm text-gray-500">Order #{order?.displayNumber}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-8 shadow-lg max-w-sm w-full">
            <div className="text-center mb-6">
              <p className="text-sm text-gray-500">Amount Due</p>
              <p className="text-4xl font-bold text-gray-900">{formatPrice(finalTotal)}</p>
            </div>

            <div className="bg-gray-50 rounded-2xl p-6 flex items-center justify-center mb-6">
              <QRCodeSVG
                value={paymentUrl}
                size={200}
                level="H"
                includeMargin
              />
            </div>

            <p className="text-center text-gray-500 text-sm mb-4">
              Scan this QR code with your phone's camera or payment app to complete the payment
            </p>

            <div className="flex items-center justify-center gap-2 text-amber-600">
              <Icon icon="solar:loading-bold" className="w-5 h-5 animate-spin" />
              <span className="text-sm font-medium">Waiting for payment...</span>
            </div>
          </div>

          <button
            onClick={() => setPaymentMethod(null)}
            className="mt-6 text-gray-500 hover:text-gray-700"
          >
            Use a different payment method
          </button>
        </main>
      </div>
    );
  }

  // Card / Wallet Payment — Global Payments Drop-in UI
  if (paymentMethod === "card") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pb-12">
        <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40">
          <div className="px-4 py-4 flex items-center gap-3 max-w-6xl mx-auto">
            <button
              onClick={() => setPaymentMethod(null)}
              className="p-2 -ml-2 rounded-xl text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition"
            >
              <Icon icon="solar:arrow-left-linear" className="w-6 h-6" />
            </button>
            <div className="flex-1">
              <h1 className="font-bold text-slate-900 text-lg">Secure Payment</h1>
              <p className="text-xs text-slate-500">Order #{order?.displayNumber}</p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
              <Icon icon="solar:lock-keyhole-bold" className="w-3.5 h-3.5" />
              SSL
            </div>
          </div>
        </header>

        <div className="p-4 lg:px-8 lg:py-8 max-w-xl lg:max-w-6xl mx-auto">
          <div className="lg:grid lg:grid-cols-5 lg:gap-8 lg:items-start">
            {/* LEFT (mobile: full width) — payment column */}
            <main className="space-y-4 lg:col-span-3">
              {/* Amount — hero card */}
              <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-700 rounded-3xl p-6 text-white shadow-xl shadow-indigo-200/50">
                <div className="absolute -top-12 -right-12 w-40 h-40 bg-white/10 rounded-full" />
                <div className="absolute -bottom-8 -left-8 w-28 h-28 bg-white/5 rounded-full" />
                <div className="relative text-center">
                  <p className="text-sm text-indigo-100 font-medium tracking-wider uppercase">Amount to Pay</p>
                  <p className="text-5xl font-extrabold mt-2 tracking-tight">{formatPrice(finalTotal)}</p>
                </div>
              </div>

              {/* Drop-in Checkout — card, Apple Pay, Google Pay.
                  Wrapped in max-w-md so GP's widget renders at the width
                  its CSS was designed for; without this, on a wider
                  desktop column the Expiration/CVV row drifts apart and
                  the labels misalign. */}
              <div className="bg-white rounded-2xl p-5 shadow-lg shadow-slate-200/60 border border-slate-100">
                <div className="max-w-md mx-auto">
                  <DropInCheckout
                    orderId={orderId}
                    amount={finalTotal}
                    currency={order?.currency || "CAD"}
                    description={order ? `Order ${order.orderNumber}` : undefined}
                    onSuccess={() => {
                      setPaymentComplete(true);
                      toast.success("Payment successful!");
                    }}
                  />
                </div>
              </div>

              {/* Trust badges — mobile only, desktop has the side panel */}
              <div className="lg:hidden flex items-center justify-center gap-4 py-3">
                <div className="flex items-center gap-1.5 text-slate-500 text-xs font-medium">
                  <Icon icon="solar:shield-check-bold" className="w-4 h-4 text-emerald-500" />
                  <span>256-bit encryption</span>
                </div>
                <div className="w-1 h-1 bg-slate-300 rounded-full" />
                <div className="flex items-center gap-1.5 text-slate-500 text-xs font-medium">
                  <Icon icon="solar:card-search-bold" className="w-4 h-4 text-emerald-500" />
                  <span>PCI compliant</span>
                </div>
              </div>

              {/* Powered by — mobile only */}
              <p className="lg:hidden text-center text-xs text-slate-400">
                Powered by <span className="font-semibold text-slate-600">{poweredBy}</span>
              </p>
            </main>

            {/* RIGHT (desktop only) — brand panel */}
            <div className="lg:col-span-2 lg:sticky lg:top-24">
              <BrandPanel
                isPartner={poweredBy === "Global Payments"}
                tenantName={tenantInfo?.name}
                tenantLogoUrl={tenantInfo?.logoUrl}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main Payment Method Selection
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pb-32">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40">
        <div className="px-4 py-4 flex items-center gap-3 max-w-6xl mx-auto">
          <button
            onClick={() => router.push(`/table/${qrCode}`)}
            className="p-2 -ml-2 rounded-xl text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition"
          >
            <Icon icon="solar:arrow-left-linear" className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-slate-900 text-lg">Checkout</h1>
            <p className="text-xs text-slate-500">Order #{order?.displayNumber}</p>
          </div>
        </div>
      </header>

      <div className="p-4 lg:px-8 lg:py-8 max-w-xl lg:max-w-6xl mx-auto">
        <div className="lg:grid lg:grid-cols-5 lg:gap-8 lg:items-start">
          {/* LEFT (mobile: full width) — payment column */}
          <main className="space-y-4 lg:col-span-3">
        {/* Order Summary */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <Icon icon="solar:bag-3-bold" className="w-5 h-5 text-indigo-500" />
            <h2 className="font-bold text-slate-900">Order Summary</h2>
          </div>
          <div className="space-y-2.5 max-h-44 overflow-y-auto">
            {order?.items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-slate-600">
                  <span className="inline-flex w-6 h-6 items-center justify-center rounded-md bg-slate-100 text-slate-700 text-xs font-semibold mr-2">
                    {item.quantity}
                  </span>
                  {item.productName}
                </span>
                <span className="text-slate-900 font-semibold">{formatPrice(item.itemTotal)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tip Selection — hidden when POS pre-set a tip on the order
            (Phase 8 QA). The staff already picked the tip amount at the
            terminal, so the customer sees a confirmed line instead of
            being asked twice. */}
        {settings?.tipEnabled && !(order && order.tipAmount > 0) && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 mb-3">
              <Icon icon="solar:hand-money-bold" className="w-5 h-5 text-amber-500" />
              <h2 className="font-bold text-slate-900">Add a Tip</h2>
              <span className="ml-auto text-xs text-slate-400">Optional</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2.5">
              {settings.tipPresets.map((percent) => (
                <button
                  key={percent}
                  onClick={() => {
                    setSelectedTip(percent);
                    setCustomTip("");
                  }}
                  className={`py-3.5 rounded-xl border-2 font-medium transition-all ${
                    selectedTip === percent
                      ? "border-indigo-500 bg-gradient-to-br from-indigo-50 to-purple-50 text-indigo-700 shadow-sm scale-[1.02]"
                      : "border-slate-200 text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <span className="block text-xl font-bold">{percent}%</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    {formatPrice(Math.round((order!.subtotal * percent) / 100))}
                  </span>
                </button>
              ))}
            </div>

            {selectedTip === "custom" ? (
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-medium">$</span>
                <input
                  type="number"
                  value={customTip}
                  onChange={(e) => setCustomTip(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className="w-full pl-8 pr-4 py-3 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-medium"
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setSelectedTip("custom")}
                className="w-full py-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50 font-medium text-sm transition"
              >
                Custom Amount
              </button>
            )}

            {selectedTip !== null && (
              <button
                onClick={() => {
                  setSelectedTip(null);
                  setCustomTip("");
                }}
                className="w-full mt-2 py-2 text-xs text-slate-400 hover:text-slate-600 transition"
              >
                Skip tip
              </button>
            )}
          </div>
        )}

        {/* Total */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Subtotal</span>
              <span className="font-medium">{formatPrice(order?.subtotal || 0)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>{settings?.taxLabel || "Tax"}</span>
              <span className="font-medium">{formatPrice(order?.taxAmount || 0)}</span>
            </div>
            {order?.tax2Amount && order.tax2Amount > 0 && (
              <div className="flex justify-between text-sm text-slate-600">
                <span>{settings?.tax2Label || "Tax 2"}</span>
                <span className="font-medium">{formatPrice(order.tax2Amount)}</span>
              </div>
            )}
            {tipAmount > 0 && (
              <div className="flex justify-between text-sm text-indigo-600">
                <span className="font-medium">Tip</span>
                <span className="font-semibold">{formatPrice(tipAmount)}</span>
              </div>
            )}
            <div className="pt-3 mt-1 border-t border-slate-100 flex justify-between items-baseline">
              <span className="text-base font-semibold text-slate-700">Total</span>
              <span className="text-2xl font-extrabold text-slate-900 tracking-tight">{formatPrice(finalTotal)}</span>
            </div>
          </div>
        </div>

        {/* Payment Methods */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <Icon icon="solar:wallet-bold" className="w-5 h-5 text-emerald-500" />
            <h2 className="font-bold text-slate-900">Payment Method</h2>
          </div>
          <div className="space-y-3">
            {/* Wallet buttons (auto-detected per device — fall back to card form for now) */}
            <WalletButtons
              amount={finalTotal}
              currency={order?.currency || "CAD"}
              onWalletToken={async (paymentReference, walletType) => {
                if (!order?.id) return;
                try {
                  const res = await fetch("/api/payments/dropin/process-sale", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      paymentReference,
                      walletType,
                      amount: finalTotal,
                      currency: order.currency || "CAD",
                      orderId: order.id,
                    }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    toast.success("Payment successful");
                    router.refresh();
                  } else {
                    toast.error(data.error || "Payment failed");
                  }
                } catch (err: any) {
                  toast.error(err?.message || "Payment failed");
                }
              }}
              onFallback={() => setPaymentMethod("card")}
            />

            {/* Main pay button → opens Drop-in card form */}
            <button
              onClick={() => setPaymentMethod("card")}
              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.99] shadow-lg shadow-indigo-200/60 transition-all"
            >
              <Icon icon="solar:card-bold" className="w-5 h-5" />
              Pay with Card · {formatPrice(finalTotal)}
            </button>

            {/* QR Code Payment (alt flow — show QR for someone else to scan) */}
            <button
              onClick={() => setPaymentMethod("qr")}
              className="w-full py-2.5 text-slate-500 hover:text-slate-700 font-medium rounded-xl flex items-center justify-center gap-2 text-sm transition"
            >
              <Icon icon="solar:qr-code-bold" className="w-4 h-4" />
              Show QR code instead
            </button>
          </div>
        </div>

            {/* Trust footer — mobile only, desktop has the side panel */}
            <div className="lg:hidden pt-2 space-y-1.5">
              <div className="flex items-center justify-center gap-2 text-slate-500 text-xs">
                <Icon icon="solar:shield-check-bold" className="w-4 h-4 text-emerald-500" />
                <span>Secure checkout · 256-bit encryption</span>
              </div>
              <p className="text-center text-xs text-slate-400">
                Powered by <span className="font-semibold text-slate-600">{poweredBy}</span>
              </p>
            </div>
          </main>

          {/* RIGHT (desktop only) — brand panel */}
          <div className="lg:col-span-2 lg:sticky lg:top-24">
            <BrandPanel
              isPartner={poweredBy === "Global Payments"}
              tenantName={tenantInfo?.name}
              tenantLogoUrl={tenantInfo?.logoUrl}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
