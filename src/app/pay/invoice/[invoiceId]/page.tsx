"use client";

// Phase H #3 (2026-09-02): reCAPTCHA v3 protects the pay flow against
// bot-driven Stripe-session creation and mock-pay hits. Client generates
// one token per pay-click (action="invoice_pay"), sends it with both the
// checkout-session POST and the mock-pay POST. Server-side verification
// lives in /api/pay/invoice/[invoiceId]/stripe/checkout-session and
// .../mock-pay. NEXT_PUBLIC_RECAPTCHA_SITE_KEY must be set for the
// browser script to load; RECAPTCHA_SECRET_KEY must be set on the
// server. Both fail open when unset — dev builds are unaffected.
//
// Register hub.synergydatalabs.com in the Google reCAPTCHA console
// (v3 enterprise or standard) and paste site + secret into EC2 env.
import { useRecaptcha } from "@/hooks/useRecaptcha";
// Phase I #2h (2026-09-08): one-step Elements flow — card + wallet
// buttons visible from page load, single Pay button. Same UX as the
// payment link checkout. The component is defined at the bottom of
// this file so it can share the pay page's state via props. Superseded
// the two-step <StripePaymentSection> flow (that component stays on
// disk for the archived checkout-session redirect path).
import { useMemo } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  ExpressCheckoutElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

// =============================================================================
// /pay/invoice/[invoiceId] — public customer pay page.
//
// Skinned in the supplier's brand colours + logo (fetched from the public
// read endpoint, which also returns the invoice + line items). Renders:
//   • Supplier header (logo + name)
//   • Invoice number + issue date + status badge
//   • Customer block
//   • Line items table with per-line totals
//   • Subtotal / tax / total
//   • Notes from the supplier (if any)
//   • Pay now button (Phase 2 mock; Phase 4 becomes Stripe Checkout)
//   • Paid / Cancelled states show a different footer instead of the button
//
// Placeholder for the T&C acceptance checkbox lives here — Phase 3 wires
// the actual T&C rendering + acceptance capture into that same block.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Icon } from "@iconify/react";
import { Plus_Jakarta_Sans } from "next/font/google";

// #6t: Plus Jakarta Sans — the vendor mode's typeface per the UI expert
// handoff brand guide. Loaded at module scope (Next.js requirement) with
// swap so the page paints instantly and the font layers in when ready.
// Weights 400–800 cover body, semi-bold labels, and the bold total lines.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

