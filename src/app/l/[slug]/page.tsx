"use client";

// Phase I #1 (2026-09-08) — Public Payment Link checkout page.
//
// Customer lands here after clicking a partner-hosted link. We render:
//   • Merchant / partner branding (co-branded if the link specifies)
//   • Product name + description + unit price
//   • Quantity — locked if URL has ?qty= OR link is qtyLocked, else stepper
//   • Live total = unit × qty
//   • Customer info form (email always required; name/phone/company per link config)
//   • Terms acceptance checkbox (mandatory)
//   • "Continue to payment" button
//
// On submit we POST to /api/public/payment-links/[slug]/checkout which
// creates a SupplierInvoice from the link template + returns the URL of
// the existing /pay/invoice/[id] page. We window.location = that URL.
// From there the existing pay flow (processor / receipts / webhooks)
// takes over — this page is intentionally thin.

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
// Phase I #2 (2026-09-08): send a reCAPTCHA v3 token on submit so the
// checkout POST passes the server-side verify (mirrors the invoice pay
// page). Fails open when NEXT_PUBLIC_RECAPTCHA_SITE_KEY is unset.
import { useRecaptcha } from "@/hooks/useRecaptcha";
// Phase I #2b (2026-09-08): inline card entry — no redirect to
// /pay/invoice/[id]. The Stripe Elements form mounts on this same page
// once the invoice + PaymentIntent are created behind the scenes.
import StripePaymentSection from "@/app/pay/invoice/[invoiceId]/StripePaymentSection";
// Phase I #2e (2026-09-08): deferred-intent Elements. Card fields render
// from page load (no clientSecret required initially) — customer sees the
// card entry alongside the form. On Pay, we create the invoice + PI +
// confirm the payment in one server round trip.
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  // Phase I #2g (2026-09-08): ExpressCheckoutElement renders the BIG
  // "Pay with Apple Pay" / "Pay with Google Pay" / "Pay with Link"
  // buttons that Stripe Checkout shows at the top. PaymentElement
  // alone shows wallets as small inline chips — most users don't see
  // them. ExpressCheckoutElement shows them as prominent primary
  // buttons before the card fields.
  ExpressCheckoutElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

// MEGO brand palette — copied from the vendor-mode section of the
// invoice pay page so this checkout feels visually continuous with it.
//   Deep Navy      #0E2145  hero background
//   Midnight       #0E234E  footer / dark sections
//   Electric Blue  #006AFF  primary CTA / links
//   Royal Blue     #093988  RBI / trust pill text
//   Cloud          #F5F7F8  page surface
//   Ink            #0F1729  strong body text on light
const MEGO_NAVY = "#0E2145";
const MEGO_MIDNIGHT = "#0E234E";
const MEGO_BLUE = "#006AFF";
const MEGO_ROYAL = "#093988";
const MEGO_CLOUD = "#F5F7F8";
const MEGO_INK = "#0F1729";
const MEGO_INK_2 = "#3A4358";      // secondary body text
const MEGO_INK_3 = "#6B7385";      // muted labels / small print
const MEGO_WORDMARK_WHITE = "/images/logo/MEGO-Logo-Pack/wordmark/MEGO-wordmark-white-360.png";
const MEGO_WORDMARK_BLUE = "/images/logo/MEGO-Logo-Pack/wordmark/MEGO-wordmark-blue-360.png";

interface LinkData {
  success: boolean;
  available: boolean;
  unavailableReason: string | null;
  link: {
    id: string;
    shortSlug: string;
    nickname: string;
    mode: "one_time" | "subscription";
    interval: string | null;
    intervalCount: number | null;
    currency: string;
    redirectUrl: string | null;
    requireName: boolean;
    requirePhone: boolean;
    requireCompany: boolean;
    qtyLocked: boolean;
    qtyDefault: number;
    qtyMin: number;
    qtyMax: number | null;
    amountLocked: boolean;
    amountMinCents: number | null;
    amountMaxCents: number | null;
  };
  amountEditable: boolean;
  product: {
    id: string | null;
    name: string;
    description: string | null;
    unitLabel: string;
  };
  unitAmountCents: number | null;
  quantity: number;
  qtyEditable: boolean;
  totalCents: number | null;
  merchant: {
    displayName: string;
    logoUrl: string | null;
    supplierDisplayName: string;
    // Phase I #14 (2026-09-23): false = hide the MEGO wordmark header,
    // "Sold on hub by MEGO" caption, midnight MEGO footer, and the
    // "processed by MEGO" line in the T&C row.
    poweredByVisible?: boolean;
    // 2026-10-06: per-tenant preferred payment method on the Stripe
    // PaymentElement. "upi" / "card" / null. Null = Stripe default order.
    preferredPaymentMethod?: string | null;
  };
  // Phase I #2e: supplier's Stripe publishable key. Null when the supplier
  // has no Stripe processor — checkout falls back to the redirect flow.
  stripePublishableKey: string | null;
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function subscriptionLabel(link: LinkData["link"]) {
  if (link.mode !== "subscription") return null;
  const n = link.intervalCount || 1;
  return `Every ${n === 1 ? "" : n + " "}${link.interval}${n === 1 ? "" : "s"}`;
}

export default function PaymentLinkCheckout() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const slug = params?.slug || "";
  const urlQty = search?.get("qty");
  const attribution = search?.get("ref") || search?.get("utm_source");

  const recaptcha = useRecaptcha();

  const [data, setData] = useState<LinkData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Phase I #2c: supplier T&C (product-level or tenant default). Null when
  // the supplier hasn't published any — we fall back to a single-box
  // confirmation. Fetched in parallel with the link data.
  const [terms, setTerms] = useState<{
    id: string;
    version: string;
    bodyMarkdown: string;
  } | null>(null);
  const [termsExpanded, setTermsExpanded] = useState(false);
  // Signature = the customer's "Full name" from the "Your details"
  // section (kept as separate state for future decoupling but auto-
  // synced from `name` via the useEffect below — one place to type).
  const [typedName, setTypedName] = useState("");
  // Three separate consents mirror the invoice pay page's vendor-mode
  // fieldset (chargeback-defense: T&C + immediate-supply waiver + non-
  // refundable ack). Master toggle below flips all three at once.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedSupply, setAcceptedSupply] = useState(false);
  const [acceptedNoRefund, setAcceptedNoRefund] = useState(false);

