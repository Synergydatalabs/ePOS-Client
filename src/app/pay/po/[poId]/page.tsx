"use client";

// Public checkout page for a supplier PO.
//
// Rendered when the merchant clicks the payment link / scans the QR generated
// at PO submit time.
//
// Branch on ?processor= query param:
//   • GP        → mount GpCheckoutSection (real card + Apple/Google Pay via GP Drop-In)
//   • MONERIS   → mount MonerisCheckoutSection (Moneris Checkout hosted widget)
//   • (absent)  → mock card form that calls /api/pay/po/[id]/mock-pay to flip
//                 the PO to PAID. Demo / sandbox fallback only.
//
// Mark-paid state transition is identical across processors — all three
// flows end up calling the same /mock-pay endpoint (misnomer kept for URL
// stability; it IS the "mark PO paid" endpoint).

import { Suspense, use, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import MonerisCheckoutSection from "./MonerisCheckoutSection";
import GpCheckoutSection from "./GpCheckoutSection";

type PaymentStatus = "UNPAID" | "PENDING" | "PAID" | "FAILED" | "REFUNDED";

interface PoInfo {
  id: string;
  poNumber: string;
  currency: string;
  amountCents: number;
  paymentStatus: PaymentStatus;
  expired: boolean;
  supplierName: string;
  brand: {
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  };
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-900 border-t-transparent" />
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
  const processor = (searchParams.get("processor") || "").toUpperCase();
  const isMoneris = processor === "MONERIS";
  const isGp = processor === "GP";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [po, setPo] = useState<PoInfo | null>(null);
  const [paying, setPaying] = useState(false);
  const [paidJustNow, setPaidJustNow] = useState(false);

  // Mock-mode card fields — not sent anywhere, purely UX theater for the
  // demo-fallback branch. Hidden entirely in the GP / Moneris branches.
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-900 border-t-transparent" />
      </div>
    );
  }

  if (error || !po) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
            <Icon icon="solar:danger-triangle-bold" className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Can't open payment</h1>
          <p className="text-slate-500 text-sm">{error || "This link isn't valid."}</p>
          <p className="text-slate-400 text-xs mt-4">
            Ask the supplier for a fresh payment link.
          </p>
        </div>
      </div>
    );
  }

  if (po.paymentStatus === "PAID") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 mx-auto mb-4 flex items-center justify-center">
            <Icon icon="solar:check-circle-bold" className="w-9 h-9 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">
            {paidJustNow ? "Payment successful!" : "This PO is paid"}
          </h1>
          <p className="text-slate-500 text-sm mb-6">
            {paidJustNow
              ? `Thank you. A receipt has been emailed. You can close this window.`
              : `${po.supplierName} has already received payment for this order.`}
          </p>
          <div className="p-4 rounded-xl bg-slate-50 text-left space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">PO number</span>
              <span className="font-mono font-semibold text-slate-900">{po.poNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Supplier</span>
              <span className="text-slate-900">{po.supplierName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Amount</span>
              <span className="font-semibold text-slate-900">
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-100 mx-auto mb-4 flex items-center justify-center">
            <Icon icon="solar:clock-circle-bold" className="w-7 h-7 text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Payment link expired</h1>
          <p className="text-slate-500 text-sm">
            This payment link is no longer valid. Ask <strong>{po.supplierName}</strong>{" "}
            for a fresh one.
          </p>
        </div>
      </div>
    );
  }

  // ---------- main checkout view ----------

  // Brand palette with sensible fallbacks. Primary drives the gradient
  // header + pay button; accent is a secondary highlight. Both fall back
  // to a neutral slate when the supplier hasn't set brand colours.
  const primary = po.brand.primaryColor || "#0F172A";    // slate-900
  const accent = po.brand.accentColor || "#4F46E5";      // indigo-600
  const initials = po.supplierName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "·";

  const processorFooter =
    isGp ? "Powered by Global Payments"
    : isMoneris ? "Powered by Moneris"
    : "Secure checkout";

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Branded hero band — supplier primary colour as the backdrop so the
           page feels merchant-fronted. Keeps consistent height whether or
           not a logo is provided. */}
      <header
        className="relative pt-10 pb-24 px-4"
        style={{
          background: `linear-gradient(135deg, ${primary} 0%, ${primary}EE 60%, ${primary}CC 100%)`,
        }}
      >
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='2' cy='2' r='1' fill='white'/%3E%3C/svg%3E\")",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative max-w-md mx-auto text-center">
          {/* Logo tile — real image if the supplier provided one, otherwise
               a tasteful initials-in-circle fallback that uses the accent
               colour so it never looks like a bug. */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg mb-4 overflow-hidden">
            {po.brand.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={po.brand.logoUrl}
                alt={po.supplierName}
                className="w-full h-full object-contain p-2"
                onError={(e) => {
                  // On image load error, swap to the initials fallback
                  const el = e.currentTarget as HTMLImageElement;
                  el.style.display = "none";
                  if (el.nextElementSibling) {
                    (el.nextElementSibling as HTMLElement).style.display = "flex";
                  }
                }}
              />
            ) : null}
            <div
              className={`w-full h-full ${po.brand.logoUrl ? "hidden" : "flex"} items-center justify-center text-xl font-extrabold text-white`}
              style={{
                background: `linear-gradient(135deg, ${accent} 0%, ${primary} 100%)`,
              }}
            >
              {initials}
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white">Pay {po.supplierName}</h1>
          <p className="text-sm text-white/70 mt-1 font-mono">PO {po.poNumber}</p>
        </div>
      </header>

      {/* Body — pulled up to overlap the hero's bottom edge for depth. */}
      <main className="max-w-md mx-auto px-4 -mt-16 pb-10">
        {/* Amount card */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-4">
          <div className="text-center">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1">
              Amount due
            </p>
            <p className="text-4xl font-bold text-slate-900">
              {money(po.amountCents, po.currency)}
            </p>
          </div>
        </div>

        {/* Checkout body — one of three branches based on ?processor= */}
        {isGp ? (
          <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
            <GpCheckoutSection
              poId={poId}
              ref_={ref}
              amountCents={po.amountCents}
              currency={po.currency}
              merchantName={po.supplierName}
              description={`PO ${po.poNumber}`}
              onPaid={() => {
                setPo({ ...po, paymentStatus: "PAID" });
                setPaidJustNow(true);
              }}
            />
          </div>
        ) : isMoneris ? (
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
            {/* Mock card form — demo / fallback only. */}
            <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  Card number
                </label>
                <input
                  type="text"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="1234 5678 9012 3456"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                    Expiry
                  </label>
                  <input
                    type="text"
                    value={cardExpiry}
                    onChange={(e) => setCardExpiry(e.target.value)}
                    placeholder="MM/YY"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                    CVV
                  </label>
                  <input
                    type="text"
                    value={cardCvv}
                    onChange={(e) => setCardCvv(e.target.value)}
                    placeholder="123"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  Name on card
                </label>
                <input
                  type="text"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 mb-4 flex items-start gap-2">
              <Icon icon="solar:info-circle-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Demo mode.</strong> No real card details are sent anywhere.
                Clicking Pay marks the PO as paid for testing.
              </span>
            </div>

            <button
              onClick={submitPayment}
              disabled={paying}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl text-white font-semibold text-base hover:opacity-95 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
              style={{ backgroundColor: primary }}
            >
              <Icon icon="solar:lock-keyhole-bold" className="w-5 h-5" />
              {paying ? "Processing…" : `Pay ${money(po.amountCents, po.currency)}`}
            </button>
          </>
        )}

        {/* Trust row — compact, read-only. SSL + processor badge. */}
        <div className="mt-6 flex items-center justify-center gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <Icon icon="solar:shield-check-bold-duotone" className="w-4 h-4 text-emerald-600" />
            SSL encrypted
          </span>
          <span className="w-px h-3 bg-slate-200" />
          <span className="flex items-center gap-1.5">
            <Icon icon="solar:lock-keyhole-bold-duotone" className="w-4 h-4" />
            PCI-DSS compliant
          </span>
        </div>

        {/* Processor-aware footer — states the gateway handling the charge
             so the payer can match the statement descriptor + know who to
             contact for refunds. */}
        <p className="text-center text-xs text-slate-400 mt-4">{processorFooter}</p>
      </main>
    </div>
  );
}