interface Line {
  id: string;
  productName: string;
  productDescription: string | null;
  unitLabel: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

interface Brand {
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
}

interface Supplier {
  displayName: string;
  legalName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  // Phase I #14 (2026-09-23): tenants can opt out of the "Powered by
  // hub" footer + trust chips row. Server default is true.
  poweredByVisible?: boolean;
  brand: Brand;
}

// Phase F #6r (2026-08-29): vendor info from the invoice's first product
// (if that product has vendor fields set). Renders a "Sold by hub —
// {vendorName}" strip on the pay page so the buyer sees who made the
// software while hub stays as merchant of record. Null when no vendor
// is attached (single-tenant selling their own product).
interface Vendor {
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  supportEmail: string | null;
  // #6s: vendor brand color. When present, the pay page swaps its whole
  // palette to this vendor (deep-navy hero derived at render, buttons +
  // accents in this hex). Null keeps the supplier's hub-teal theme.
  brandColor: string | null;
  // #6t: compliance text — parent legal name, licence text, and how the
  // charge appears on the buyer's card statement. Each renders only when set.
  legalName: string | null;
  licenseText: string | null;
  statementDescriptor: string | null;
}

// #6s: darken a hex color toward true navy for the hero band. Kept small +
// dependency-free — clients only ever pass hex from the DB (validated on
// write), so no CSS-color-string parsing is needed. Falls back to the
// original color on any parse failure so the hero always renders SOMETHING.
function darkenHex(hex: string, amount: number): string {
  try {
    const h = hex.replace("#", "").trim();
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    if (full.length !== 6) return hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
    const nr = Math.max(0, Math.round(r * (1 - amount)));
    const ng = Math.max(0, Math.round(g * (1 - amount)));
    const nb = Math.max(0, Math.round(b * (1 - amount)));
    return `#${[nr, ng, nb].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return hex;
  }
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  paymentStatus: string;
  paidAt: string | null;
  sentAt: string;
  customer: {
    name: string;
    email: string;
    company: string | null;
    address: string | null;
  };
  items: Line[];
}

export default function PayInvoicePage() {
  const params = useParams<{ invoiceId: string }>();
  const invoiceId = params?.invoiceId;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [paying, setPaying] = useState(false);
  // Phase H #3: reCAPTCHA v3 — token generated at pay-click.
  const recaptcha = useRecaptcha();
  // Single acceptance flag for non-vendor (supplier) invoices.
  const [accepted, setAccepted] = useState(false);
  // #6t: Appendix A three-checkbox consent block for vendor invoices.
  // Terms + Refund + Privacy links must be an unticked positive act
  // (chargeback defense — see handoff HANDOFF.md §"What was changed" #2).
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedSupply, setAcceptedSupply] = useState(false);
  const [acceptedNoRefund, setAcceptedNoRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase F #3 (2026-08-27): supplier T&C. Fetched alongside the invoice.
  // null = supplier hasn't published any T&C → skip the acceptance step
  // and behave like Phase 2 did.
  const [terms, setTerms] = useState<{
    id: string;
    version: string;
    bodyMarkdown: string;
  } | null>(null);
  const [typedName, setTypedName] = useState("");
  const [termsExpanded, setTermsExpanded] = useState(false);

  // Phase F #4 (2026-08-27): payment method for THIS supplier. STRIPE
  // means Pay renders inline Stripe Elements (Phase I #2a, was redirect
  // to Stripe Checkout); MOCK is the Phase-2 fallback that flips the
  // invoice locally. Server decides which one applies.
  const [paymentMethod, setPaymentMethod] = useState<"STRIPE" | "MOCK">("MOCK");
  // Phase I #2h (2026-09-08): supplier's Stripe publishable key. Captured
  // from the invoice GET response so we can mount Stripe Elements at page
  // load and render the card entry + wallet buttons inline from the start
  // (one-click Pay instead of two-step Pay → card → Pay).
  const [publishableKey, setPublishableKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      // Parallel: invoice + T&C. T&C is optional — a supplier that hasn't
      // published any returns { terms: null } and the pay page falls back
      // to Phase-2 behaviour (checkbox with no legal text, no acceptance
      // recorded). We still request it so a T&C published later kicks in
      // automatically for existing unpaid invoices.
      const [invRes, tRes] = await Promise.all([
        fetch(`/api/pay/invoice/${invoiceId}`),
        fetch(`/api/pay/invoice/${invoiceId}/terms`),
      ]);
      if (invRes.status === 404) {
        setNotFound(true);
        return;
      }
      const data = await invRes.json();
      if (data.success) {
        setInvoice(data.invoice);
        setSupplier(data.supplier);
        if (data.vendor) setVendor(data.vendor);
        // Pre-fill the typed-name field with the invoice's customer name —
        // supplier already knows who's supposed to be paying. Customer
        // can edit if they're paying on behalf of someone else.
        if (data.invoice?.customer?.name) setTypedName(data.invoice.customer.name);
        if (data.paymentMethod === "STRIPE") setPaymentMethod("STRIPE");
        if (data.stripePublishableKey) setPublishableKey(data.stripePublishableKey);
      } else {
        setError(data.error || "Failed to load invoice");
      }
      if (tRes.ok) {
        const tData = await tRes.json();
        if (tData.success && tData.terms) setTerms(tData.terms);
      }
    } catch {
      setError("Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  const money = (cents: number, ccy = invoice?.currency || "CAD") =>
    `${ccy} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  // #6t: vendor mode requires all three Appendix A consents; non-vendor
  // mode keeps the single acceptance box. Computed here rather than at the
  // JSX site because pay() below needs the same check.
  const inVendorMode = Boolean(vendor?.brandColor);
  const allAccepted = inVendorMode && terms
    ? acceptedTerms && acceptedSupply && acceptedNoRefund
    : accepted;

  const pay = async () => {
    if (!invoice) return;
    if (!allAccepted) {
      setError(
        inVendorMode && terms
          ? "Please tick each acceptance box before paying"
          : "Please accept the terms before paying"
      );
      return;
    }
    // When the supplier has published T&C, we require a typed name for the
    // acceptance record — the customer's signature. When they haven't, we
    // skip the name requirement (Phase 2 behaviour).
    if (terms && !typedName.trim()) {
      setError("Please type your full name to sign the terms");
      return;
    }
    setError(null);
    setPaying(true);
    try {
      // Record T&C acceptance first (if T&C exists). If the accept endpoint
      // fails we bail out of Pay entirely — we must not charge a customer
      // whose acceptance we couldn't record, because that's exactly the
      // record we'd need on a chargeback.
      if (terms) {
        const acceptRes = await fetch(
          `/api/pay/invoice/${invoice.id}/accept-terms`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              termsVersionId: terms.id,
              acceptedName: typedName.trim(),
              // #6t: per-checkbox flags for chargeback defense. Server may
              // ignore for now; kept in the payload so the record can be
              // reconstructed once storage is wired.
              consents: inVendorMode
                ? {
                    terms_acceptance: acceptedTerms,
                    immediate_supply_waiver: acceptedSupply,
                    non_refundable_ack: acceptedNoRefund,
                  }
                : { terms_acceptance: accepted },
            }),
          }
        );
        const acceptData = await acceptRes.json();
        if (!acceptRes.ok) {
          setError(acceptData.error || "Could not record your acceptance. Please try again.");
          return;
        }
      }

      // Phase H #3 (2026-09-02): one reCAPTCHA v3 token per pay-click,
      // sent with whichever payment path the customer chose. Fails open
      // client-side when NEXT_PUBLIC_RECAPTCHA_SITE_KEY isn't set (dev).
      const recaptchaToken = await recaptcha.execute("invoice_pay");

      // Phase I #2h (2026-09-08): STRIPE branch removed from pay() —
      // Stripe suppliers now render <InvoiceInlineStripeCheckout> which
      // owns the entire card + wallet flow. pay() is only invoked by
      // the fallback button, which the render tree only shows when
      // paymentMethod === "MOCK". Guard defensively anyway.
      if (paymentMethod === "STRIPE") {
        setError("Payment form failed to load — please refresh the page.");
        return;
      }

      const res = await fetch(`/api/pay/invoice/${invoice.id}/mock-pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recaptchaToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Payment failed");
        return;
      }
      await load();
    } catch {
      setError("Payment failed");
    } finally {
      setPaying(false);
    }
  };

  // ---- Not-found / loading states ----------------------------------------
  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Invoice not found</h1>
          <p className="mt-2 text-sm text-gray-600">
            The link you followed may be expired or mistyped. If you were expecting to pay
            an invoice, ask the sender to resend the link.
          </p>
        </div>
      </div>
    );
  }
  if (loading || !invoice || !supplier) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-sm text-gray-400">Loading invoice…</div>
      </div>
    );
  }

  // #6s + #6t: per-vendor theme swap. When the invoice's product carries a
  // vendor brand color, the pay page swaps the whole palette to the UI
  // expert's handoff brand pack (brand guide v1.0, July 2026):
  //   Electric Blue  #006AFF  actions, links, highlights, CTA
  //   Deep Navy      #0E2145  hero background
  //   Midnight       #0E234E  footer + dark sections
  //   Royal Blue     #093988  RBI-Licensed pill + Awaiting-payment pill text
  //   Cloud          #F5F7F8  page surface
  //   Ink            #0F1729  strong body text on light surfaces
  // Vendor mode uses these five hardcoded values (not derived) so the page
  // matches the handoff exactly. Non-vendor invoices keep the supplier's
  // own hub-teal palette.
  const vendorTheme = Boolean(vendor?.brandColor);
  const primary = vendor?.brandColor || supplier.brand.primaryColor || "#0F766E";
  const accent = vendorTheme
    ? "#3072F0" // Exchange Blue (handoff §"paid state" bar gradient)
    : supplier.brand.accentColor || "#14B8A6";
  const bg = vendorTheme ? "#F5F7F8" : (supplier.brand.backgroundColor || "#FFFFFF");
  // Hero: Deep Navy → Midnight linear gradient (handoff pay page §hero).
  const heroDark = vendorTheme ? "#0E2145" : primary;
  const heroMid  = vendorTheme ? "#0E234E" : `${primary}E6`;
  const heroSoft = vendorTheme ? "#0E234E" : `${primary}CC`;
  // Ink / royal — pulled out so JSX below stays readable.
  const ink = vendorTheme ? "#0F1729" : "#0F1729";
  const royalBlue = "#093988";
  const midnight = "#0E234E";

  const isPaid = invoice.paymentStatus === "PAID";
  const isCancelled = invoice.status === "CANCELLED";
  const canPay = !isPaid && !isCancelled;

  return (
    <div
      className={`min-h-screen ${vendorTheme ? jakarta.className : ""}`}
      style={{ backgroundColor: bg }}
    >
      {/* Phase F #6j (2026-08-28): premium header. Diagonal gradient + a
          soft decorative dot pattern for depth (no external asset — pure
          SVG data URL, still solid-color safe if it fails to render). */}
      {/* #6s: hero band. In vendor mode we swap to the handoff design — deep
          navy with the VENDOR as the hero identity (their logo + name), and a
          "Sold by hub" chip in the corner so the buyer still sees the merchant
          of record. In supplier mode we keep the original teal gradient. */}
      <header
        className="relative w-full overflow-hidden"
        style={{
          background: vendorTheme
            ? `linear-gradient(135deg, ${heroDark} 0%, ${heroMid} 60%, ${heroSoft} 100%)`
            : `linear-gradient(135deg, ${primary} 0%, ${primary}E6 55%, ${primary}CC 100%)`,
        }}
      >
        {/* Decorative dot pattern — pure inline SVG, no external fetch */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='2' cy='2' r='1' fill='white'/%3E%3C/svg%3E\")",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Vendor-mode glow uses the vendor primary as an accent halo. In
            supplier mode we keep the neutral white glow. */}
        <div
          className="absolute -bottom-10 -right-10 w-64 h-64 rounded-full blur-3xl opacity-25 pointer-events-none"
          style={{ backgroundColor: vendorTheme ? primary : "white" }}
        />

        <div className="relative max-w-3xl mx-auto px-6 py-10 flex items-center justify-between gap-4">
          {vendorTheme && vendor ? (
            // #Rebrand (2026-08-31): Mego brand pack redesign.
            // - White wordmark sits DIRECTLY on the navy hero (no white chip).
            // - "Sold on hub by {vendor.name}" beneath — vendor is the seller
            //   in the buyer's mental model; Synergy remains MoR in the fine
            //   print at the bottom of the pay block + footer.
            // - When the logo file 404s (path drift), we fall back to the
            //   vendor.name as bold white text so the hero never renders empty.
            <div className="flex items-center gap-4">
              <div className="text-white">
                {vendor.logoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={vendor.logoUrl}
                    alt={vendor.name}
                    className="h-10 w-auto block"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).replaceWith(
                        Object.assign(document.createElement("span"), {
                          textContent: vendor.name,
                          className: "text-3xl font-extrabold text-white tracking-tight",
                        })
                      );
                    }}
                  />
                ) : (
                  <span className="inline-block text-3xl font-extrabold text-white tracking-tight">
                    {vendor.name}
                  </span>
                )}
                <p className="text-xs opacity-80 mt-2">
                  Sold on hub by {vendor.name}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              {supplier.brand.logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={supplier.brand.logoUrl}
                  alt={supplier.displayName}
                  className="h-12 w-auto object-contain rounded-lg bg-white/10 p-1.5 backdrop-blur-sm"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : null}
              <div className="text-white">
                <p className="text-2xl font-bold leading-tight tracking-tight">
                  {supplier.displayName}
                </p>
                {supplier.legalName && supplier.legalName !== supplier.displayName && (
                  <p className="text-xs opacity-80 mt-0.5">{supplier.legalName}</p>
                )}
              </div>
            </div>
          )}
          <div className="text-right text-white">
            <p className="text-[10px] uppercase tracking-[0.15em] opacity-70">Invoice</p>
            <p className="font-mono font-semibold text-lg mt-0.5">{invoice.invoiceNumber}</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* Phase F #6r/#6s (2026-08-29): vendor branding strip.
            - In supplier-theme mode with a vendor set: show the strip so the
              buyer sees who made the software (vendor stays below hub's hero).
            - In vendor-theme mode: the vendor is ALREADY the hero identity,
              so the strip would be duplication — hide it. */}
        {vendor && !vendorTheme && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-4">
            {vendor.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={vendor.logoUrl}
                alt={vendor.name}
                className="h-12 w-12 rounded-lg object-contain bg-gray-50 p-1 flex-shrink-0"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div
                className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                style={{ backgroundColor: primary }}
              >
                {vendor.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wider text-gray-500">Software by</p>
              <p className="text-base font-bold text-gray-900 truncate">{vendor.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Sold by <span className="font-medium">{supplier.displayName}</span> as reseller ·
                {" "}Charged as <span className="font-mono font-semibold">SYNERGY DATA LABS</span> on your statement
              </p>
            </div>
            {vendor.websiteUrl && (
              <a
                href={vendor.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold hover:underline whitespace-nowrap flex-shrink-0"
                style={{ color: primary }}
              >
                About {vendor.name} ↗
              </a>
            )}
          </div>
        )}

        {/* Status pill. In vendor mode: Ink numerals + Royal Blue pill on
            Frost surface (handoff §status). */}
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">Amount due</p>
            <p
              className={`text-4xl tabular-nums tracking-tight ${vendorTheme ? "font-extrabold" : "font-bold"}`}
              style={{ color: vendorTheme ? ink : "#111827" }}
            >
              {money(invoice.totalCents)}
            </p>
          </div>
          {isPaid ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-800">
              <span className="w-1.5 h-1.5 rounded-full bg-green-600" /> Paid
            </span>
          ) : isCancelled ? (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-600">
              Cancelled
            </span>
          ) : (
            <span
              className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold"
              style={
                vendorTheme
                  ? { backgroundColor: "#E0E6FD", color: royalBlue }
                  : { backgroundColor: `${accent}22`, color: primary }
              }
            >
              Awaiting payment
            </span>
          )}
        </div>

        {/* Bill-to + issue block */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Bill to</p>
            <p className="font-medium text-gray-900">{invoice.customer.name}</p>
            {invoice.customer.company && (
              <p className="text-gray-700">{invoice.customer.company}</p>
            )}
            <p className="text-gray-500">{invoice.customer.email}</p>
            {invoice.customer.address && (
              <p className="text-gray-500 mt-1 whitespace-pre-line">{invoice.customer.address}</p>
            )}
          </div>
          <div className="sm:text-right">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Issued</p>
            <p className="font-medium text-gray-900">
              {new Date(invoice.sentAt).toLocaleDateString(undefined, {
                month: "long", day: "numeric", year: "numeric",
              })}
            </p>
            {/* Contact for questions. Vendor mode prefers vendor.supportEmail
                (product support goes to the vendor, not the reseller). */}
            {(() => {
              const contactEmail =
                (vendorTheme && vendor?.supportEmail) || supplier.contactEmail;
              return contactEmail ? (
                <p className="text-gray-500 mt-2 text-xs">
                  Questions? <a href={`mailto:${contactEmail}`} className="underline">{contactEmail}</a>
                </p>
              ) : null;
            })()}
          </div>
        </div>

        {/* Line items */}
        <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: `${primary}08` }}>
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-right px-4 py-3 w-20">Qty</th>
                <th className="text-right px-4 py-3 w-32">Unit price</th>
                <th className="text-right px-4 py-3 w-32">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it) => (
                <tr key={it.id} className="border-t border-gray-100">
                  <td className="px-4 py-3">
                    <p className="text-gray-900 font-medium">{it.productName}</p>
                    {it.productDescription && (
                      <p className="text-xs text-gray-500 mt-0.5">{it.productDescription}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {it.quantity}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {money(it.unitPriceCents)}
                    <span className="text-gray-400 text-xs"> /{it.unitLabel}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                    {money(it.lineTotalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={3} className="px-4 py-2 text-right text-gray-600 text-sm">Subtotal</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-800">{money(invoice.subtotalCents)}</td>
              </tr>
              {invoice.taxCents > 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right text-gray-600 text-sm">Tax</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-800">{money(invoice.taxCents)}</td>
                </tr>
              )}
              <tr className="border-t border-gray-200">
                <td colSpan={3} className="px-4 py-3 text-right font-semibold text-gray-900">Total</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold text-lg" style={{ color: primary }}>
                  {money(invoice.totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Notes from supplier */}
        {invoice.notes && (
          <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Notes from {supplier.displayName}
            </p>
            <p className="text-sm text-gray-700 whitespace-pre-line">{invoice.notes}</p>
          </div>
        )}

        {/* Pay action — Phase 3 renders the supplier's actual T&C when
            published + captures a typed signature + records IP/UA/geo/hash
            on click. When the supplier hasn't published any T&C, we fall
            back to a simple checkbox (Phase 2 behaviour). */}
        {canPay && (
          <div className="rounded-2xl border-2 p-6" style={{ borderColor: `${primary}33`, backgroundColor: `${primary}05` }}>
            {terms ? (
              <>
                {/* T&C header + expandable body */}
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden mb-4">
                  <button
                    type="button"
                    onClick={() => setTermsExpanded((v) => !v)}
                    className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-gray-50"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {(vendorTheme && vendor ? vendor.name : supplier.displayName)}&apos;s Terms &amp; Conditions
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Version <span className="font-mono">{terms.version}</span>
                        {" · "}Read before you accept
                      </p>
                    </div>
                    <Icon
                      icon={termsExpanded ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"}
                      className="w-5 h-5 text-gray-400"
                    />
                  </button>
                  {termsExpanded && (
                    <div className={`border-t border-gray-100 p-4 ${vendorTheme ? "max-h-96" : "max-h-64"} overflow-y-auto bg-gray-50`}>
                      <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed m-0">
                        {terms.bodyMarkdown}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Typed name field — the digital signature. Prefilled from
                    the invoice's customer name, editable in case someone else
                    is paying on the customer's behalf. */}
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  Type your full name to sign
                </label>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  className="w-full px-4 py-3 mb-4 border border-gray-200 rounded-xl bg-white outline-none focus:ring-2 focus:border-transparent"
                  style={{ "--tw-ring-color": primary } as React.CSSProperties}
                />

                {vendorTheme && vendor ? (
                  <>
                    {/* Phase I #2d (2026-09-08): single acceptance checkbox
                        with 3 informational lines below (was 3 separate
                        checkboxes). Still records all 3 consent flags on
                        the acceptance receipt — the customer just doesn't
                        have to tick them individually. */}
                    <label
                      className="flex items-start gap-3 text-sm cursor-pointer mb-3 p-3 rounded-lg border-2 transition-colors"
                      style={{
                        borderColor: (acceptedTerms && acceptedSupply && acceptedNoRefund) ? primary : "#E4E8EF",
                        background: (acceptedTerms && acceptedSupply && acceptedNoRefund) ? `${primary}10` : "#FFFFFF",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={acceptedTerms && acceptedSupply && acceptedNoRefund}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setAcceptedTerms(next);
                          setAcceptedSupply(next);
                          setAcceptedNoRefund(next);
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 shrink-0"
                        style={{ accentColor: primary }}
                      />
                      <span className="text-gray-900 font-semibold">
                        I have read and agree to all of the following:
                      </span>
                    </label>

                    <ul className="space-y-2.5 pl-4 text-sm text-gray-700">
                      <li className="relative">
                        <span className="absolute -left-4 top-2 w-1.5 h-1.5 rounded-full bg-gray-400" />
                        I have read and agree to {vendor.name}&apos;s{" "}
                        <button
                          type="button"
                          onClick={() => setTermsExpanded(true)}
                          className="underline"
                          style={{ color: primary }}
                        >
                          Terms and Conditions &amp; Refund Policy
                        </button>{" "}
                        (version <span className="font-mono">{terms.version}</span>) and to the Licence Terms for the products in my order.
                      </li>
                      <li className="relative">
                        <span className="absolute -left-4 top-2 w-1.5 h-1.5 rounded-full bg-gray-400" />
                        I request immediate delivery of the digital product(s) in this order and I acknowledge that once delivery has begun I lose my 14-day right of withdrawal / cancellation.
                      </li>
                      <li className="relative">
                        <span className="absolute -left-4 top-2 w-1.5 h-1.5 rounded-full bg-gray-400" />
                        I understand that this is a digital product delivered instantly, that it is non-refundable once delivered, and that I will contact{" "}
                        {vendor.supportEmail ? (
                          <strong>{vendor.supportEmail}</strong>
                        ) : (
                          <strong>{supplier.contactEmail || supplier.displayName}</strong>
                        )}{" "}
                        before contacting my bank if anything is wrong with my order.
                      </li>
                    </ul>

                    {/* Statement descriptor notice — displayed, not a checkbox. */}
                    {vendor.statementDescriptor && (
                      <p
                        className="mt-4 rounded-lg border bg-white px-4 py-3 text-xs text-gray-700"
                        style={{ borderColor: "#E4E8EF" }}
                      >
                        <strong>This charge will appear on your statement as {vendor.statementDescriptor}.</strong>{" "}
                        Please note this name — it will not show the product or publisher name.
                      </p>
                    )}

                    <p className="mt-3 text-[11px] text-gray-500">
                      Signed by <span className="font-medium">{typedName.trim() || "(type your name above)"}</span>
                      {" · "}Terms version <span className="font-mono">{terms.version}</span>
                      {" · "}Your IP address, browser and timestamp are recorded as proof of acceptance.
                    </p>
                  </>
                ) : (
                  // Non-vendor mode: single-box confirmation (existing behaviour).
                  <label className="flex items-start gap-3 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-gray-300"
                      style={{ accentColor: primary }}
                    />
                    <span className="text-gray-700">
                      I, <span className="font-medium">{typedName.trim() || "(type your name above)"}</span>,
                      accept {supplier.displayName}&apos;s Terms &amp; Conditions
                      (version <span className="font-mono">{terms.version}</span>) and authorise this payment.
                      My IP address, browser, and timestamp will be recorded as proof of acceptance.
                    </span>
                  </label>
                )}
              </>
            ) : (
              // No T&C published — simpler Phase-2-style checkbox
              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300"
                  style={{ accentColor: primary }}
                />
                <span className="text-gray-700">
                  I authorise this payment to {supplier.displayName} and understand this is a real charge.
                </span>
              </label>
            )}

            {error && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Phase I #2h (2026-09-08): one-step Stripe checkout with
                Elements mounted at page load. Card entry + Apple Pay /
                Google Pay wallet buttons visible from the start; Pay
                button dim until T&C accepted + name signed. Same UX as
                the payment link checkout page.

                Fallback: when publishableKey is missing (supplier is
                MOCK or Stripe misconfigured), we keep the old single-
                button flow that hits mock-pay OR the /stripe/payment-
                intent redirect. */}
            {paymentMethod === "STRIPE" && publishableKey ? (
              <div className="mt-5">
                <InvoiceInlineStripeCheckout
                  publishableKey={publishableKey}
                  amountCents={invoice.totalCents}
                  currency={invoice.currency}
                  invoiceId={invoice.id}
                  primaryColor={primary}
                  merchantName={supplier.displayName}
                  gated={!allAccepted || (!!terms && !typedName.trim())}
                  gatingHint="Accept the terms above ↑"
                  onBeforePay={async () => {
                    // Records T&C acceptance server-side BEFORE the card
                    // is charged (same as pay() did in the old flow) —
                    // returns false to block the payment.
                    if (!terms) return true;
                    const recaptchaToken = await recaptcha.execute("invoice_pay");
                    const acceptRes = await fetch(
                      `/api/pay/invoice/${invoice.id}/accept-terms`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          termsVersionId: terms.id,
                          acceptedName: typedName.trim(),
                          consents: inVendorMode
                            ? {
                                terms_acceptance: acceptedTerms,
                                immediate_supply_waiver: acceptedSupply,
                                non_refundable_ack: acceptedNoRefund,
                              }
                            : { terms_acceptance: accepted },
                          _recaptchaToken: recaptchaToken,
                        }),
                      }
                    );
                    if (!acceptRes.ok) {
                      const j = await acceptRes.json().catch(() => ({}));
                      setError(j.error || "Could not record your acceptance.");
                      return false;
                    }
                    return true;
                  }}
                  fetchClientSecret={async (opts) => {
                    // Fresh reCAPTCHA per PI mint (v3 tokens single-use).
                    const recaptchaToken = await recaptcha.execute("invoice_pay");
                    const res = await fetch(
                      `/api/pay/invoice/${invoice.id}/stripe/payment-intent`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          recaptchaToken,
                          // Phase I #13 (2026-09-23): tell the server which
                          // method the customer picked so it can apply the
                          // matching surcharge (+2% UPI) before minting.
                          paymentMethodType: opts?.paymentMethodType || null,
                        }),
                      }
                    );
                    const d = await res.json();
                    if (!res.ok || !d.clientSecret) {
                      throw new Error(d.error || "Could not start payment.");
                    }
                    return {
                      clientSecret: d.clientSecret,
                      totalCents: d.totalCents,
                      surchargeCents: d.surchargeCents,
                      surchargeLabel: d.surchargeLabel,
                    };
                  }}
                  onSuccess={() => {
                    // Optimistic reload — webhook flips the invoice to
                    // PAID in the DB, `load()` picks it up and renders
                    // the existing paid-state block.
                    void load();
                  }}
                  billingDetails={{
                    name: typedName.trim() || invoice.customer.name || undefined,
                    email: invoice.customer.email || undefined,
                    company: invoice.customer.company || undefined,
                  }}
                />
              </div>
            ) : (
              // 2026-10-08: when no real processor is configured, the
              // old flow rendered a "Pay now" button that called
              // /mock-pay and marked the invoice PAID with the "Mock"
              // processor — WITHOUT any money moving. In production
              // that's dangerous: a customer could click Pay, see
              // "Payment successful", and the supplier would get a
              // Telegram "received a payment through Mock" without
              // actually being paid.
              //
              // Replaced with a clear "payment unavailable" notice.
              // The customer should contact the supplier to be given
              // a different link once the supplier has a processor
              // (Stripe, Paddle, etc.) assigned.
              <div
                className="mt-5 p-4 rounded-xl border-2 text-sm"
                style={{ borderColor: "#F59E0B", background: "#FFFBEB", color: "#78350F" }}
              >
                <strong>Payment temporarily unavailable</strong>
                <p className="mt-1 text-xs">
                  Online payment isn&rsquo;t configured on this invoice yet.
                  Please contact {supplier.displayName} for an alternative
                  way to pay.
                </p>
              </div>
            )}

            {vendorTheme ? (
              // Handoff trust signature — bold Ink, dot separators.
              <p
                className="mt-3 text-center text-xs font-semibold"
                style={{ color: ink }}
              >
                Zero hidden fees &nbsp;&middot;&nbsp;{" "}
                {vendor?.licenseText ? "RBI compliant" : "Fully licensed"}
                &nbsp;&middot;&nbsp; Secure transfers
              </p>
            ) : (
              <>
                <div className="mt-4 flex items-center justify-center flex-wrap gap-x-5 gap-y-1.5 text-xs text-gray-600">
                  <span className="flex items-center gap-1.5">
                    <Icon icon="solar:shield-check-bold-duotone" className="w-3.5 h-3.5 text-emerald-600" />
                    Secure payment
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="flex items-center gap-1.5">
                    <Icon icon="solar:card-2-bold-duotone" className="w-3.5 h-3.5" style={{ color: primary }} />
                    Zero hidden fees
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="flex items-center gap-1.5">
                    <Icon icon="solar:lock-keyhole-bold-duotone" className="w-3.5 h-3.5 text-gray-500" />
                    Bank-grade encryption
                  </span>
                </div>
                <p className="mt-3 text-center text-xs text-gray-500">
                  Payment processed by {supplier.displayName}. Card details are never sent to hub.
                </p>
              </>
            )}
          </div>
        )}

        {isPaid && (
          // Phase F #6j (2026-08-28): premium paid state. Ring-animated check,
          // celebration copy, receipt details laid out like a real card, and a
          // print button so the customer can save a proof-of-payment PDF from
          // their own browser without us needing a server-side PDF pipeline.
          <div
            className={`relative rounded-2xl overflow-hidden bg-white ${vendorTheme ? "" : "border-2 shadow-xl"}`}
            style={vendorTheme ? { border: `2px solid ${primary}` } : { borderColor: `${primary}33` }}
          >
            {/* Mego rebrand: no top gradient bar in vendor mode — the design
                keeps the paid state clean, letting the blue check circle
                carry the visual weight. Supplier mode keeps the gradient. */}
            {!vendorTheme && (
              <div className="h-2" style={{ background: `linear-gradient(90deg, ${primary} 0%, ${accent} 100%)` }} />
            )}

            <div className="px-8 py-10 text-center">
              {/* Check circle. Mego rebrand uses a static blue circle with a
                  white tick inside a soft light-blue halo ring — no animation.
                  Non-vendor mode keeps the concentric-ring animated version. */}
              {vendorTheme ? (
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-6" style={{ backgroundColor: `${primary}15` }}>
                  <span
                    className="w-14 h-14 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: primary }}
                  >
                    <Icon icon="solar:check-bold" className="w-8 h-8 text-white" />
                  </span>
                </div>
              ) : (
                <div className="relative inline-flex items-center justify-center mb-6">
                  <span
                    className="absolute inset-0 w-20 h-20 rounded-full animate-ping opacity-25"
                    style={{ backgroundColor: primary, animationDuration: "2s" }}
                  />
                  <span
                    className="relative w-20 h-20 rounded-full flex items-center justify-center shadow-lg"
                    style={{ backgroundColor: primary }}
                  >
                    <Icon icon="solar:check-circle-bold" className="w-11 h-11 text-white" />
                  </span>
                </div>
              )}

              <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Payment received</h2>
              <p className="mt-2 text-sm text-gray-600 max-w-md mx-auto">
                Thank you. A receipt has been recorded on {(vendorTheme && vendor ? vendor.name : supplier.displayName)}&apos;s books
                and emailed to {invoice.customer.email}.
              </p>

              {/* Receipt row — Amount / Paid at / Method */}
              <div className="mt-8 grid grid-cols-3 gap-4 pt-6 border-t border-gray-100 text-center">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Amount</p>
                  <p className="mt-1 font-bold text-gray-900 tabular-nums">
                    {money(invoice.totalCents)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Paid on</p>
                  <p className="mt-1 font-semibold text-gray-900 text-sm">
                    {invoice.paidAt
                      ? new Date(invoice.paidAt).toLocaleDateString(undefined, {
                          month: "short", day: "numeric", year: "numeric",
                        })
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Method</p>
                  <p className="mt-1 font-semibold text-gray-900 text-sm">Card</p>
                </div>
              </div>

              {/* Actions. Mego rebrand: pill "Save receipt as PDF" only —
                  no "Back to {supplier}" button (clean design). Non-vendor
                  mode keeps both buttons. */}
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 transition-colors ${vendorTheme ? "rounded-full border border-gray-200" : "rounded-xl border border-gray-200"}`}
                >
                  <Icon icon="solar:printer-bold-duotone" className="w-4 h-4" />
                  Save receipt as PDF
                </button>
                {!vendorTheme && supplier.websiteUrl && (
                  <a
                    href={supplier.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: primary }}
                  >
                    <Icon icon="solar:arrow-right-linear" className="w-4 h-4" />
                    Back to {supplier.displayName}
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="rounded-2xl bg-gray-50 border border-gray-200 p-6 text-center">
            <p className="text-base font-semibold text-gray-800">This invoice was cancelled</p>
            <p className="mt-1 text-sm text-gray-600">
              Contact {supplier.contactEmail || supplier.displayName} if you believe this is a mistake.
            </p>
          </div>
        )}
      </main>