  // Form state — acceptedTerms is declared above alongside acceptedSupply
  // and acceptedNoRefund. When no supplier T&C is published, that single
  // acceptedTerms flag is the fallback confirm box.
  const [quantity, setQuantity] = useState<number>(1);
  // Phase I #12 (2026-09-22): customer-editable unit amount when the
  // link has amountLocked=false. Held as a string so the input stays
  // controlled (empty allowed while user is typing).
  const [amountInput, setAmountInput] = useState<string>("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-sync the T&C signature from the "Full name" field. Customer
  // types their name once; it's used as invoice name AND signature AND
  // the billing_details.name passed to Stripe on confirm.
  useEffect(() => {
    setTypedName(name);
  }, [name]);

  // Phase I #2b: once the customer clicks Continue, we create the invoice
  // + PaymentIntent server-side and mount Stripe Elements inline on this
  // page. `stripeSession` holds everything the Elements form needs.
  const [stripeSession, setStripeSession] = useState<{
    invoiceId: string;
    clientSecret: string;
    publishableKey: string;
    totalCents: number;
    currency: string;
  } | null>(null);
  // Set when the inline card payment succeeds — swaps the checkout out
  // for a confirmation card so the customer doesn't leave the page.
  const [paidConfirm, setPaidConfirm] = useState<{
    invoiceNumber: string;
    totalCents: number;
    currency: string;
  } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const qs = urlQty ? `?qty=${encodeURIComponent(urlQty)}` : "";
        // Parallel — link + T&C. If terms fails we degrade to the simple
        // single-box confirm; not a blocker for the link.
        const [linkRes, termsRes] = await Promise.all([
          fetch(`/api/public/payment-links/${slug}${qs}`),
          fetch(`/api/public/payment-links/${slug}/terms`).catch(() => null),
        ]);
        const json = await linkRes.json();
        if (!linkRes.ok) {
          setLoadError(json.error || "Payment link not available");
          setLoading(false);
          return;
        }
        setData(json);
        setQuantity(json.quantity);
        // Prefill the editable-amount input from the link's default
        // (in dollars). Only relevant when the link is unlocked.
        if (json.link?.amountLocked === false && typeof json.unitAmountCents === "number") {
          setAmountInput((json.unitAmountCents / 100).toFixed(2));
        }
        if (termsRes && termsRes.ok) {
          const termsJson = await termsRes.json();
          if (termsJson.success && termsJson.terms) {
            setTerms(termsJson.terms);
          }
        }
      } catch (err: any) {
        setLoadError(err?.message || "Failed to load payment link");
      } finally {
        setLoading(false);
      }
    }
    if (slug) load();
  }, [slug, urlQty]);

  // Effective acceptance — when the supplier has T&C, all three boxes
  // must be checked (with typed name); when they don't, the simple
  // single-box confirm is enough (existing acceptedTerms state).
  const allAccepted = terms
    ? acceptedTerms && acceptedSupply && acceptedNoRefund
    : acceptedTerms;

  // Master toggle helper — flips all three consents at once. Customer
  // still keeps the option to review the T&C in the expandable panel.
  function toggleAcceptAll(next: boolean) {
    setAcceptedTerms(next);
    if (terms) {
      setAcceptedSupply(next);
      setAcceptedNoRefund(next);
    }
  }

  // Phase I #12 (2026-09-22): resolve the effective unit amount.
  // - Locked link → always the link's unitAmountCents
  // - Unlocked link → parse the customer's input (dollars → cents)
  const effectiveUnitAmountCents = useMemo(() => {
    if (!data) return null;
    if (data.link.amountLocked) return data.unitAmountCents;
    const parsed = Number(amountInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed * 100);
  }, [data, amountInput]);

  const total = useMemo(() => {
    if (effectiveUnitAmountCents == null) return null;
    return effectiveUnitAmountCents * quantity;
  }, [effectiveUnitAmountCents, quantity]);

  function bumpQty(delta: number) {
    if (!data) return;
    const nextRaw = quantity + delta;
    const min = data.link.qtyMin;
    const max = data.link.qtyMax ?? Number.MAX_SAFE_INTEGER;
    setQuantity(Math.max(min, Math.min(max, nextRaw)));
  }

  async function submit() {
    if (!data) return;
    setSubmitError(null);

    // Client-side validation mirroring the API — better UX than round-trip.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setSubmitError("Please enter a valid email address");
      return;
    }
    if (data.link.requireName && !name.trim()) {
      setSubmitError("Name is required");
      return;
    }
    if (data.link.requirePhone && !phone.trim()) {
      setSubmitError("Phone is required");
      return;
    }
    if (data.link.requireCompany && !company.trim()) {
      setSubmitError("Company is required");
      return;
    }
    // Phase I #12 (2026-09-22): editable-amount validation on the
    // client — mirrors server bounds check for a snappy error.
    if (!data.link.amountLocked) {
      if (effectiveUnitAmountCents == null || effectiveUnitAmountCents <= 0) {
        setSubmitError("Please enter a valid amount");
        return;
      }
      if (data.link.amountMinCents != null && effectiveUnitAmountCents < data.link.amountMinCents) {
        setSubmitError(
          `Minimum amount is ${formatMoney(data.link.amountMinCents, data.link.currency)}`
        );
        return;
      }
      if (data.link.amountMaxCents != null && effectiveUnitAmountCents > data.link.amountMaxCents) {
        setSubmitError(
          `Maximum amount is ${formatMoney(data.link.amountMaxCents, data.link.currency)}`
        );
        return;
      }
    }
    if (!allAccepted) {
      setSubmitError(
        terms
          ? "Please tick all three consent boxes to continue"
          : "You must accept the Terms of Service and Privacy Policy"
      );
      return;
    }
    if (terms && !typedName.trim()) {
      setSubmitError("Please type your full name to sign the terms");
      return;
    }

    setSubmitting(true);
    try {
      // Single reCAPTCHA token — v3 tokens are single-use, so we combined
      // the invoice-create + PaymentIntent-mint into one server call.
      const recaptchaToken = await recaptcha.execute("payment_link_checkout");
      const invRes = await fetch(`/api/public/payment-links/${slug}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          company: company.trim() || undefined,
          quantity,
          // Phase I #12 (2026-09-22): send override only for unlocked links.
          unitAmountOverrideCents:
            !data.link.amountLocked && effectiveUnitAmountCents != null
              ? effectiveUnitAmountCents
              : undefined,
          acceptedTerms: true,
          // When the supplier has published a real T&C, include the version
          // + typed signature + individual consent flags so the server can
          // record the full chargeback-defense acceptance row.
          termsVersionId: terms?.id ?? undefined,
          acceptedTermsVersion: terms?.version ?? "checkout-v1",
          acceptedName: terms ? typedName.trim() : undefined,
          consents: terms
            ? {
                terms_acceptance: acceptedTerms,
                immediate_supply_waiver: acceptedSupply,
                non_refundable_ack: acceptedNoRefund,
              }
            : { terms_acceptance: acceptedTerms },
          attributionOverride: attribution || undefined,
          recaptchaToken,
        }),
      });
      const invJson = await invRes.json();
      if (!invRes.ok) throw new Error(invJson.error || "Checkout failed");

      // Server returns clientSecret + publishableKey inline when the
      // supplier has Stripe configured. When missing, fall back to the
      // redirect page (mock-pay, Moneris etc will render there).
      if (!invJson.clientSecret || !invJson.publishableKey) {
        window.location.href = invJson.redirectUrl;
        return;
      }

      setStripeSession({
        invoiceId: invJson.invoiceId,
        clientSecret: invJson.clientSecret,
        publishableKey: invJson.publishableKey,
        totalCents: invJson.totalCents,
        currency: invJson.currency,
      });
      setSubmitting(false);
    } catch (err: any) {
      setSubmitError(err?.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  // Builds the JSON body for POST /checkout — used by both the
  // legacy Continue button (submit()) and the new CheckoutForm's Pay
  // flow. Fresh reCAPTCHA token minted per call (v3 tokens are
  // single-use). Returns the body plus the token that was used so
  // the CheckoutForm can log if needed.
  async function buildCheckoutBody(): Promise<Record<string, unknown>> {
    const recaptchaToken = await recaptcha.execute("payment_link_checkout");
    return {
      email: email.trim(),
      name: name.trim() || undefined,
      phone: phone.trim() || undefined,
      company: company.trim() || undefined,
      quantity,
      acceptedTerms: true,
      termsVersionId: terms?.id ?? undefined,
      acceptedTermsVersion: terms?.version ?? "checkout-v1",
      acceptedName: terms ? typedName.trim() : undefined,
      consents: terms
        ? {
            terms_acceptance: acceptedTerms,
            immediate_supply_waiver: acceptedSupply,
            non_refundable_ack: acceptedNoRefund,
          }
        : { terms_acceptance: acceptedTerms },
      attributionOverride: attribution || undefined,
      recaptchaToken,
    };
  }

  function onPaymentSuccess() {
    // Elements just charged the card. Fire the confirmation view —
    // the customer never leaves the page. Webhook will land in the
    // background and flip the invoice to PAID in the DB.
    if (stripeSession) {
      setPaidConfirm({
        invoiceNumber: stripeSession.invoiceId.slice(0, 8),
        totalCents: stripeSession.totalCents,
        currency: stripeSession.currency,
      });
    }
    // If the link has a redirect_url configured, honour it — bounce the
    // customer back to the partner's own thank-you page after ~1.5s so
    // they see the confirmation briefly first.
    if (data?.link.redirectUrl) {
      setTimeout(() => {
        window.location.href = data.link.redirectUrl!;
      }, 1500);
    }
  }

  // ------------- Renders --------------

  if (loading) {
    return (
      <Shell>
        <div className="text-center py-16">
          <div className="animate-spin inline-block h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
          <p className="mt-4 text-sm text-gray-500">Loading checkout…</p>
        </div>
      </Shell>
    );
  }

  if (loadError || !data) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-100 text-red-700 text-2xl mb-4">
            ⚠
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {loadError || "Payment link not available"}
          </h1>
          <p className="text-sm text-gray-600">
            Please check the URL, or return to the site you clicked from and try again.
          </p>
        </div>
      </Shell>
    );
  }

  if (!data.available) {
    const reasonCopy: Record<string, string> = {
      disabled: "This payment link has been disabled by the seller.",
      expired: "This payment link has expired.",
      at_capacity: "This payment link has reached its maximum number of uses.",
      product_inactive: "The product this link points to is no longer available.",
    };
    return (
      <Shell merchantName={data.merchant.displayName} logoUrl={data.merchant.logoUrl}>
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 text-amber-700 text-2xl mb-4">
            ⏱
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link unavailable</h1>
          <p className="text-sm text-gray-600">
            {reasonCopy[data.unavailableReason || ""] ||
              "This payment link is not currently accepting payments."}
          </p>
          <p className="text-xs text-gray-500 mt-4">
            Please contact <strong>{data.merchant.supplierDisplayName}</strong> for a new link.
          </p>
        </div>
      </Shell>
    );
  }

  const subLabel = subscriptionLabel(data.link);
  const showStepper = data.qtyEditable;

  return (
    <Shell
      merchantName={data.merchant.displayName}
      logoUrl={data.merchant.logoUrl}
      poweredBy={
        data.merchant.displayName !== data.merchant.supplierDisplayName
          ? `Sold by ${data.merchant.supplierDisplayName}`
          : null
      }
      showPlatformChrome={data.merchant.poweredByVisible !== false}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Amount due — mirrors the invoice pay page's hero panel. Facts
             only: amount + status pill. No marketing copy. */}
        <div className="p-6 border-b border-gray-100 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider" style={{ color: MEGO_INK_3 }}>
              Amount due
            </div>
            <div className="mt-1 text-3xl font-bold" style={{ color: MEGO_INK }}>
              {total != null
                ? formatMoney(total, data.link.currency)
                : "—"}
            </div>
            {subLabel && total != null && (
              <div className="mt-1 text-xs" style={{ color: MEGO_INK_3 }}>
                Then {formatMoney(total, data.link.currency)} {subLabel.toLowerCase()}
              </div>
            )}
          </div>
          <span
            className="px-3 py-1 rounded-full text-xs font-semibold"
            style={{ background: `${MEGO_ROYAL}15`, color: MEGO_ROYAL }}
          >
            Awaiting payment
          </span>
        </div>

        {/* Amount editor — shown only when the link is unlocked. Phase I #12 */}
        {data.link.amountLocked === false && (
          <div className="p-6 border-b border-gray-100">
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: MEGO_INK_3 }}>
              Amount ({data.link.currency})
            </div>
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-sm">
                  {data.link.currency}
                </span>
                <input
                  type="number"
                  min={
                    data.link.amountMinCents != null
                      ? (data.link.amountMinCents / 100).toString()
                      : "0.01"
                  }
                  max={
                    data.link.amountMaxCents != null
                      ? (data.link.amountMaxCents / 100).toString()
                      : undefined
                  }
                  step="0.01"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full pl-14 pr-3 py-2.5 border border-gray-300 rounded-lg font-mono text-lg font-semibold text-right focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="0.00"
                />
              </div>
              {(data.link.amountMinCents != null || data.link.amountMaxCents != null) && (
                <div className="text-xs text-gray-500">
                  {data.link.amountMinCents != null && (
                    <>Min {formatMoney(data.link.amountMinCents, data.link.currency)}</>
                  )}
                  {data.link.amountMinCents != null && data.link.amountMaxCents != null && " · "}
                  {data.link.amountMaxCents != null && (
                    <>Max {formatMoney(data.link.amountMaxCents, data.link.currency)}</>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quantity (only when the checkout allows editing) */}
        {data.unitAmountCents != null && showStepper && (
          <div className="p-6 border-b border-gray-100">
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: MEGO_INK_3 }}>
              Quantity
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => bumpQty(-1)}
                disabled={quantity <= data.link.qtyMin}
                className="w-10 h-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-lg font-bold text-gray-700"
              >
                −
              </button>
              <div className="w-16 text-center font-mono text-lg font-semibold">
                {quantity}
              </div>
              <button
                type="button"
                onClick={() => bumpQty(1)}
                disabled={data.link.qtyMax != null && quantity >= data.link.qtyMax}
                className="w-10 h-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed text-lg font-bold text-gray-700"
              >
                +
              </button>
              <div className="text-xs text-gray-500 ml-2">
                Min {data.link.qtyMin}
                {data.link.qtyMax != null && ` · Max ${data.link.qtyMax}`}
              </div>
            </div>
          </div>
        )}

        {/* Line items table — matches the invoice pay page.
             DESCRIPTION | QTY | UNIT PRICE | TOTAL. Just facts. */}
        {data.unitAmountCents != null && (
          <div className="p-6 border-b border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider" style={{ color: MEGO_INK_3 }}>
                  <th className="text-left py-2 font-semibold">Description</th>
                  <th className="text-center py-2 font-semibold">Qty</th>
                  <th className="text-right py-2 font-semibold">Unit price</th>
                  <th className="text-right py-2 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="border-t" style={{ borderColor: "#E1E4EE" }}>
                <tr>
                  <td className="py-3 font-medium" style={{ color: MEGO_INK }}>
                    {data.product.name}
                    {!showStepper && urlQty != null && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        ↩ Return to the previous page to change quantity
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-center font-mono" style={{ color: MEGO_INK_2 }}>
                    {quantity}
                  </td>
                  <td className="py-3 text-right" style={{ color: MEGO_INK_2 }}>
                    {formatMoney(data.unitAmountCents, data.link.currency)}
                    <div className="text-[10px]" style={{ color: MEGO_INK_3 }}>
                      /{data.product.unitLabel}
                    </div>
                  </td>
                  <td className="py-3 text-right font-semibold" style={{ color: MEGO_INK }}>
                    {formatMoney(total ?? data.unitAmountCents * quantity, data.link.currency)}
                  </td>
                </tr>
              </tbody>
              <tfoot className="border-t" style={{ borderColor: "#E1E4EE" }}>
                <tr>
                  <td colSpan={3} className="py-3 text-right text-sm" style={{ color: MEGO_INK_3 }}>
                    Subtotal
                  </td>
                  <td className="py-3 text-right text-sm" style={{ color: MEGO_INK_2 }}>
                    {formatMoney(total ?? data.unitAmountCents * quantity, data.link.currency)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} className="py-2 text-right text-base font-bold" style={{ color: MEGO_INK }}>
                    Total
                  </td>
                  <td className="py-2 text-right text-xl font-bold" style={{ color: MEGO_BLUE }}>
                    {formatMoney(total ?? data.unitAmountCents * quantity, data.link.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Total */}
        {total != null && (
          <div className="p-6 border-b border-gray-100 bg-gray-50">
            <div className="flex justify-between items-center text-sm text-gray-600 mb-2">
              <span>{quantity} × {formatMoney(data.unitAmountCents!, data.link.currency)}</span>
              <span>{formatMoney(total, data.link.currency)}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-medium text-gray-700">Total today</span>
              <span className="text-2xl font-bold text-gray-900">
                {formatMoney(total, data.link.currency)}
                <span className="text-sm text-gray-500 ml-1">{data.link.currency}</span>
              </span>
            </div>
            {subLabel && (
              <div className="text-xs text-gray-500 mt-1 text-right">
                Then {formatMoney(total, data.link.currency)} {subLabel.toLowerCase()}
              </div>
            )}
          </div>
        )}

        {/* Customer info */}
        <div className="p-6 border-b border-gray-100">
          <div className="text-sm font-medium text-gray-700 mb-3">Your details</div>
          <div className="space-y-3">
            <input
              type="email"
              placeholder="Email address (required)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
              autoComplete="email"
              required
            />
            <p className="mt-1.5 text-xs" style={{ color: MEGO_INK_3 }}>
              We&rsquo;ll email your payment receipt here.
            </p>
            {data.link.requireName && (
              <input
                type="text"
                placeholder="Full name (required)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                autoComplete="name"
                required
              />
            )}
            {data.link.requirePhone && (
              <input
                type="tel"
                placeholder="Phone (required)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                autoComplete="tel"
                required
              />
            )}
            {data.link.requireCompany && (
              <input
                type="text"
                placeholder="Company (required)"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                autoComplete="organization"
                required
              />
            )}
          </div>
        </div>

        {/* Terms — three-tier flow matching the invoice pay page's vendor
             mode when the supplier has published a real T&C. Falls back to
             a single-box confirmation when they haven't. */}
        <div className="p-6 border-b border-gray-100">
          {terms ? (
            <>
              {/* Expandable T&C viewer */}
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden mb-4">
                <button
                  type="button"
                  onClick={() => setTermsExpanded((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {data.merchant.supplierDisplayName}&apos;s Terms &amp; Conditions
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Version <span className="font-mono">{terms.version}</span> · Read before you accept
                    </p>
                  </div>
                  <span className="text-gray-400 text-lg">{termsExpanded ? "▲" : "▼"}</span>
                </button>
                {termsExpanded && (
                  <div className="border-t border-gray-100 p-4 max-h-72 overflow-y-auto bg-gray-50">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed m-0">
                      {terms.bodyMarkdown}
                    </pre>
                  </div>
                )}
              </div>

              {/* Signature — auto-populated from the "Full name" field in
                   the "Your details" section above. Customer types their
                   name once; it's used as the invoice name, the T&C
                   signature, AND the billing name on the Stripe charge.
                   Displayed as read-only here so the customer sees what
                   they signed as (and that it will match their card). */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  Signed as (must match the name on your card)
                </label>
                <div
                  className="w-full px-4 py-3 border border-dashed rounded-xl text-sm"
                  style={{
                    borderColor: "#E1E4EE",
                    background: "#F5F7F8",
                    color: name.trim() ? MEGO_INK : MEGO_INK_3,
                    fontStyle: name.trim() ? "normal" : "italic",
                  }}
                >
                  {name.trim() || "Type your name in the field above ↑"}
                </div>
              </div>

              {/* Single acceptance checkbox — the three legal statements
                   sit BELOW as informational bullets. One check = agrees
                   to all three (recorded in the acceptance receipt with
                   the full consent flags). */}
              <label
                className="flex items-start gap-3 text-sm cursor-pointer mb-3 p-3 rounded-lg border-2"
                style={{
                  borderColor: allAccepted ? MEGO_BLUE : "#E1E4EE",
                  background: allAccepted ? "#F0F5FF" : "#FFFFFF",
                }}
              >
                <input
                  type="checkbox"
                  checked={allAccepted}
                  onChange={(e) => toggleAcceptAll(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 shrink-0"
                  style={{ accentColor: MEGO_BLUE }}
                />
                <span className="text-gray-900 font-semibold">
                  I have read and agree to all of the following:
                </span>
              </label>

              {/* Three informational lines — the exact legal statements
                   the customer is consenting to. Not clickable; the
                   single checkbox above stands for all three. */}
              <ul
                className="space-y-2.5 pl-4 text-sm"
                style={{ color: MEGO_INK_2 }}
              >
                <li className="relative">
                  <span
                    className="absolute -left-4 top-2 w-1.5 h-1.5 rounded-full"
                    style={{ background: MEGO_INK_3 }}
                  />
                  I have read and agree to {data.merchant.supplierDisplayName}&apos;s{" "}
                  <button
                    type="button"
                    onClick={() => setTermsExpanded(true)}
                    className="underline"
                    style={{ color: MEGO_BLUE }}
                  >
                    Terms and Conditions &amp; Refund Policy
                  </button>{" "}
                  (version <span className="font-mono">{terms.version}</span>).
                </li>
                <li className="relative">
                  <span
                    className="absolute -left-4 top-2 w-1.5 h-1.5 rounded-full"
                    style={{ background: MEGO_INK_3 }}
                  />
                  I request immediate delivery of the digital product(s) in this order and I acknowledge that once delivery has begun I lose my 14-day right of withdrawal / cancellation.
                </li>
                <li className="relative">
                  <span
                    className="absolute -left-4 top-2 w-1.5 h-1.5 rounded-full"
                    style={{ background: MEGO_INK_3 }}
                  />
                  I understand that this is a digital product delivered instantly, that it is non-refundable once delivered, and that I will contact <strong>{data.merchant.supplierDisplayName}</strong> before contacting my bank if anything is wrong with my order.
                </li>
              </ul>

              <p className="mt-4 text-[11px] text-gray-500">
                Signed by <span className="font-medium">{typedName.trim() || "(type your name above)"}</span>
                {" · "}Terms version <span className="font-mono">{terms.version}</span>
                {" · "}Your IP address, browser and timestamp are recorded as proof of acceptance.
              </p>
            </>
          ) : (
            // Fallback — supplier hasn't published T&C, single-box confirm.
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 rounded border-gray-300"
                style={{ accentColor: MEGO_BLUE }}
              />
              <span className="text-xs text-gray-600 leading-relaxed">
                I agree to <strong>{data.merchant.supplierDisplayName}</strong>&apos;s Terms of Service
                {data.merchant.poweredByVisible !== false && (
                  <> , MEGO&apos;s Terms of Service,</>
                )}
                {" "}and Privacy Policy.
                {data.merchant.poweredByVisible !== false && (
                  <> Payments are processed securely by MEGO on Stripe.</>
                )}
                {" "}
                {data.link.mode === "subscription" && (
                  <span className="block mt-1">
                    <strong>This is a recurring subscription.</strong> Your payment method
                    will be charged {formatMoney(total ?? 0, data.link.currency)} {subLabel?.toLowerCase()}
                    {" "}until cancelled.
                  </span>
                )}
              </span>
            </label>
          )}
        </div>

        {/* Pay section — one-step flow (Option C). Card fields are visible
             from page load via Stripe Elements in deferred-intent mode.
             The Pay button is disabled until all upstream fields are valid
             (email + terms + card). When the supplier has no Stripe, we
             fall back to a redirect Continue button so mock-pay / Moneris
             still work.

             Three states:
               1. Paid confirmation (post-success)
               2. Elements + Pay button (Stripe path — most cases)
               3. Redirect Continue button (non-Stripe fallback) */}
        <div className="p-6">
          {paidConfirm ? (
            <div className="p-6 rounded-xl border-2 text-center" style={{ borderColor: "#10E39A", background: "#F0FFF9" }}>
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-3" style={{ background: "#10E39A" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-lg font-bold text-gray-900">Payment successful</div>
              <div className="text-sm text-gray-600 mt-1">
                {formatMoney(paidConfirm.totalCents, paidConfirm.currency)} paid to{" "}
                <strong>{data.merchant.displayName}</strong>
              </div>
              <div className="text-xs text-gray-500 mt-3">
                A receipt has been emailed to <strong>{email}</strong>.
              </div>
              {data.link.redirectUrl && (
                <div className="text-xs text-gray-500 mt-2">
                  Redirecting you back to {data.merchant.displayName}…
                </div>
              )}
            </div>
          ) : data.stripePublishableKey && total != null ? (
            <CheckoutForm
              publishableKey={data.stripePublishableKey}
              amountCents={total}
              currency={data.link.currency}
              preferredPaymentMethod={data.merchant.preferredPaymentMethod ?? null}
              buildBody={() => buildCheckoutBody()}
              allInputsValid={
                !submitting &&
                allAccepted &&
                !!email.trim() &&
                !!name.trim() &&
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
              }
              merchantName={data.merchant.displayName}
              redirectUrl={data.link.redirectUrl}
              customerName={name}
              customerEmail={email}
              customerPhone={phone}
              onSuccess={(invoiceId) => {
                setPaidConfirm({
                  invoiceNumber: invoiceId.slice(0, 8),
                  totalCents: total,
                  currency: data.link.currency,
                });
                if (data.link.redirectUrl) {
                  setTimeout(() => {
                    window.location.href = data.link.redirectUrl!;
                  }, 1500);
                }
              }}
            />
          ) : (
            <>
              {submitError && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {submitError}
                </div>
              )}
              <button
                onClick={submit}
                disabled={submitting || !allAccepted || (!!terms && !typedName.trim())}
                className="w-full py-3 text-white font-semibold rounded-xl transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: MEGO_BLUE }}
              >
                {submitting
                  ? "Preparing checkout…"
                  : `Continue to payment${total != null ? ` — ${formatMoney(total, data.link.currency)}` : ""}`}
              </button>
              <div className="mt-3 text-center text-xs" style={{ color: MEGO_INK_3 }}>
                You&apos;ll be taken to a secure payment page.
              </div>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// CheckoutForm — Phase I #2e (2026-09-08). Stripe Elements in deferred-
// intent mode: card fields render from page load, no clientSecret needed
// initially. On Pay, we call the /checkout endpoint (which creates the
// invoice, records T&C acceptance, and mints the PaymentIntent in one
// server round trip), then confirm the payment inline with the returned
// clientSecret. Success bubbles up via onSuccess(invoiceId).
// ---------------------------------------------------------------------------
const _stripeInstances: Record<string, Promise<StripeJs | null>> = {};
function getStripeInstance(pk: string): Promise<StripeJs | null> {
  if (!_stripeInstances[pk]) _stripeInstances[pk] = loadStripe(pk);
  return _stripeInstances[pk];
}

// ---------------------------------------------------------------------------
// friendlyStripeError — translate anything thrown or returned from Stripe
// into a customer-safe sentence. The default Stripe SDK errors contain
// developer diagnostics like "You specified 'never' for fields.billing_
// details.phone when creating the payment Element…" — surfacing that to a
// customer looks broken and leaks internals. This helper:
//
//   - PASSES THROUGH: card_error and validation_error messages when they
//     read as customer-friendly (short, no code references, no dot-paths).
//     Stripe's card errors like "Your card was declined" or "Incorrect
//     CVC" are already the right thing to show.
//   - REPLACES: anything else (invalid_request, api_error, internal debug
//     strings) with a short generic apology + retry cue. The real error
//     goes to console for us to see in the browser devtools.
//
// Detection is conservative: any message containing "confirmParams",
// "fields.", "Element", ".billing_details", "you specified", a stack
// trace or an object-path dot-chain is treated as a debug leak.
// ---------------------------------------------------------------------------
function friendlyStripeError(
  err: unknown,
  fallback = "Payment couldn't be completed. Please try a different card or contact your bank."
): string {
  if (!err) return fallback;

  // Stripe SDK errors are objects with { type, code, message } — plain
  // Errors have just { message }. Both go through the same detector.
  const anyErr = err as {
    type?: string;
    code?: string;
    message?: string;
  } & Record<string, unknown>;

  const raw = typeof anyErr.message === "string" ? anyErr.message : "";
  const type = typeof anyErr.type === "string" ? anyErr.type : "";

  // Log the real error so we can debug from the browser console.
  try {
    console.error("[payment]", { type, code: anyErr.code, message: raw });
  } catch {
    /* console may not exist in some embedded WebViews */
  }

  if (!raw) return fallback;

  // Detect developer-facing strings — these must never leak to customers.
  const looksLikeDebug =
    /confirmParams|fields\.|\.billing_details|payment_method_data|Element|you specified|stripe\.confirmPayment|\bat\s+\w+\s*\(/i.test(
      raw
    );
  if (looksLikeDebug) return fallback;

  // Card + validation errors from Stripe are already customer-friendly.
  if (type === "card_error" || type === "validation_error") return raw;

  // Anything else — keep the message ONLY if it's short and looks like a
  // human sentence (no dot-paths, no camelCase identifiers, no braces).
  const humanish =
    raw.length <= 200 &&
    !/[{}<>]|[A-Za-z_]\w*\.\w+|[A-Za-z]+[A-Z][a-z]/.test(raw);
  return humanish ? raw : fallback;
}

interface CheckoutFormProps {
  publishableKey: string;
  amountCents: number;
  currency: string;
  buildBody: () => Promise<Record<string, unknown>>;
  allInputsValid: boolean;
  merchantName: string;
  redirectUrl: string | null;
  onSuccess: (invoiceId: string) => void;
  // Phase I #2f (2026-09-08): we tell Stripe NOT to collect billing
  // details (`fields.billingDetails: 'never'`) since we already have
  // them from the customer's "Your details" form above. We then pass
  // them to Stripe on confirm as billing_details. Customer types once.
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  // 2026-10-06: when set, this method expands first in the Stripe
  // PaymentElement accordion and the rest collapse. Per-tenant
  // (tenant_settings.preferred_payment_method). "upi" / "card" / null.
  preferredPaymentMethod?: string | null;
}

function CheckoutForm(props: CheckoutFormProps) {
  const stripePromise = useMemo(
    () => getStripeInstance(props.publishableKey),
    [props.publishableKey]
  );

  // Stripe Elements needs currency lowercased. Amount must be an integer
  // in the currency's smallest unit — we've already got that.
  const options = useMemo(
    () => ({
      mode: "payment" as const,
      amount: props.amountCents,
      currency: props.currency.toLowerCase(),
      // Auto-enables card + Apple Pay + Google Pay + Link based on the
      // merchant's Stripe dashboard payment-method config + browser
      // support. NOTE: `paymentMethodCreation: 'manual'` was previously
      // set here but that flow requires calling stripe.createPaymentMethod
      // yourself. We use stripe.confirmPayment({elements, clientSecret})
      // which handles PM creation automatically — the default (no
      // `paymentMethodCreation` field) is correct for this flow AND does
      // not restrict wallet visibility.
      //
      // 2026-10-06: paymentMethodOrder puts the tenant's preferred
      // method first in the accordion (expanded by default). The rest
      // keep Stripe's natural ordering below it. Null preference → omit
      // the field and let Stripe pick (default behaviour).
      ...(props.preferredPaymentMethod
        ? { paymentMethodOrder: [props.preferredPaymentMethod] }
        : {}),
      appearance: {
        theme: "stripe" as const,
        variables: {
          colorPrimary: MEGO_BLUE,
          borderRadius: "10px",
        },
      },
    }),
    [props.amountCents, props.currency, props.preferredPaymentMethod]
  );

  // Pass our already-collected billing details as defaults so Stripe's
  // Payment Element shows nothing but the card fields. Full billing
  // details are still sent to Stripe on confirm — Stripe just doesn't
  // re-ask the customer for them.
  const paymentElementOptions = useMemo(
    () => ({
      fields: {
        billingDetails: {
          name: "never" as const,
          email: "never" as const,
          // FIX 2026-09-10: 'phone: never' required us to pass phone in
          // confirmParams.payment_method_data.billing_details.phone. When
          // the customer didn't fill it in (or requirePhone=false on the
          // link), we passed undefined and Stripe rejected the confirm
          // with an internal debug string that leaked to the customer.
          // 'auto' means Stripe shows the field only when the payment
          // method needs it (basically never for cards).
          phone: "auto" as const,
          // Stripe requires country at minimum for card processing (AVS).
          // 'auto' lets Stripe show just the country selector in the
          // Payment Element — minimal footprint, and no hardcoding a
          // country on a public checkout that could serve any market.
          address: "auto" as const,
        },
      },
      // Kill Stripe Link's inline "Save my information / create an
      // account" prompt — it reads to customers as a required sign-in
      // step on a one-off payment link. Wallet buttons (Apple Pay /
      // Google Pay) up top still render via ExpressCheckoutElement.
      wallets: {
        link: "never" as const,
      },
      defaultValues: {
        billingDetails: {
          name: props.customerName || undefined,
          email: props.customerEmail || undefined,
          phone: props.customerPhone || undefined,
        },
      },
    }),
    [props.customerName, props.customerEmail, props.customerPhone]
  );

  return (
    <Elements stripe={stripePromise} options={options}>
      <CheckoutFormInner {...props} paymentElementOptions={paymentElementOptions} />
    </Elements>
  );
}

function CheckoutFormInner({
  amountCents,
  currency,
  buildBody,
  allInputsValid,
  merchantName,
  redirectUrl,
  onSuccess,
  customerName,
  customerEmail,
  customerPhone,
  paymentElementOptions,
}: CheckoutFormProps & {
  paymentElementOptions: Record<string, unknown>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState(false);

  // Phase I #13 (2026-09-23) — UPI +2% surcharge preview.
  // Deferred-intent Elements: the invoice + PI aren't created until
  // runPayment(). So the client just previews the surcharge; the server
  // /checkout endpoint honours the same rule when minting the PI so
  // Stripe captures the surcharged amount.
  const [selectedPmType, setSelectedPmType] = useState<string | null>(null);
  const surchargeCents = useMemo(() => {
    if (selectedPmType === "upi") return Math.round(amountCents * 0.02);
    return 0;
  }, [selectedPmType, amountCents]);
  const surchargeLabel = surchargeCents > 0 ? "Platform fee (2% UPI)" : null;
  const effectiveTotalCents = amountCents + surchargeCents;

  // Shared payment flow — used by both the manual Pay button AND the
  // ExpressCheckoutElement's onConfirm (Apple Pay / Google Pay / Link).
  // In the wallet case, `elements.submit()` succeeds without touching
  // our card PaymentElement — Stripe uses the wallet's own payment
  // method instead. Either way, we then create the invoice + PI on
  // the server and confirm.
  async function runPayment() {
    if (!stripe || !elements) {
      setErr("Payment form is still loading. Give it a second.");
      return;
    }
    if (!allInputsValid) {
      setErr("Please complete the form and accept the terms above.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Trigger Elements validation.
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setErr(friendlyStripeError(submitError));
        setBusy(false);
        return;
      }

      // Server: create invoice + record T&C + mint PaymentIntent.
      const slug = window.location.pathname.split("/").filter(Boolean).pop() || "";
      const body = await buildBody();
      const res = await fetch(`/api/public/payment-links/${slug}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Phase I #13 (2026-09-23): include the customer's selected
        // payment method type so the server applies the matching
        // surcharge (e.g. +2% UPI) to the invoice + PaymentIntent it
        // mints. Client-side preview above is just for display.
        body: JSON.stringify({ ...body, paymentMethodType: selectedPmType }),
      });
      const json = await res.json();
      if (!res.ok || !json.clientSecret) {
        throw new Error(json.error || "Could not start checkout.");
      }

      // Confirm the payment with the fresh clientSecret. redirect:
      // 'if_required' keeps 3DS-free cards on-page.
      // Pass billing_details from our own form so Stripe stops asking
      // for them in the Payment Element (see fields.billingDetails
      // config above).
      const returnUrl = `${window.location.origin}/pay/invoice/${json.invoiceId}?paid=1`;
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: json.clientSecret,
        confirmParams: {
          return_url: returnUrl,
          payment_method_data: {
            billing_details: {
              name: customerName || undefined,
              email: customerEmail || undefined,
              phone: customerPhone || undefined,
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
        // if the supplier's Stripe webhook isn't configured for
        // payment_intent.succeeded. Endpoint is idempotent — the webhook
        // remains the safety-net; whoever hits the "not paid → paid"
        // transition first fans out the notifications.
        try {
          await fetch(`/api/pay/invoice/${json.invoiceId}/paid`, { method: "POST" });
        } catch {
          // Fire-and-forget — success page renders regardless.
        }
        onSuccess(json.invoiceId);
        return;
      }
      // Statuses like processing / requires_action → Stripe already
      // handled the flow. Reset the button so a retry is possible.
      setBusy(false);
    } catch (e: any) {
      setErr(friendlyStripeError(e));
      setBusy(false);
    }
  }

  const payDisabled = busy || !stripe || !cardReady || !allInputsValid;
  const formatCents = (cents: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(cents / 100);
  const amountLabel = formatCents(effectiveTotalCents);

  return (
    <div>
      {/* Express Checkout — Apple Pay / Google Pay / Link.
           Shown at the top so users on Safari (iOS/macOS) and Chrome
           (with G Pay) can finish in 1 tap. Only visible when the
           browser actually supports at least one wallet — otherwise
           it collapses to nothing. Clicking opens the wallet sheet
           and, on confirm, runs the same server→confirmPayment flow
           the manual Pay button does. */}
      <div
        className="mb-4 transition-opacity"
        style={{
          opacity: allInputsValid ? 1 : 0.45,
          pointerEvents: allInputsValid ? "auto" : "none",
        }}
      >
        <ExpressCheckoutElement
          options={{
            // Hide Stripe Link's big "Pay with Link" button so customers
            // aren't nudged into creating a Link account for a one-off
            // payment. Apple Pay / Google Pay wallet buttons stay.
            paymentMethods: {
              link: "never" as const,
            },
          }}
          onReady={(e: any) => {
            // Track whether any wallet button actually rendered — the
            // element is invisible when the browser has none available.
            const anyAvailable = !!(
              e?.availablePaymentMethods && Object.keys(e.availablePaymentMethods).length > 0
            );
            setWalletAvailable(anyAvailable);
          }}
          onClick={(event: any) => {
            if (!allInputsValid) {
              setErr("Fill your details and accept the terms above first.");
              return; // Don't call event.resolve — blocks the sheet
            }
            setErr(null);
            event.resolve({});
          }}
          onConfirm={async () => {
            // Wallet approved (Face ID / fingerprint / etc). Run the
            // exact same submit flow the manual Pay button uses.
            await runPayment();
          }}
        />
      </div>

      {walletAvailable && (
        <div className="my-3 flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: "#E1E4EE" }} />
          <span className="text-xs uppercase tracking-wider" style={{ color: MEGO_INK_3 }}>
            or pay with card
          </span>
          <div className="flex-1 h-px" style={{ background: "#E1E4EE" }} />
        </div>
      )}

      {!walletAvailable && (
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider" style={{ color: MEGO_INK_3 }}>
            Card details
          </span>
          {!allInputsValid && (
            <span className="text-xs" style={{ color: MEGO_INK_3 }}>
              Fill your details + accept terms above ↑
            </span>
          )}
        </div>
      )}
      <div
        className="p-4 rounded-xl border transition-opacity"
        style={{
          borderColor: "#E1E4EE",
          background: allInputsValid ? "#FFFFFF" : "#F5F7F8",
          opacity: allInputsValid ? 1 : 0.45,
          pointerEvents: allInputsValid ? "auto" : "none",
        }}
      >
        <PaymentElement
          onReady={() => setCardReady(true)}
          onChange={(event: any) => {
            // Track the customer's picked payment method type so we can
            // preview method-specific surcharges (UPI +2%) and pass the
            // choice to the /checkout endpoint on submit.
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
          style={{ background: "#F5F7F8", color: MEGO_INK_3 }}
        >
          <span>{surchargeLabel}</span>
          <strong style={{ color: MEGO_INK_2 }}>{formatCents(surchargeCents)}</strong>
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
        style={{ backgroundColor: MEGO_BLUE }}
        title={
          payDisabled && !busy
            ? "Fill your details and accept the terms above to enable payment"
            : undefined
        }
      >
        {busy ? "Processing payment…" : `Pay ${amountLabel} to ${merchantName}`}
      </button>

      <div className="mt-3 text-center text-xs" style={{ color: MEGO_INK_3 }}>
        Your card details are handled securely.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell — MEGO-branded wrapper matching the vendor-mode invoice pay page
// (deep navy hero + MEGO wordmark logo, Electric-Blue accents, Cloud page
// surface). Partner branding shows as a "Sold by X" strip when the link
// carries a partner display name — the MEGO chrome stays the constant
// visual identity across every payment link.
// ---------------------------------------------------------------------------
function Shell({
  children,
  merchantName,
  logoUrl,
  poweredBy,
  // Phase I #14 (2026-09-23): false = supplier opted out of MEGO chrome
  // (tenant_settings.powered_by_visible). Header, footer, and the
  // "Sold on hub by MEGO" caption all collapse to a neutral surface.
  showPlatformChrome = true,
}: {
  children: React.ReactNode;
  merchantName?: string;
  logoUrl?: string | null;
  poweredBy?: string | null;
  showPlatformChrome?: boolean;
}) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: MEGO_CLOUD, color: MEGO_INK }}
    >
      {/* Navy MEGO header — mirrors the invoice pay page hero.
           Hidden entirely when the supplier opts out of MEGO chrome. */}
      {showPlatformChrome && (
      <header
        style={{
          background: `linear-gradient(180deg, ${MEGO_NAVY} 0%, ${MEGO_MIDNIGHT} 100%)`,
          borderBottom: `1px solid ${MEGO_MIDNIGHT}`,
        }}
      >
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          {/* MEGO wordmark + "Sold on hub by Mego" caption — mirrors the
               header on the invoice pay page verbatim, no security-claim
               chips (which read as marketing on a payment surface). */}
          <a
            href="https://synergydatalabs.com"
            className="flex items-center gap-3 no-underline"
            aria-label="MEGO by Synergy Data Labs"
          >
            <div className="flex flex-col">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={MEGO_WORDMARK_WHITE}
                alt="MEGO"
                style={{ height: 32, width: "auto" }}
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  const sibling = e.currentTarget.nextElementSibling as HTMLElement | null;
                  if (sibling) sibling.style.display = "inline";
                }}
              />
              <span
                style={{
                  display: "none",
                  fontFamily: "'Inter Tight', Inter, system-ui, sans-serif",
                  fontWeight: 800,
                  fontSize: "22px",
                  color: "#FFFFFF",
                  letterSpacing: "-0.03em",
                }}
              >
                MEGO
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "rgba(255,255,255,0.7)",
                  marginTop: 4,
                }}
              >
                Sold on hub by MEGO
              </span>
            </div>
          </a>
          {/* Right side intentionally empty — the checkout page shouldn't
               carry marketing chips ("Secure · SSL" etc). Everything the
               customer needs to see lives in the body card below. */}
          <div />
        </div>
        {/* Partner co-branding strip — only when the link provides its own
             display name AND that name differs from the supplier's own. */}
        {merchantName && poweredBy && (
          <div
            className="max-w-3xl mx-auto px-4 pb-3 pt-1 flex items-center gap-3"
            style={{ color: "rgba(255,255,255,0.9)" }}
          >
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={merchantName}
                className="h-6 w-6 rounded object-contain bg-white/10 p-0.5"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            <div className="text-xs">
              You're on the checkout page for{" "}
              <strong style={{ color: "#FFFFFF" }}>{merchantName}</strong>
              {poweredBy && (
                <span className="ml-1 opacity-70">· {poweredBy}</span>
              )}
            </div>
          </div>
        )}
      </header>
      )}

      {/* Neutral header for suppliers who opted out of MEGO chrome — shows
           their own name + logo so the page doesn't feel headerless. */}
      {!showPlatformChrome && merchantName && (
        <header
          className="border-b"
          style={{ background: "#FFFFFF", borderColor: "#E1E4EE" }}
        >
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={merchantName}
                style={{ height: 32, width: "auto" }}
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            <div
              style={{
                fontFamily: "'Inter Tight', Inter, system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 18,
                color: MEGO_INK,
              }}
            >
              {merchantName}
            </div>
          </div>
        </header>
      )}

      <main className="flex-1 py-8 px-4">
        <div className="max-w-2xl mx-auto">{children}</div>
      </main>

      {/* Midnight footer — MEGO wordmark + Synergy Data Labs, no
           gateway/processor claims (checkout page should read as a
           neutral checkout, not a marketing surface).
           Hidden when the supplier opts out of MEGO chrome. */}
      {showPlatformChrome && (
      <footer
        className="mt-auto"
        style={{ background: MEGO_MIDNIGHT, color: "rgba(255,255,255,0.75)" }}
      >
        <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={MEGO_WORDMARK_WHITE}
              alt="MEGO"
              style={{ height: 20, width: "auto", opacity: 0.85 }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <span className="text-xs opacity-70">by Synergy Data Labs</span>
          </div>
          <div className="text-xs opacity-70 text-center sm:text-right">
            © {new Date().getFullYear()} Synergy Data Labs
          </div>
        </div>
      </footer>
      )}
    </div>
  );
}
