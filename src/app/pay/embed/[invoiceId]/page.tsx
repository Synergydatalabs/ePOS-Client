"use client";

// ============================================================================
// /pay/embed/[invoiceId] — Phase I #9 (2026-09-19)
//
// Bare-bones iframe-ready checkout. Designed to be dropped into a
// partner's site via <iframe src=".../pay/embed/<id>">. Zero hub chrome
// (no header, no footer, no brand panel) so the partner controls the
// surrounding UI.
//
// Renders:
//   • Amount + description
//   • Required T&C acknowledgement checkbox
//   • Stripe PaymentElement (card + wallet buttons)
//   • Pay button
//   • Success / failure text state
//
// On success we:
//   1. POST /api/pay/invoice/[id]/paid — marks invoice PAID + fires our
//      outbound webhook to the partner's server (via fireWebhookForLink).
//   2. window.parent.postMessage({type:'payment:succeeded', ...}) — so the
//      embedding page can react (hide iframe, show thank-you).
//
// Query params:
//   ?bg=<color>     — background color (default transparent)
//   ?fg=<color>     — text color (default #111)
//   ?accent=<color> — pay button color (default #4F46E5)
//   ?terms_url=<url>— link the T&C label points to (default #)
//   ?terms_label=<text>— T&C acknowledgement label
//
// The partner site provides fonts by pointing the iframe wrapper's
// styles at the desired inherited font-family (or we could add ?font=
// query param later).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

interface InvoiceData {
  id: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  paymentStatus: string;
  status: string;
  supplier: { displayName: string };
  stripePublishableKey: string | null;
  paymentMethod: "STRIPE" | "MOCK";
  // Phase I #15 (2026-09-26): tenant may have opted out of iframe
  // embed — when false, this page refuses to render and the partner
  // must redirect their customer to the hosted /l/[slug] page.
  iframeEnabled: boolean;
}

export default function EmbedCheckoutPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const search = useSearchParams();

  // Look & feel from query params (partner-controllable at iframe src level)
  const bg = search.get("bg") || "transparent";
  const fg = search.get("fg") || "#111827";
  const accent = search.get("accent") || "#4F46E5";
  const termsUrl = search.get("terms_url") || "#";
  const termsLabel =
    search.get("terms_label") || "I accept the terms and conditions";

  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pay/invoice/${invoiceId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j || j.error) {
          setError(j?.error || "Failed to load invoice");
          return;
        }
        setInvoice({
          id: j.invoice.id,
          invoiceNumber: j.invoice.invoiceNumber,
          totalCents: j.invoice.totalCents,
          currency: j.invoice.currency,
          customerEmail: j.invoice.customerEmail,
          customerName: j.invoice.customerName || "",
          paymentStatus: j.invoice.paymentStatus,
          status: j.invoice.status,
          supplier: {
            displayName:
              j.brand?.displayName || j.supplier?.name || "Merchant",
          },
          stripePublishableKey: j.stripePublishableKey || null,
          paymentMethod: j.paymentMethod,
          iframeEnabled: j.supplier?.iframeEnabled !== false,
        });
      })
      .catch(() => cancelled || setError("Failed to load invoice"))
      .finally(() => cancelled || setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  const amountLabel = useMemo(() => {
    if (!invoice) return "";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: invoice.currency,
    }).format(invoice.totalCents / 100);
  }, [invoice]);

  if (loading) {
    return (
      <Frame bg={bg} fg={fg}>
        <div style={{ padding: 20, textAlign: "center", color: fg, opacity: 0.6 }}>
          Loading…
        </div>
      </Frame>
    );
  }
  if (error || !invoice) {
    return (
      <Frame bg={bg} fg={fg}>
        <div style={{ padding: 20, color: "#b91c1c" }}>
          {error || "Invoice not available"}
        </div>
      </Frame>
    );
  }
  if (invoice.paymentStatus === "PAID") {
    return (
      <Frame bg={bg} fg={fg}>
        <SuccessState amountLabel={amountLabel} fg={fg} accent={accent} />
      </Frame>
    );
  }
  if (invoice.status === "CANCELLED") {
    return (
      <Frame bg={bg} fg={fg}>
        <div style={{ padding: 20, color: "#b91c1c" }}>
          This invoice has been cancelled.
        </div>
      </Frame>
    );
  }
  if (!invoice.iframeEnabled) {
    // Phase I #15 (2026-09-26): merchant has opted out of iframe checkout.
    // Partners must redirect customers to the hosted payment link page
    // (e.g. https://hub.synergydatalabs.com/l/<slug>) instead.
    return (
      <Frame bg={bg} fg={fg}>
        <div style={{ padding: 20, color: "#b91c1c" }}>
          Embedded checkout is not available for this merchant. Please redirect
          your customer to the payment link URL instead.
        </div>
      </Frame>
    );
  }
  if (invoice.paymentMethod !== "STRIPE" || !invoice.stripePublishableKey) {
    return (
      <Frame bg={bg} fg={fg}>
        <div style={{ padding: 20, color: "#b91c1c" }}>
          This merchant is not set up for card payments yet.
        </div>
      </Frame>
    );
  }

  return (
    <Frame bg={bg} fg={fg}>
      <Checkout
        invoice={invoice}
        amountLabel={amountLabel}
        fg={fg}
        accent={accent}
        termsLabel={termsLabel}
        termsUrl={termsUrl}
      />
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// UI helpers — inline styles only (no Tailwind chrome, no branding)
// ---------------------------------------------------------------------------

function Frame({
  bg,
  fg,
  children,
}: {
  bg: string;
  fg: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: bg,
        color: fg,
        minHeight: "100vh",
        fontFamily:
          "inherit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: 16,
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

function SuccessState({
  amountLabel,
  fg,
  accent,
}: {
  amountLabel: string;
  fg: string;
  accent: string;
}) {
  useEffect(() => {
    postToParent({ type: "payment:succeeded", amount: amountLabel });
  }, [amountLabel]);
  return (
    <div style={{ textAlign: "center", padding: "32px 16px" }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: accent,
          color: "white",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
          marginBottom: 16,
        }}
      >
        ✓
      </div>
      <h2 style={{ color: fg, margin: "0 0 8px 0", fontSize: 20 }}>
        Payment successful
      </h2>
      <p style={{ color: fg, opacity: 0.6, margin: 0 }}>{amountLabel} paid</p>
    </div>
  );
}

function postToParent(message: Record<string, unknown>) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, "*");
    }
  } catch {
    /* cross-origin — harmless */
  }
}