      {/* Footer. In vendor mode: Midnight Navy per the handoff brand guide
          (dark sections use Midnight; parent endorsement anchors footers,
          licence is stated visibly — compliance credentials are brand
          elements, not fine print). In supplier mode: light footer with
          the hub wordmark. Print-mode hides the whole footer so the
          "Save receipt as PDF" output is clean.
          Phase I #14 (2026-09-23): the entire footer collapses when the
          supplier has turned off tenant_settings.powered_by_visible. */}
      {supplier.poweredByVisible === false ? null : vendorTheme && vendor ? (
        <footer
          className="mt-12 print:hidden"
          style={{ backgroundColor: midnight }}
        >
          <div className="max-w-3xl mx-auto px-6 py-10">
            {/* Trust signature row + RBI-Licensed pill */}
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 pb-6 border-b border-white/10">
              <div className="flex items-center gap-2 text-xs text-white/80">
                <Icon
                  icon="solar:shield-check-bold-duotone"
                  className="w-4 h-4"
                  style={{ color: "#3DB991" }}
                />
                <span className="font-medium">Secure transfers</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-white/80">
                <Icon
                  icon="solar:card-2-bold-duotone"
                  className="w-4 h-4"
                  style={{ color: primary }}
                />
                <span className="font-medium">Zero hidden fees</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-white/80">
                <Icon
                  icon="solar:lock-keyhole-bold-duotone"
                  className="w-4 h-4 text-white/60"
                />
                <span className="font-medium">PCI-DSS compliant</span>
              </div>
              {vendor.licenseText && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-white"
                  style={{ backgroundColor: royalBlue }}
                >
                  <span
                    className="w-1 h-1 rounded-full"
                    style={{ backgroundColor: primary }}
                  />
                  Licensed &amp; Regulated
                </span>
              )}
            </div>

            {/* #Rebrand (2026-08-31): Mego brand pack — big white wordmark
                sits DIRECTLY on the midnight footer (no white chip), matching
                the redesign. "Invoice issued by {vendor}" reads as
                vendor-fronted; "What is MyMego?" is the long-brand link. */}
            <div className="flex flex-col items-center gap-4 pt-8 text-xs text-white/50">
              {vendor.logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={vendor.logoUrl}
                  alt={vendor.name}
                  className="h-10 w-auto block"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).replaceWith(
                      Object.assign(document.createElement("span"), {
                        textContent: vendor.name,
                        className: "text-3xl font-extrabold text-white tracking-tight",
                      })
                    );
                  }}
                />
              ) : (
                <span className="inline-block text-3xl font-extrabold text-white tracking-tight">
                  {vendor.name}
                </span>
              )}
              <p className="text-center">
                Invoice issued by{" "}
                <span className="font-medium text-white/80">{vendor.name}</span>
                {vendor.websiteUrl ? (
                  <>
                    {" · "}
                    <a
                      href={vendor.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white/80 underline decoration-dotted"
                    >
                      Visit {vendor.name}
                    </a>
                  </>
                ) : null}
              </p>
              {(vendor.legalName || vendor.licenseText) && (
                <p className="text-center text-[11px] text-white/40">
                  {vendor.name}
                  {vendor.legalName ? <> is a brand of {vendor.legalName}</> : null}
                  {vendor.legalName && vendor.licenseText ? " · " : ""}
                  {vendor.licenseText || ""}
                </p>
              )}
            </div>
          </div>
        </footer>
      ) : (
        <footer className="max-w-3xl mx-auto px-6 py-12 print:hidden">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 mb-6 pb-6 border-b border-gray-100">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Icon icon="solar:shield-check-bold-duotone" className="w-4 h-4 text-emerald-600" />
              <span className="font-medium">SSL encrypted</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Icon icon="solar:card-2-bold-duotone" className="w-4 h-4" style={{ color: primary }} />
              <span className="font-medium">Processed by Stripe</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Icon icon="solar:lock-keyhole-bold-duotone" className="w-4 h-4 text-gray-600" />
              <span className="font-medium">PCI-DSS compliant</span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3 text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <span>Powered by</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/logo/hub-icon.jpg"
                alt=""
                className="h-5 w-5 rounded object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/logo/hub-wordmark.svg"
                alt="hub"
                className="h-4 w-auto"
                onError={(e) => {
                  const el = e.currentTarget as HTMLImageElement;
                  el.replaceWith(Object.assign(document.createElement("span"), {
                    textContent: "hub",
                    className: "font-bold text-teal-700",
                  }));
                }}
              />
            </div>
            <p className="text-center">
              Invoice issued by <span className="font-medium text-gray-600">{supplier.displayName}</span>
              {" · "}
              <a href="https://synergydatalabs.com/hub" className="hover:text-gray-600 underline decoration-dotted">
                What is hub?
              </a>
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase I #2h (2026-09-08) — InvoiceInlineStripeCheckout
// One-step deferred-Elements checkout for the invoice pay page. Card entry
// + Apple Pay / Google Pay wallet buttons render at page load. Single
// "Pay" button. Same UX + code shape as the /l/[slug] CheckoutForm.
//
// Deferred-intent (Stripe): Elements is initialised with `mode: 'payment'`,
// `amount`, `currency` — no clientSecret at mount time. On Pay:
//   1) onBeforePay() records T&C acceptance server-side (returns false to
//      block payment on failure — no card charge unless acceptance is
//      recorded).
//   2) elements.submit() validates the card form + wallet input.
//   3) fetchClientSecret() calls /stripe/payment-intent, returns cs.
//   4) stripe.confirmPayment({elements, clientSecret, confirmParams}) —
//      redirect: 'if_required' keeps 3DS-free cards on-page; 3DS
//      challenges get an in-page modal OR a full-page redirect (Stripe's
//      call). billing_details on payment_method_data avoids Stripe asking
//      the customer for their name/email/phone again — we already have
//      them from the invoice + typed-name signature.
// ---------------------------------------------------------------------------
const _invoiceStripeInstances: Record<string, Promise<StripeJs | null>> = {};
function _getInvoiceStripeInstance(pk: string): Promise<StripeJs | null> {
  if (!_invoiceStripeInstances[pk]) _invoiceStripeInstances[pk] = loadStripe(pk);
  return _invoiceStripeInstances[pk];
}

// ---------------------------------------------------------------------------
// friendlyStripeError — translate any Stripe SDK error into a customer-safe
// sentence. Mirrors the copy of the same helper in /l/[slug]/page.tsx —
// kept in-file rather than a shared lib to avoid a client bundle round-trip
// for a 40-line function. Any raw developer diagnostic ("You specified
// 'never' for fields.billing_details.phone…") gets replaced with a
// generic apology + retry cue; card_error / validation_error messages
// pass through since those are already customer-friendly.
// ---------------------------------------------------------------------------
function friendlyStripeError(
  err: unknown,
  fallback = "Payment couldn't be completed. Please try a different card or contact your bank."
): string {
  if (!err) return fallback;
  const anyErr = err as {
    type?: string;
    code?: string;
    message?: string;
  } & Record<string, unknown>;
  const raw = typeof anyErr.message === "string" ? anyErr.message : "";
  const type = typeof anyErr.type === "string" ? anyErr.type : "";
  try {
    console.error("[payment]", { type, code: anyErr.code, message: raw });
  } catch { /* ignore */ }
  if (!raw) return fallback;
  const looksLikeDebug =
    /confirmParams|fields\.|\.billing_details|payment_method_data|Element|you specified|stripe\.confirmPayment|\bat\s+\w+\s*\(/i.test(
      raw
    );
  if (looksLikeDebug) return fallback;
  if (type === "card_error" || type === "validation_error") return raw;
  const humanish =
    raw.length <= 200 &&
    !/[{}<>]|[A-Za-z_]\w*\.\w+|[A-Za-z]+[A-Z][a-z]/.test(raw);
  return humanish ? raw : fallback;
}

interface InvoiceInlineStripeCheckoutProps {
  publishableKey: string;
  amountCents: number;
  currency: string;
  invoiceId: string;
  primaryColor: string;
  merchantName: string;
  gated: boolean;
  gatingHint: string;
  onBeforePay: () => Promise<boolean>;
  // Phase I #13 (2026-09-23): the client passes the customer's picked
  // payment method type so the server can apply the +2% UPI surcharge
  // before minting the PaymentIntent.
  fetchClientSecret: (opts?: { paymentMethodType?: string | null }) => Promise<{
    clientSecret: string;
    totalCents?: number;
    surchargeCents?: number;
    surchargeLabel?: string | null;
  }>;
  onSuccess: () => void;
  billingDetails: {
    name?: string;
    email?: string;
    company?: string;
  };
}

function InvoiceInlineStripeCheckout(props: InvoiceInlineStripeCheckoutProps) {
  const stripePromise = useMemo(
    () => _getInvoiceStripeInstance(props.publishableKey),
    [props.publishableKey]
  );

  const options = useMemo(
    () => ({
      mode: "payment" as const,
      amount: props.amountCents,
      currency: props.currency.toLowerCase(),
      appearance: {
        theme: "stripe" as const,
        variables: {
          colorPrimary: props.primaryColor,
          borderRadius: "10px",
        },
      },
    }),
    [props.amountCents, props.currency, props.primaryColor]
  );

  const paymentElementOptions = useMemo(
    () => ({
      fields: {
        billingDetails: {
          name: "never" as const,
          email: "never" as const,
          // FIX 2026-09-10: 'phone: never' required us to also pass phone
          // in confirmParams — invoice customers rarely have one on file,
          // so 'auto' is safer. Stripe only prompts when strictly needed.
          phone: "auto" as const,
          // Stripe requires country at minimum for card processing (AVS).
          // 'auto' shows just the country selector — minimal footprint.
          address: "auto" as const,
        },
      },
      // Kill Stripe Link's "Save my information / create an account"
      // prompt — customers on a one-off invoice pay page read it as a
      // required sign-in step. Apple Pay / Google Pay buttons stay.
      wallets: {
        link: "never" as const,
      },
      defaultValues: {
        billingDetails: {
          name: props.billingDetails.name || undefined,
          email: props.billingDetails.email || undefined,
        },
      },
    }),
    [props.billingDetails.name, props.billingDetails.email]
  );

  return (
    <Elements stripe={stripePromise} options={options}>
      <InvoiceInlineStripeInner {...props} paymentElementOptions={paymentElementOptions} />
    </Elements>
  );
}

function InvoiceInlineStripeInner({
  amountCents,
  currency,
  invoiceId,
  primaryColor,
  merchantName,
  gated,
  gatingHint,
  onBeforePay,
  fetchClientSecret,
  onSuccess,
  billingDetails,
  paymentElementOptions,
}: InvoiceInlineStripeCheckoutProps & {
  paymentElementOptions: Record<string, unknown>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState(false);

  // Phase I #13 (2026-09-23) — UPI +2% surcharge preview.
  // Tracks the customer's picked payment method type in the Stripe
  // PaymentElement so we can preview the surcharge and pass the choice
  // to fetchClientSecret() (server-side is the source of truth — the
  // adjusted amount is what gets captured).
  const [selectedPmType, setSelectedPmType] = useState<string | null>(null);
  const surchargeCents =
    selectedPmType === "upi" ? Math.round(amountCents * 0.02) : 0;
  const surchargeLabel = surchargeCents > 0 ? "Platform fee (2% UPI)" : null;
  const effectiveTotalCents = amountCents + surchargeCents;

  async function runPayment() {
    if (!stripe || !elements) {
      setErr("Payment form is still loading. Give it a second.");
      return;
    }
    if (gated) {
      setErr(gatingHint);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // 1) Record T&C acceptance server-side BEFORE anything hits the card.
      const acceptanceOk = await onBeforePay();
      if (!acceptanceOk) {
        setBusy(false);
        return;
      }

      // 2) Trigger Elements validation.
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setErr(friendlyStripeError(submitError));
        setBusy(false);
        return;
      }

      // 3) Mint the PaymentIntent — fresh reCAPTCHA per call inside.
      //    Pass the picked method type so the server applies the +2%
      //    UPI surcharge before minting (server-side is the source of
      //    truth for what Stripe captures).
      const secretResp = await fetchClientSecret({
        paymentMethodType: selectedPmType,
      });
      const clientSecret =
        typeof secretResp === "string" ? secretResp : secretResp.clientSecret;

      // 4) Confirm. Pass billing_details from our form so Stripe doesn't
      //    re-ask (fields.billingDetails: 'never' above).
      const returnUrl = `${window.location.origin}/pay/invoice/${invoiceId}?paid=1`;
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: returnUrl,
          payment_method_data: {
            billing_details: {
              name: billingDetails.name || undefined,
              email: billingDetails.email || undefined,
            },
          },
        },
        redirect: "if_required",
      });

      if (confirmError) {
        setErr(friendlyStripeError(confirmError));
        setBusy(false);
        return;
      }

      if (paymentIntent && paymentIntent.status === "succeeded") {
        // Phase I #3 (2026-09-10): fire our own on-success endpoint so
        // Telegram + customer receipt + partner emails always land, even
        // if the supplier's Stripe webhook is misconfigured. Idempotent —
        // webhook still fires; whoever wins the not-paid→paid transition
        // fans out. Fire-and-forget: don't block the confirmation UI.
        try {
          await fetch(`/api/pay/invoice/${invoiceId}/paid`, { method: "POST" });
        } catch {
          /* success view renders regardless */
        }
        onSuccess();
        return;
      }
      // processing / requires_action → Stripe already redirected/handled.
      setBusy(false);
    } catch (e: any) {
      setErr(friendlyStripeError(e));
      setBusy(false);
    }
  }

  const payDisabled = busy || !stripe || !cardReady || gated;
  const formatCents = (cents: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(cents / 100);
  const amountLabel = formatCents(effectiveTotalCents);

  return (
    <div>
      {/* Wallet buttons — Apple Pay / Google Pay / Link. Dim + click-blocked
           until T&C accepted so the wallet sheet doesn't open early. */}
      <div
        className="mb-4 transition-opacity"
        style={{
          opacity: gated ? 0.45 : 1,
          pointerEvents: gated ? "none" : "auto",
        }}
      >
        <ExpressCheckoutElement
          options={{
            // Hide Stripe Link's big "Pay with Link" button so customers
            // aren't nudged to create a Link account for a one-off pay
            // page. Apple Pay / Google Pay wallet buttons stay.
            paymentMethods: {
              link: "never" as const,
            },
          }}
          onReady={(e: any) => {
            const anyAvailable = !!(
              e?.availablePaymentMethods && Object.keys(e.availablePaymentMethods).length > 0
            );
            setWalletAvailable(anyAvailable);
          }}
          onClick={(event: any) => {
            if (gated) {
              setErr(gatingHint);
              return; // Don't event.resolve — sheet stays closed
            }
            setErr(null);
            event.resolve({});
          }}
          onConfirm={async () => {
            await runPayment();
          }}
        />
      </div>

      {walletAvailable && (
        <div className="my-3 flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs uppercase tracking-wider text-gray-400">
            or pay with card
          </span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>
      )}

      {!walletAvailable && (
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-gray-500">
            Card details
          </span>
          {gated && (
            <span className="text-xs text-gray-500">{gatingHint}</span>
          )}
        </div>
      )}

      <div
        className="p-4 rounded-xl border transition-opacity"
        style={{
          borderColor: "#E1E4EE",
          background: gated ? "#F5F7F8" : "#FFFFFF",
          opacity: gated ? 0.45 : 1,
          pointerEvents: gated ? "none" : "auto",
        }}
      >
        <PaymentElement
          onReady={() => setCardReady(true)}
          onChange={(event: any) => {
            const t = event?.value?.type;
            if (typeof t === "string" && t !== selectedPmType) {
              setSelectedPmType(t);
            }
          }}
          options={paymentElementOptions as any}
        />
      </div>

      {surchargeCents > 0 && (
        <div
          className="mt-3 p-3 rounded-lg text-sm flex items-center justify-between"
          style={{ background: "#F5F7F8", color: "#6B7385" }}
        >
          <span>{surchargeLabel}</span>
          <strong style={{ color: "#3A4358" }}>{formatCents(surchargeCents)}</strong>
        </div>
      )}

      {err && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {err}
        </div>
      )}

      <button
        type="button"
        onClick={runPayment}
        disabled={payDisabled}
        className="mt-4 w-full py-3 text-white font-semibold rounded-xl transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: primaryColor }}
        title={
          payDisabled && !busy
            ? gatingHint
            : undefined
        }
      >
        {busy ? "Processing payment…" : `Pay ${amountLabel} to ${merchantName}`}
      </button>

      <p className="mt-3 text-center text-xs text-gray-500">
        Card processed securely by Stripe. Your card details are never sent to us.
      </p>
    </div>
  );
}
