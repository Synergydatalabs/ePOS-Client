// Moneris Checkout (MCO) — client section for /pay/order/[orderId].
//
// Sequence:
//   1. POST /api/pay/order/[orderId]/moneris/preload → ticket + scriptUrl
//   2. Inject chkt_v1.00.js
//   3. Wait for script load, then new monerisCheckout(), wire callbacks,
//      startCheckout(ticket) — hosted card form takes over the div
//   4. On payment_complete → POST /verify → server does receipt lookup
//      + marks order paid → parent flips to paid view
//
// Copy of the PO version (MonerisCheckoutSection.tsx). Kept separate so
// order-side and PO-side flows can evolve independently.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

declare global {
  interface Window {
    monerisCheckout?: new () => MonerisCheckoutInstance;
  }
}

interface MonerisCheckoutInstance {
  setMode(mode: "qa" | "prod"): void;
  setCheckoutDiv(divId: string): void;
  setCallback(event: string, cb: (payload: unknown) => void): void;
  startCheckout(ticket: string): void;
  closeCheckout(): void;
}

const CHECKOUT_DIV_ID = "moneris-checkout-order-container";

interface Props {
  orderId: string;
  amountLabel: string;
  onPaid: () => void;
}

export default function MonerisOrderCheckoutSection({
  orderId,
  amountLabel,
  onPaid,
}: Props) {
  const [phase, setPhase] = useState<
    "preloading" | "script_loading" | "ready" | "cancelled" | "error"
  >("preloading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [scriptUrl, setScriptUrl] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<"qa" | "prod">("qa");

  const scriptLoadedRef = useRef(false);
  const startedRef = useRef(false);

  const doPreload = useCallback(async () => {
    setPhase("preloading");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/pay/order/${orderId}/moneris/preload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "ALREADY_PAID") {
          onPaid();
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setTicket(data.ticket);
      setScriptUrl(data.scriptUrl);
      setEnvironment(data.environment as "qa" | "prod");
      setPhase(scriptLoadedRef.current ? "ready" : "script_loading");
    } catch (err) {
      setErrorMsg((err as Error).message);
      setPhase("error");
    }
  }, [orderId, onPaid]);

  useEffect(() => {
    doPreload();
  }, [doPreload]);

  useEffect(() => {
    if (phase !== "ready" || !ticket || startedRef.current) return;
    if (!window.monerisCheckout) return;
    startedRef.current = true;

    const mco = new window.monerisCheckout();
    mco.setMode(environment);
    mco.setCheckoutDiv(CHECKOUT_DIV_ID);

    mco.setCallback("page_loaded", () => {
      /* widget up; parent already stopped showing loading */
    });

    mco.setCallback("cancel_transaction", () => {
      toast.info("Payment cancelled");
      try { mco.closeCheckout(); } catch { /* ignore */ }
      setPhase("cancelled");
      startedRef.current = false;
    });

    mco.setCallback("error_event", (payload) => {
      const code = (payload as { response_code?: string })?.response_code || "unknown";
      toast.error(`Moneris error (${code}). Please try again.`);
      try { mco.closeCheckout(); } catch { /* ignore */ }
      setErrorMsg(`Moneris error code ${code}`);
      setPhase("error");
      startedRef.current = false;
    });

    mco.setCallback("payment_complete", async () => {
      try {
        const res = await fetch(`/api/pay/order/${orderId}/moneris/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ticket }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "Verification failed");
          setErrorMsg(data.error || "Verification failed");
          setPhase("error");
          startedRef.current = false;
          return;
        }
        try { mco.closeCheckout(); } catch { /* ignore */ }
        if (data.approved || data.alreadyPaid) {
          toast.success("Payment approved!");
          onPaid();
        } else {
          toast.error(data.message || "Payment declined");
          setErrorMsg(data.message || "Payment declined");
          setPhase("error");
          startedRef.current = false;
        }
      } catch (err) {
        toast.error((err as Error).message || "Verification failed");
        setErrorMsg((err as Error).message);
        setPhase("error");
        startedRef.current = false;
      }
    });

    mco.startCheckout(ticket);
  }, [phase, ticket, environment, orderId, onPaid]);

  return (
    <>
      {scriptUrl && (
        <Script
          src={scriptUrl}
          strategy="afterInteractive"
          onLoad={() => {
            scriptLoadedRef.current = true;
            setPhase((prev) => (prev === "script_loading" ? "ready" : prev));
          }}
          onError={() => {
            setErrorMsg("Failed to load Moneris Checkout script");
            setPhase("error");
          }}
        />
      )}

      <div className="bg-white rounded-2xl shadow-sm p-6 mb-4 min-h-[400px]">
        {phase === "preloading" && (
          <PhaseMessage
            icon="solar:refresh-circle-bold"
            title="Preparing secure checkout…"
            subtitle="Connecting to Moneris — this only takes a moment."
            spinning
          />
        )}
        {phase === "script_loading" && (
          <PhaseMessage
            icon="solar:refresh-circle-bold"
            title="Loading Moneris Checkout…"
            subtitle="Almost there."
            spinning
          />
        )}
        {(phase === "ready" || phase === "cancelled") && (
          <div id={CHECKOUT_DIV_ID} />
        )}
        {phase === "error" && (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
              <Icon icon="solar:danger-triangle-bold" className="w-7 h-7 text-red-500" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              Checkout couldn&apos;t load
            </h2>
            <p className="text-sm text-gray-500 mb-4">{errorMsg}</p>
            <button
              type="button"
              onClick={doPreload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800"
            >
              <Icon icon="solar:refresh-linear" className="w-4 h-4" />
              Try again
            </button>
          </div>
        )}
      </div>

      {phase === "cancelled" && (
        <div className="text-center mb-4">
          <button
            type="button"
            onClick={doPreload}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800"
          >
            <Icon icon="solar:refresh-linear" className="w-4 h-4" />
            Restart checkout · {amountLabel}
          </button>
        </div>
      )}
    </>
  );
}

function PhaseMessage({
  icon,
  title,
  subtitle,
  spinning,
}: {
  icon: string;
  title: string;
  subtitle: string;
  spinning?: boolean;
}) {
  return (
    <div className="text-center py-10">
      <div className="w-14 h-14 rounded-full bg-emerald-100 mx-auto mb-4 flex items-center justify-center">
        <Icon
          icon={icon}
          className={`w-7 h-7 text-emerald-600 ${spinning ? "animate-spin" : ""}`}
        />
      </div>
      <h2 className="text-base font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-gray-500">{subtitle}</p>
    </div>
  );
}
