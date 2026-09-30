"use client";

// ============================================================================
// /pay/demo — Persistent demo checkout page (for client demos / sales calls)
//
// 2026-05-21
//
// Purpose: a STABLE URL we can share with clients (or QR-code on a sales
// deck) that opens a working checkout without depending on a real Order row
// in the database. Real order links (e.g. /pay/[orderId]) become stale once
// the order is paid/cancelled/expired — this page never does.
//
// Three views (all in this single component, switched by `view` state):
//   1. CHECKOUT  — order summary + test cards + DropInCheckout
//   2. RECEIPT   — post-payment receipt with transaction details
//   3. STATUS    — mock order tracking timeline (Placed → Preparing → Ready)
//                  so clients see the full customer journey, not just payment
//
// Query params:
//   ?amount=NN       Demo amount in dollars (default $1.00)
//   ?desc=Some+Text  Line-item description (default "Demo Order")
//
// API reuse (NO new endpoints):
//   - DropInCheckout loads GP via /api/payments/dropin/access-token
//   - Charge POSTs to /api/payments/dropin/process-sale (already accepts
//     requests without an orderId — verified, no API change needed)
//
// Routing: /pay/* is already in middleware's public allowlist; Next.js
// prefers literal "demo" over the sibling [orderId] dynamic segment, so
// /pay/<uuid> still hits the real order page unchanged.
// ============================================================================

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@iconify/react";
import DropInCheckout from "@/components/pay/DropInCheckout";
import { usePartnerBranding } from "@/lib/use-partner-branding";

interface CompletedTx {
  transactionId?: string;
  authCode?: string;
  cardBrand?: string;
  cardLast4?: string;
  amount?: number;
  currency?: string;
}

type View = "checkout" | "receipt" | "status";

// ----------------------------------------------------------------------------
// GP sandbox test cards — these are the values published by Global Payments
// for sandbox testing. They will NOT work in production. We list a couple of
// each network so clients can pick what they recognize. Expiry / CVV / ZIP
// are generic placeholders that GP sandbox accepts.
// ----------------------------------------------------------------------------
const TEST_CARDS = [
  { brand: "Visa", number: "4263 9700 0000 5262", icon: "logos:visa" },
  { brand: "Mastercard", number: "5425 2300 0000 4415", icon: "logos:mastercard" },
  { brand: "Amex", number: "3741 0100 0000 608", icon: "logos:amex" },
  { brand: "Discover", number: "6011 0000 0000 0004", icon: "logos:discover" },
];

