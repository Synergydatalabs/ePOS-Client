"use client";

// Public mock checkout page for a supplier PO.
//
// This is what the merchant lands on when they click the payment link
// (or scan the QR) generated at PO submit. It's intentionally minimal:
// PO number, supplier name, amount, a card-detail form (fake — nothing
// leaves the page), and a Pay button.
//
// When the payer clicks Pay, we call /api/pay/po/[poId]/mock-pay which
// marks the PO paid and fires the "you got paid" / "receipt" emails.
// Same landing endpoint as the real webhook (#68) — one code path for
// the state transition.
//
// When a real GP/Moneris integration ships, this page is replaced by a
// server-side redirect to the processor-hosted checkout. Until then this
// page IS the checkout for demo purposes.

import { Suspense, use, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import MonerisCheckoutSection from "./MonerisCheckoutSection";

type PaymentStatus = "UNPAID" | "PENDING" | "PAID" | "FAILED" | "REFUNDED";

interface PoInfo {
  id: string;
  poNumber: string;
  currency: string;
  amountCents: number;
  paymentStatus: PaymentStatus;
  expired: boolean;
  supplierName: string;
}

export default function PayPoPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  return (
    <Suspense fallback={<PageFallback />}>
      <PayPoPageInner params={params} />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent" />
    </div>
  );
}

function PayPoPageInner({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  const { poId } = use(params);
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref") || "";
  // ?processor=MONERIS switches the checkout body from the mock card
  // form to the Moneris Checkout hosted widget. Any other value (or
  // absent) keeps the existing mock flow — GP path stays untouched.
  const processor = (searchParams.get("processor") || "").toUpperCase();
  const isMoneris = processor === "MONERIS";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [po, setPo] = useState<PoInfo | null>(null);
  const [paying, setPaying] = useState(false);
  const [paidJustNow, setPaidJustNow] = useState(false);

  // Fake card fields — not sent anywhere, purely UX theater so the
  // mock checkout LOOKS real for demo.
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [cardExpiry, setCardExpiry] = useState("12/29");
  const [cardCvv, setCardCvv] = useState("123");
  const [cardName, setCardName] = useState("");

  useEffect(() => {
    if (!ref) {
      setError("Invalid payment link — missing reference.");
      setLoading(false);
      return;
    }
    fetch(`/api/pay/po/${poId}?ref=${encodeURIComponent(ref)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) {
          setError(data.error || "Invalid payment link");
        } else {
          setPo(data.po);
        }
      })
      .catch(() => setError("Failed to load payment page"))
      .finally(() => setLoading(false));
  }, [poId, ref]);

  const submitPayment = async () => {
    if (!po) return;
    setPaying(true);
    try {
      const res = await fetch(`/api/pay/po/${poId}/mock-pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Payment failed");
        return;
      }
      toast.success("Payment successful!");
      setPo({ ...po, paymentStatus: "PAID" });
      setPaidJustNow(true);
    } catch {
      toast.error("Payment failed");
    } finally {
      setPaying(false);
    }
  };

  const money = (cents: number, currency: string) =>
    `${currency} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  // ---------- render states ----------

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !po) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
            <Icon icon="solar:danger-triangle-bold" className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Can't open payment</h1>
          <p className="text-gray-500 text-sm">{error || "This link isn't valid."}</p>
          <p className="text-gray-400 text-xs mt-4">
            Ask the supplier for a fresh payment link.
          </p>
        </div>
      </div>
    );
  }

  if (po.paymentStatus === "PAID") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 mx-auto mb-4 flex items-center justify-center">
            <Icon icon="solar:check-circle-bold" className="w-9 h-9 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            {paidJustNow ? "Payment successful!" : "This PO is paid"}
          </h1>
          <p className="text-gray-500 text-sm mb-6">
            {paidJustNow
              ? `Thank you. A receipt has been emailed. You can close this window.`
              : `${po.supplierName} has already received payment for this order.`}
          </p>
          <div className="p-4 rounded-xl bg-gray-50 text-left space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">PO number</span>
              <span className="font-mono font-semibold text-gray-900">{po.poNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Supplier</span>
              <span className="text-gray-900">{po.supplierName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Amount</span>
              <span className="font-semibold text-gray-900">
                {money(po.amountCents, po.currency)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (po.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-100 mx-auto mb-4 flex items-center justify-center">
            <Icon icon="solar:clock-circle-bold" className="w-7 h-7 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Payment link expired</h1>
          <p className="text-gray-500 text-sm">
            This payment link is no longer valid. Ask <strong>{po.supplierName}</strong>{" "}
            for a fresh one.
          </p>
        </div>
      </div>
    );
  }

  // ---------- main checkout view ----------

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 mx-auto mb-3 flex items-center justify-center">
            <Icon icon="solar:card-bold" className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Pay {po.supplierName}</h1>
          <p className="text-sm text-gray-500 mt-1">PO {po.poNumber}</p>
        </div>

        {/* Amount summary */}
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
              Amount due
            </p>
            <p className="text-4xl font-bold text-gray-900">
              {money(po.amountCents, po.currency)}
            </p>
          </div>
        </div>

        {/* Moneris Checkout (real hosted checkout) — used when the
             payment link URL included ?processor=MONERIS. Everything
             below the amount summary is replaced with the MCO widget. */}
        {isMoneris ? (
          <MonerisCheckoutSection
            poId={poId}
            ref_={ref}
            amountLabel={money(po.amountCents, po.currency)}
            onPaid={() => {
              setPo({ ...po, paymentStatus: "PAID" });
              setPaidJustNow(true);
            }}
          />
        ) : (
        <>
        {/* Card form (fake — this is a mock) */}
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Card number
            </label>
            <input
              type="text"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="1234 5678 9012 3456"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Expiry
              </label>
              <input
                type="text"
                value={cardExpiry}
                onChange={(e) => setCardExpiry(e.target.value)}
                placeholder="MM/YY"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                CVV
              </label>
              <input
                type="text"
                value={cardCvv}
                onChange={(e) => setCardCvv(e.target.value)}
                placeholder="123"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Name on card
            </label>
            <input
              type="text"
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              placeholder="Your name"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
        </div>

        {/* Mock notice */}
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 mb-4 flex items-start gap-2">
          <Icon icon="solar:info-circle-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Demo mode.</strong> This is a mock checkout — no real card
            details are sent anywhere. Clicking Pay marks the PO as paid for
            testing. Real processor integration ships with the next release.
          </span>
        </div>

        {/* Pay button */}
        <button
          onClick={submitPayment}
          disabled={paying}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-gray-900 text-white font-semibold text-base hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Icon icon="solar:lock-keyhole-bold" className="w-5 h-5" />
          {paying ? "Processing…" : `Pay ${money(po.amountCents, po.currency)}`}
        </button>
        </>
        )}

        <p className="text-center text-xs text-gray-400 mt-4">
          Powered by iTap Marketplace
        </p>
      </div>
    </div>
  );
}