// ---------------------------------------------------------------------------
// Checkout — Elements-driven card form
// ---------------------------------------------------------------------------

function Checkout({
  invoice,
  amountLabel,
  fg,
  accent,
  termsLabel,
  termsUrl,
}: {
  invoice: InvoiceData;
  amountLabel: string;
  fg: string;
  accent: string;
  termsLabel: string;
  termsUrl: string;
}) {
  const stripePromise = useMemo(
    () => loadStripe(invoice.stripePublishableKey!),
    [invoice.stripePublishableKey]
  );

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentErr, setIntentErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/pay/invoice/${invoice.id}/stripe/payment-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.clientSecret) setClientSecret(j.clientSecret);
        else setIntentErr(j?.error || "Failed to initialise payment");
      })
      .catch(() => setIntentErr("Failed to initialise payment"));
  }, [invoice.id]);

  if (intentErr) {
    return <div style={{ color: "#b91c1c" }}>{intentErr}</div>;
  }
  if (!clientSecret) {
    return (
      <div style={{ textAlign: "center", padding: 20, opacity: 0.6 }}>
        Preparing checkout…
      </div>
    );
  }

  // The amount is rendered inside CheckoutForm (which lives inside
  // <Elements> and can react to method changes for the +2% UPI surcharge).
  // Kept the invoice number / merchant line here as static context.
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
          {invoice.supplier.displayName} · {invoice.invoiceNumber}
        </div>
        <div style={{ fontSize: 32, fontWeight: 700 }}>{amountLabel}</div>
      </div>
      <Elements
        stripe={stripePromise as unknown as Promise<StripeJs | null>}
        options={{
          clientSecret,
          appearance: {
            theme: "flat",
            variables: {
              colorPrimary: accent,
              colorText: fg,
              fontFamily: "inherit",
              borderRadius: "8px",
            },
          },
        }}
      >
        <CheckoutForm invoice={invoice} accent={accent} termsLabel={termsLabel} termsUrl={termsUrl} />
      </Elements>
    </>
  );
}

