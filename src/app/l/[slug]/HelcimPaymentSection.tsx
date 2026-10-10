"use client";

// =============================================================================
// 2026-10-09 — HelcimPay.js inline checkout for the public payment-link page.
//
// Flow:
//   1. Customer clicks "Pay with Helcim" → we POST /helcim-start
//      → server creates the invoice + mints a HelcimPay.js checkoutToken
//   2. We load the HelcimPay.js SDK (CDN) if not already loaded
//      → call window.appendHelcimPayIframe(checkoutToken)
//   3. Modal opens; customer enters card
//   4. On completion Helcim fires both:
//        - a postMessage with eventStatus = SUCCESS / ABORTED
//        - a webhook to /api/webhooks/h-ecom (flips invoice to PAID)
//   5. On SUCCESS we redirect to successUrl (polls paid state).
// =============================================================================

import { useState, useEffect, useRef } from "react";
import { Icon } from "@iconify/react";

const HELCIM_SDK_SRC = "https://secure.helcim.app/helcim-pay/services/start.js";

declare global {
  interface Window {
    appendHelcimPayIframe?: (checkoutToken: string, hasAddons?: boolean) => void;
    removeHelcimPayIframe?: () => void;
  }
}

interface Props {
  slug: string;
  amountCents: number;
  currency: string;
  // Builder for the request body (reCAPTCHA + T&C acceptance + customer).
  // Returns the same shape the Stripe /checkout endpoint takes.
  buildBody: () => Promise<Record<string, unknown>>;
  allInputsValid: boolean;
  onSuccess: (invoiceId: string) => void;
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function loadHelcimSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("No window — SSR context"));
      return;
    }
    if (typeof window.appendHelcimPayIframe === "function") {
      resolve();
      return;
    }
    // Already injected?
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${HELCIM_SDK_SRC}"]`
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Helcim SDK failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = HELCIM_SDK_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Helcim SDK failed to load"));
    document.head.appendChild(script);
  });
}

export default function HelcimPaymentSection({
  slug,
  amountCents,
  currency,
  buildBody,
  allInputsValid,
  onSuccess,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const invoiceIdRef = useRef<string | null>(null);
  const handlerAttachedRef = useRef(false);

  // Attach the postMessage listener once on mount.
  useEffect(() => {
    if (handlerAttachedRef.current) return;
    handlerAttachedRef.current = true;

    function onMessage(event: MessageEvent) {
      // Helcim sends events with a nested envelope. The exact shape:
      //   event.data === { eventName: "helcim-pay-js-...", eventStatus: "SUCCESS"|"ABORTED"|"HIDE", eventMessage: {...} }
      // When eventStatus is SUCCESS the modal is auto-removed by the SDK.
      if (!event?.data) return;
      const payload: any = event.data;
      const name = String(payload.eventName || "");
      if (!name.startsWith("helcim-pay-js-")) return;
      const status = String(payload.eventStatus || "").toUpperCase();
      if (status === "SUCCESS") {
        const invoiceId = invoiceIdRef.current;
        setBusy(false);
        if (invoiceId) onSuccess(invoiceId);
      } else if (status === "ABORTED" || status === "HIDE") {
        setBusy(false);
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [onSuccess]);

  async function handlePay() {
    if (!allInputsValid) {
      setErr("Please fill in your details and accept the terms first");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const body = await buildBody();
      const res = await fetch(`/api/public/payment-links/${slug}/helcim-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.checkoutToken) {
        throw new Error(json?.error || "Could not start Helcim checkout");
      }
      invoiceIdRef.current = json.invoiceId;

      await loadHelcimSdk();
      if (typeof window.appendHelcimPayIframe !== "function") {
        throw new Error("Helcim SDK loaded but appendHelcimPayIframe is unavailable");
      }
      window.appendHelcimPayIframe(json.checkoutToken, false);
      // The postMessage listener handles SUCCESS/ABORTED.
    } catch (e: any) {
      setErr(e?.message || "Could not open Helcim checkout");
      setBusy(false);
    }
  }

  return (
    <div>
      {err && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {err}
        </div>
      )}
      <button
        type="button"
        onClick={handlePay}
        disabled={busy || !allInputsValid}
        className="w-full py-3 font-semibold rounded-xl text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        style={{ backgroundColor: "#6366F1" }}
      >
        {busy ? (
          <>
            <Icon icon="solar:refresh-linear" className="w-4 h-4 animate-spin" />
            Opening secure checkout…
          </>
        ) : (
          <>
            <Icon icon="solar:card-2-bold" className="w-4 h-4" />
            Pay {formatMoney(amountCents, currency)} with card
          </>
        )}
      </button>
      <div className="mt-3 text-center text-xs text-gray-500">
        Secure card entry powered by Helcim. Your card details never touch our
        servers.
      </div>
    </div>
  );
}
