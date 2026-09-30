"use client";

// Phase I #2a (2026-09-08) — Embedded Stripe Elements checkout for
// supplier invoices. Replaces the old "click Pay → redirect to
// checkout.stripe.com" flow with an inline card form. The customer stays
// on hub.synergydatalabs.com the entire time.
//
// Rendered by /pay/invoice/[invoiceId]/page.tsx once the T&C acceptance
// has been recorded server-side and the /stripe/payment-intent endpoint
// has returned a clientSecret + publishableKey.
//
// PCI compliance model is unchanged from the redirect flow: card data
// is captured inside a Stripe iframe (via <PaymentElement />) and posts
// directly to Stripe — never touches our server. We remain PCI SAQ-A.

import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  // Phase I #2g (2026-09-08): big Apple Pay / Google Pay / Link
  // buttons at the top. Same treatment as the payment-link checkout.
  ExpressCheckoutElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

interface Props {
  clientSecret: string;
  publishableKey: string;
  amountLabel: string;      // e.g. "CAD 249.00" — for the pay button label
  returnUrl: string;        // where Stripe redirects on 3DS confirm
  primaryColor?: string;    // supplier brand colour for the button
  onSuccess: () => void;    // called when confirmPayment succeeds inline
                            // (i.e. no 3DS redirect was needed)
}

// A single-tenant cache: we build one Stripe.js instance per publishable
// key. Different suppliers have different keys, so we key by the string.
// Cleared on hard reload — good enough for a public checkout page that
// only ever renders one supplier per navigation.
const stripeInstances: Record<string, Promise<StripeJs | null>> = {};
function getStripeInstance(publishableKey: string): Promise<StripeJs | null> {
  if (!stripeInstances[publishableKey]) {
    stripeInstances[publishableKey] = loadStripe(publishableKey);
  }
  return stripeInstances[publishableKey];
}

export default function StripePaymentSection({
  clientSecret,
  publishableKey,
  amountLabel,
  returnUrl,
  primaryColor,
  onSuccess,
}: Props) {
  const stripePromise = useMemo(
    () => getStripeInstance(publishableKey),
    [publishableKey]
  );

  const appearance = useMemo(
    () => ({
      theme: "stripe" as const,
      // Only mirror the supplier's primary colour into the button/focus
      // states. Rest of the Elements form stays default so it's readable
      // + high-contrast against arbitrary brand colours.
      variables: primaryColor
        ? {
            colorPrimary: primaryColor,
            borderRadius: "10px",
          }
        : {
            borderRadius: "10px",
          },
    }),
    [primaryColor]
  );

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance }}
    >
      <PayForm
        amountLabel={amountLabel}
        returnUrl={returnUrl}
        primaryColor={primaryColor}
        onSuccess={onSuccess}
      />
    </Elements>
  );
}

// Inner form — must be inside <Elements> so `useStripe` / `useElements`
// have context.
function PayForm({
  amountLabel,
  returnUrl,
  primaryColor,
  onSuccess,
}: {
  amountLabel: string;
  returnUrl: string;
  primaryColor?: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elementsReady, setElementsReady] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState(false);

  // Watch for stripe.js loading errors — either the browser is offline
  // or the publishableKey is bad. Surface either as a friendly message
  // rather than a silent-blank card frame.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled && !elementsReady) {
        // 10s and still not ready — probably network / CSP blocking Stripe.js.
        // Don't hard-error; leave the retry button visible.
        console.warn("[StripePaymentSection] Elements slow to load");
      }
    }, 10_000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [elementsReady]);

  const submit = async () => {
    if (!stripe || !elements) {
      setErrorMsg("Payment form is still loading — please wait a moment and try again.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: returnUrl,
      },
      // Only redirect when strictly needed (3DS challenge etc). Cards that
      // don't require a challenge finish in-page and we call onSuccess().
      redirect: "if_required",
    });

    if (error) {
      // Stripe returns validation-level errors (bad card etc) here without
      // charging. `type: 'card_error' | 'validation_error'` are safe to show
      // as-is; other types are Stripe-side and get a generic message.
      const shouldShow =
        error.type === "card_error" || error.type === "validation_error";
      setErrorMsg(
        shouldShow && error.message
          ? error.message
          : "Payment could not be completed. Please try a different card or contact your bank."
      );
      setSubmitting(false);
      return;
    }

    if (paymentIntent && paymentIntent.status === "succeeded") {
      // Success — the webhook will also fire but we optimistically flip
      // the UI so the customer sees confirmation without waiting.
      onSuccess();
      return;
    }

    // Other statuses (processing, requires_action redirected, etc.) — Stripe
    // handled the flow; nothing to do here. Leave the button reset so the
    // user can retry if they land back with an incomplete state.
    setSubmitting(false);
  };

  return (
    <div>
      {/* Phase I #2g (2026-09-08): big Apple Pay / Google Pay / Link
           buttons at the top — one-tap checkout on supported browsers.
           Only renders if the browser has at least one wallet available. */}
      <ExpressCheckoutElement
        onReady={(e: any) => {
          const anyAvailable = !!(
            e?.availablePaymentMethods &&
            Object.keys(e.availablePaymentMethods).length > 0
          );
          setWalletAvailable(anyAvailable);
        }}
        onConfirm={async () => {
          if (!stripe || !elements) return;
          setSubmitting(true);
          setErrorMsg(null);
          const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: returnUrl },
            redirect: "if_required",
          });
          if (error) {
            const show =
              error.type === "card_error" || error.type === "validation_error";
            setErrorMsg(
              show && error.message
                ? error.message
                : "Payment could not be completed. Please try a different card."
            );
            setSubmitting(false);
            return;
          }
          if (paymentIntent && paymentIntent.status === "succeeded") {
            onSuccess();
            return;
          }
          setSubmitting(false);
        }}
      />

      {walletAvailable && (
        <div className="my-3 flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs uppercase tracking-wider text-gray-400">
            or pay with card
          </span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>
      )}

      <PaymentElement
        onReady={() => setElementsReady(true)}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange={(e: any) => {
          // Clear stale errors as soon as the user starts editing the card.
          if (e?.complete && errorMsg) setErrorMsg(null);
        }}
      />

      {errorMsg && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!stripe || !elements || submitting || !elementsReady}
        className="mt-4 w-full py-3 text-white font-semibold rounded-xl transition-opacity disabled:opacity-60"
        style={{
          backgroundColor: primaryColor || "#635BFF", // Stripe purple default
        }}
      >
        {submitting ? "Processing payment…" : `Pay ${amountLabel}`}
      </button>

      <p className="mt-3 text-center text-xs text-gray-500">
        Card processed securely by Stripe.
        {" "}Your card details are never sent to us.
      </p>
    </div>
  );
}