function CheckoutForm({
  invoice,
  accent,
  termsLabel,
  termsUrl,
}: {
  invoice: InvoiceData;
  accent: string;
  termsLabel: string;
  termsUrl: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  // 2026-10-07 — abandoned-PI cleanup for the iframe/embed flow.
  //
  // The embed page mints a PaymentIntent on mount (so Elements can
  // render the inline card form). If the customer closes the host
  // page, dismisses the iframe, or navigates away before confirming,
  // the PI stays as "Incomplete" in the merchant's Stripe dashboard
  // for days. navigator.sendBeacon survives tab/iframe teardown and
  // hits our public /cancel-intent endpoint, which issues
  // paymentIntents.cancel with reason "abandoned".
  //
  // succeededRef flips to true the instant confirm settles — prevents
  // a race where unload fires AFTER success is set but BEFORE the
  // success state React re-render completes.
  const succeededRef = useRef(false);
  useEffect(() => {
    function cancelAbandoned() {
      if (succeededRef.current) return;
      try {
        navigator.sendBeacon(
          `/api/pay/invoice/${invoice.id}/cancel-intent`,
          new Blob([], { type: "text/plain" })
        );
      } catch {
        // Nothing we can do while the page is going away.
      }
    }
    window.addEventListener("pagehide", cancelAbandoned);
    window.addEventListener("beforeunload", cancelAbandoned);
    return () => {
      window.removeEventListener("pagehide", cancelAbandoned);
      window.removeEventListener("beforeunload", cancelAbandoned);
    };
  }, [invoice.id]);

  // Phase I #13 (2026-09-23) — UPI +2% surcharge.
  // Track the effective total server-side so the reconciled Stripe amount,
  // the invoice.total_cents, and the button label all stay in sync when
  // the customer flips payment methods.
  const [effectiveTotalCents, setEffectiveTotalCents] = useState<number>(
    invoice.totalCents
  );
  const [surchargeCents, setSurchargeCents] = useState<number>(0);
  const [surchargeLabel, setSurchargeLabel] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  const formatMoney = useCallback(
    (cents: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: invoice.currency,
      }).format(cents / 100),
    [invoice.currency]
  );

  const onPaymentElementChange = useCallback(
    async (event: { value?: { type?: string } }) => {
      const type = event?.value?.type;
      if (!type) return;
      try {
        setAdjusting(true);
        const res = await fetch(
          `/api/pay/invoice/${invoice.id}/stripe/adjust-surcharge`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentMethodType: type }),
          }
        );
        const j = await res.json();
        if (res.ok && j?.success) {
          setEffectiveTotalCents(Number(j.totalCents ?? invoice.totalCents));
          setSurchargeCents(Number(j.surchargeCents ?? 0));
          setSurchargeLabel(j.surchargeLabel || null);
        }
      } catch {
        /* non-fatal — customer can still pay at the un-adjusted amount */
      } finally {
        setAdjusting(false);
      }
    },
    [invoice.id, invoice.totalCents]
  );

  const handlePay = useCallback(async () => {
    if (!stripe || !elements) return;
    if (!accepted) {
      setErr("Please accept the terms to continue");
      return;
    }
    setErr(null);
    setSubmitting(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          // No return_url — we stay in the iframe on success. If a bank
          // requires a full-page redirect (3DS), Stripe handles it and
          // returns us to the same URL on success.
          return_url: window.location.href,
        },
        redirect: "if_required",
      });
      if (error) {
        setErr(error.message || "Payment failed");
        postToParent({ type: "payment:failed", message: error.message });
        setSubmitting(false);
        return;
      }
      if (paymentIntent?.status === "succeeded") {
        // 2026-10-07: flip the paid flag BEFORE any async work so a
        // tab/iframe-close in the next few ms doesn't cancel the PI
        // we just captured.
        succeededRef.current = true;
        // Fire the /paid endpoint — marks invoice PAID + fires our
        // outbound webhook to the partner. Idempotent with the Stripe
        // webhook that arrives shortly after.
        await fetch(`/api/pay/invoice/${invoice.id}/paid`, {
          method: "POST",
        }).catch(() => {
          /* server webhook is the backstop */
        });
        setSucceeded(true);
        postToParent({
          type: "payment:succeeded",
          invoice_id: invoice.id,
          invoice_number: invoice.invoiceNumber,
          amount: effectiveTotalCents,
          currency: invoice.currency,
        });
      } else {
        setErr(`Unexpected status: ${paymentIntent?.status}`);
        setSubmitting(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Payment failed");
      setSubmitting(false);
    }
  }, [stripe, elements, accepted, invoice]);

  if (succeeded) {
    return (
      <SuccessState
        amountLabel={formatMoney(effectiveTotalCents)}
        fg="inherit"
        accent={accent}
      />
    );
  }

  return (
    <>
      <PaymentElement
        options={{ layout: "tabs" }}
        onChange={onPaymentElementChange}
      />

      {surchargeCents > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "rgba(0,0,0,0.04)",
            borderRadius: 8,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{surchargeLabel || "Platform fee"}</span>
          <strong>{formatMoney(surchargeCents)}</strong>
        </div>
      )}

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          marginTop: 20,
          fontSize: 13,
          lineHeight: 1.4,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          style={{ marginTop: 3, accentColor: accent }}
        />
        <span>
          {termsUrl !== "#" ? (
            <a
              href={termsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: accent, textDecoration: "underline" }}
            >
              {termsLabel}
            </a>
          ) : (
            termsLabel
          )}
        </span>
      </label>

      {err && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: "#fee2e2",
            color: "#991b1b",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {err}
        </div>
      )}

      <button
        onClick={handlePay}
        disabled={submitting || adjusting || !accepted}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "12px 16px",
          background: accent,
          color: "white",
          border: 0,
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
          cursor: submitting || adjusting || !accepted ? "not-allowed" : "pointer",
          opacity: submitting || adjusting || !accepted ? 0.6 : 1,
        }}
      >
        {submitting
          ? "Processing…"
          : adjusting
          ? "Updating total…"
          : `Pay ${formatMoney(effectiveTotalCents)}`}
      </button>
    </>
  );
}