// PHASE 7d-fix (2026-05-21): Next.js 15 prerender requires useSearchParams
// to live inside a Suspense boundary, otherwise the static build of /pay/demo
// bails out with "missing-suspense-with-csr-bailout". The inner function
// holds the actual page; the default export below wraps it in <Suspense>.
function DemoCheckoutContent() {
  const searchParams = useSearchParams();
  const { branding, displayName } = usePartnerBranding();

  // ---------- amount + description from URL ----------
  // Default $1.00 — small enough that an accidental production charge is
  // negligible, big enough that wallets won't reject as below-minimum.
  const amountDollars = useMemo(() => {
    const raw = searchParams.get("amount");
    const parsed = raw ? parseFloat(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 10000) return parsed;
    return 1.0;
  }, [searchParams]);

  const description = searchParams.get("desc")?.slice(0, 100) || "Demo Order";
  const amountCents = Math.round(amountDollars * 100);

  // ---------- view state ----------
  const [view, setView] = useState<View>("checkout");
  const [completedTx, setCompletedTx] = useState<CompletedTx | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showTestCards, setShowTestCards] = useState(true);

  useEffect(() => {
    document.title = `Demo Checkout | ${displayName}`;
  }, [displayName]);

  const primary = branding.brandPrimaryColor || "#0075FF";

  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  // Generate a friendly fake order code from the transaction ID (or timestamp)
  // for the receipt + status views. Real production code would come from the
  // Order row in DB; here we just give clients something to anchor on visually.
  const orderCode = useMemo(() => {
    const seed = completedTx?.transactionId || `${Date.now()}`;
    return `ORD-${seed.slice(-6).toUpperCase()}`;
  }, [completedTx]);

  // Mock ETA — 12 minutes from "now" so the status page shows a believable
  // pickup window. This is the kind of detail that makes a demo feel real.
  const etaTime = useMemo(() => {
    const eta = new Date(Date.now() + 12 * 60 * 1000);
    return eta.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }, [view]);

  function resetForNextDemo() {
    setView("checkout");
    setCompletedTx(null);
    setErrorMsg(null);
  }

  function copyCardNumber(num: string) {
    const stripped = num.replace(/\s/g, "");
    navigator.clipboard?.writeText(stripped).catch(() => {});
  }

  // ============================================================================
  // VIEW: receipt — shown after a successful charge, before "view order status"
  // ============================================================================
  if (view === "receipt" && completedTx) {
    return (
      <DemoShell branding={branding} displayName={displayName}>
        <div className="max-w-md mx-auto px-4 py-6">
          <div className="bg-white rounded-3xl shadow-xl ring-1 ring-gray-100 overflow-hidden">
            {/* Success header strip */}
            <div className="text-center pt-8 pb-6 px-6" style={{ backgroundColor: `${primary}0D` }}>
              <div className="w-16 h-16 mx-auto rounded-full bg-white flex items-center justify-center mb-3 shadow-sm">
                <Icon icon="solar:check-circle-bold" className="w-10 h-10 text-green-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Payment received</h1>
              <p className="text-sm text-gray-600 mt-1">Thanks for your order!</p>
            </div>

            {/* Receipt body */}
            <div className="p-6 space-y-5">
              {/* Order code */}
              <div className="text-center pb-4 border-b border-dashed border-gray-200">
                <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">
                  Order
                </p>
                <p className="text-xl font-mono font-bold tracking-wider" style={{ color: primary }}>
                  {orderCode}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date().toLocaleString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>

              {/* Line items */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700">{description}</span>
                  <span className="font-medium text-gray-900">{formatPrice(amountCents)}</span>
                </div>
                <div className="pt-3 border-t border-gray-100 flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span style={{ color: primary }}>{formatPrice(completedTx.amount ?? amountCents)}</span>
                </div>
              </div>

              {/* Payment details */}
              <div className="rounded-xl bg-gray-50 p-4 space-y-2">
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Payment</p>
                {completedTx.cardBrand && completedTx.cardLast4 && (
                  <Row
                    label="Card"
                    value={`${completedTx.cardBrand.toUpperCase()} •••• ${completedTx.cardLast4}`}
                  />
                )}
                {completedTx.authCode && (
                  <Row label="Auth code" value={completedTx.authCode} mono />
                )}
                {completedTx.transactionId && (
                  <Row label="Transaction" value={completedTx.transactionId.slice(0, 16) + "…"} mono />
                )}
              </div>

              {/* CTAs */}
              <div className="space-y-2 pt-2">
                <button
                  onClick={() => setView("status")}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white shadow-md hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                  style={{ backgroundColor: primary }}
                >
                  View order status
                  <Icon icon="solar:arrow-right-bold" className="w-4 h-4" />
                </button>
                <button
                  onClick={resetForNextDemo}
                  className="w-full py-3 rounded-xl text-sm font-semibold border-2 border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Run another demo
                </button>
              </div>

              <p className="text-xs text-center text-gray-400 pt-2">
                Demo mode · {process.env.NEXT_PUBLIC_GP_ENV === "prod"
                  ? "⚠️ Production GP keys active"
                  : "Sandbox — nothing was actually settled"}
              </p>
            </div>
          </div>
        </div>
      </DemoShell>
    );
  }

  // ============================================================================
  // VIEW: status — mock order tracking (Placed → Preparing → Ready)
  // ============================================================================
  if (view === "status" && completedTx) {
    return (
      <DemoShell branding={branding} displayName={displayName}>
        <div className="max-w-md mx-auto px-4 py-6 space-y-4">
          {/* Order header */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs uppercase tracking-wide text-gray-500">Your order</p>
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: `${primary}1A`, color: primary }}
              >
                IN PROGRESS
              </span>
            </div>
            <p className="text-lg font-mono font-bold tracking-wider" style={{ color: primary }}>
              {orderCode}
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Estimated ready at <strong>{etaTime}</strong>
            </p>
          </div>

          {/* Timeline — three steps, first two completed, third pending */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h2 className="font-semibold mb-4">Status</h2>
            <ol className="relative space-y-6">
              <TimelineStep
                done
                primary={primary}
                icon="solar:check-circle-bold"
                label="Order placed"
                detail={`Paid ${formatPrice(amountCents)}`}
                timestamp="Just now"
                isFirst
              />
              <TimelineStep
                active
                primary={primary}
                icon="solar:chef-hat-bold"
                label="Being prepared"
                detail="The kitchen has your order"
                timestamp="In progress"
              />
              <TimelineStep
                primary={primary}
                icon="solar:bag-check-bold"
                label="Ready for pickup"
                detail={`Expected around ${etaTime}`}
                timestamp=""
                isLast
              />
            </ol>
          </div>

          {/* Receipt link */}
          <button
            onClick={() => setView("receipt")}
            className="w-full bg-white rounded-2xl p-4 shadow-sm text-left hover:shadow-md transition-shadow flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${primary}1A` }}
              >
                <Icon icon="solar:document-text-bold" className="w-5 h-5" style={{ color: primary }} />
              </div>
              <div>
                <p className="font-semibold text-sm text-gray-900">View receipt</p>
                <p className="text-xs text-gray-500">{formatPrice(amountCents)} · {orderCode}</p>
              </div>
            </div>
            <Icon icon="solar:arrow-right-linear" className="w-4 h-4 text-gray-400" />
          </button>

          {/* Reset */}
          <button
            onClick={resetForNextDemo}
            className="w-full py-3 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
          >
            ← Run another demo
          </button>

          <p className="text-xs text-center text-gray-400 pt-2">
            This is a mock order-tracking view for demo purposes only.
          </p>
        </div>
      </DemoShell>
    );
  }

  // ============================================================================
  // VIEW: checkout — default; order summary + test cards + payment widget
  // ============================================================================
  return (
    <DemoShell branding={branding} displayName={displayName}>
      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
        {/* Order summary */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="font-semibold mb-4">Order Summary</h2>
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>{description}</span>
              <span>{formatPrice(amountCents)}</span>
            </div>
            <div className="border-t border-gray-100 my-3" />
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span style={{ color: primary }}>{formatPrice(amountCents)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4 leading-relaxed">
            Different amount? Add <code className="bg-gray-100 px-1.5 py-0.5 rounded">?amount=25</code> to the URL.
          </p>
        </div>

        {/* Test cards reference — clearly demo-only, collapsible */}
        <div
          className="rounded-2xl shadow-sm overflow-hidden border-2 border-dashed"
          style={{ borderColor: `${primary}40`, backgroundColor: `${primary}08` }}
        >
          <button
            type="button"
            onClick={() => setShowTestCards(!showTestCards)}
            className="w-full flex items-center justify-between p-4 hover:bg-white/40 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${primary}1A` }}
              >
                <Icon icon="solar:card-2-bold" className="w-5 h-5" style={{ color: primary }} />
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-gray-900">Test card numbers</p>
                <p className="text-xs text-gray-600">Sandbox only — tap a card to copy</p>
              </div>
            </div>
            <Icon
              icon={showTestCards ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"}
              className="w-5 h-5 text-gray-500"
            />
          </button>

          {showTestCards && (
            <div className="px-4 pb-4 space-y-2">
              {TEST_CARDS.map((card) => (
                <button
                  key={card.brand}
                  type="button"
                  onClick={() => copyCardNumber(card.number)}
                  className="w-full flex items-center justify-between p-3 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <Icon icon={card.icon} className="w-8 h-5" />
                    <div className="text-left">
                      <p className="text-xs text-gray-500">{card.brand}</p>
                      <p className="text-sm font-mono font-semibold tracking-wider text-gray-900">
                        {card.number}
                      </p>
                    </div>
                  </div>
                  <Icon
                    icon="solar:copy-linear"
                    className="w-4 h-4 text-gray-400 group-hover:text-gray-700"
                  />
                </button>
              ))}
              <div className="pt-3 mt-2 border-t border-gray-200 grid grid-cols-3 gap-2 text-xs text-gray-700">
                <div>
                  <p className="text-gray-500 uppercase tracking-wide text-[10px] mb-0.5">Expiry</p>
                  <p className="font-mono font-semibold">12/30</p>
                </div>
                <div>
                  <p className="text-gray-500 uppercase tracking-wide text-[10px] mb-0.5">CVV</p>
                  <p className="font-mono font-semibold">123</p>
                </div>
                <div>
                  <p className="text-gray-500 uppercase tracking-wide text-[10px] mb-0.5">ZIP</p>
                  <p className="font-mono font-semibold">75001</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Payment widget (DropInCheckout) */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h2 className="font-semibold mb-3">Payment</h2>
          <DropInCheckout
            amount={amountCents}
            currency="CAD"
            description={description}
            merchantName={displayName}
            onSuccess={(result) => {
              setCompletedTx(result);
              setView("receipt");
              setErrorMsg(null);
            }}
            onError={(err) => {
              setErrorMsg(err || "Payment failed");
            }}
          />
          {errorMsg && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
              <Icon icon="solar:close-circle-bold" className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Security strip */}
        <div className="flex items-center justify-center gap-2 text-gray-500 text-xs">
          <Icon icon="solar:shield-check-bold" className="w-4 h-4 text-green-500" />
          <span>Secure 256-bit encryption · Powered by Global Payments</span>
        </div>
      </div>
    </DemoShell>
  );
}

// ============================================================================
// Shared layout shell — demo banner + brand header. Reused across all 3 views
// so navigating between them keeps a consistent visual frame.
// ============================================================================
function DemoShell({
  children,
  branding,
  displayName,
}: {
  children: React.ReactNode;
  branding: { brandLogoUrl: string | null };
  displayName: string;
}) {
  return (
    <div className="min-h-screen bg-gray-50 font-poppins" style={{ color: "#002834" }}>
      {/* Demo-mode banner — always visible so nobody mistakes this for prod */}
      <div
        className="w-full py-2.5 text-center text-xs font-bold uppercase tracking-widest text-white"
        style={{ backgroundColor: "#f59e0b" }}
      >
        <Icon icon="solar:info-circle-bold" className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
        Demo Mode · This is a test checkout
      </div>

      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {branding.brandLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.brandLogoUrl} alt={displayName} className="h-10 object-contain" />
            ) : (
              <span className="text-lg font-bold">{displayName}</span>
            )}
          </div>
          {/* PHASE 7d-fix (2026-05-21): prominent GP badge so clients see at
              a glance that the payment processor is Global Payments — this is
              a REAL GP integration in sandbox mode, not a mockup. The badge
              survives across all three demo views (checkout/receipt/status)
              because it lives in the shared shell. */}
          <a
            href="https://www.globalpayments.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 hover:shadow-sm transition-shadow"
            title="Payments processed by Global Payments — real GP sandbox integration"
          >
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Powered by
            </span>
            <span className="text-sm font-bold text-blue-700 tracking-tight">
              Global Payments
            </span>
            <Icon icon="solar:shield-check-bold" className="w-3.5 h-3.5 text-green-600" />
          </a>
        </div>
      </header>

      {/* Compact mobile version of the GP badge (full sticker doesn't fit
          in the header on phones, so we drop it just below) */}
      <div className="sm:hidden bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 px-4 py-2 flex items-center justify-center gap-2">
        <Icon icon="solar:shield-check-bold" className="w-3.5 h-3.5 text-green-600" />
        <span className="text-[11px] text-gray-700">
          Payments processed by{" "}
          <span className="font-bold text-blue-700">Global Payments</span>
        </span>
      </div>

      <main>{children}</main>
    </div>
  );
}

// ----------------------------------------------------------------------------
function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-500">{label}</span>
      <span
        className={`text-sm font-semibold text-gray-900 ${mono ? "font-mono tracking-wider" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

// ============================================================================
// Default export — wraps the page in Suspense so useSearchParams() doesn't
// blow up the static build. The fallback is a centered spinner matching the
// page background so it never flashes anything jarring.
// ============================================================================
export default function DemoCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-transparent" />
        </div>
      }
    >
      <DemoCheckoutContent />
    </Suspense>
  );
}

function TimelineStep({
  done,
  active,
  primary,
  icon,
  label,
  detail,
  timestamp,
  isFirst,
  isLast,
}: {
  done?: boolean;
  active?: boolean;
  primary: string;
  icon: string;
  label: string;
  detail: string;
  timestamp: string;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  // Vertical connector line — drawn behind the icon column for completed steps
  const lineColor = done || active ? primary : "#E5E7EB";

  return (
    <li className="flex gap-4 relative">
      {/* Connector line — sits behind the circle (z-0), starts/ends offset
          for first/last items so we don't draw above/below the timeline */}
      {!isLast && (
        <span
          className="absolute left-[19px] top-10 bottom-[-1.5rem] w-0.5 -z-0"
          style={{ backgroundColor: done ? primary : "#E5E7EB" }}
        />
      )}
      {!isFirst && (
        <span
          className="absolute left-[19px] -top-6 h-6 w-0.5 -z-0"
          style={{ backgroundColor: lineColor }}
        />
      )}

      {/* Step icon circle */}
      <div
        className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
          done || active ? "" : "ring-2 ring-gray-200"
        }`}
        style={{
          backgroundColor: done
            ? primary
            : active
            ? `${primary}1A`
            : "white",
        }}
      >
        <Icon
          icon={icon}
          className={`w-5 h-5 ${done ? "text-white" : ""} ${active ? "animate-pulse" : ""}`}
          style={done ? {} : { color: active ? primary : "#9CA3AF" }}
        />
      </div>

      {/* Step content */}
      <div className="flex-1 pt-1">
        <div className="flex items-center justify-between mb-0.5">
          <p className={`font-bold ${done || active ? "text-gray-900" : "text-gray-400"}`}>
            {label}
          </p>
          {timestamp && (
            <span className="text-xs text-gray-500">{timestamp}</span>
          )}
        </div>
        <p className={`text-sm ${done || active ? "text-gray-600" : "text-gray-400"}`}>
          {detail}
        </p>
      </div>
    </li>
  );
}
