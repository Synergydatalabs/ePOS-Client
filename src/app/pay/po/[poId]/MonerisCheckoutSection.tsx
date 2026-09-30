// Moneris Checkout (MCO) — client-side section for the /pay/po/[poId] page.
//
// Renders when the payment link's ?processor=MONERIS query param is set.
// Sequence:
//   1. On mount, POST /api/pay/po/[poId]/moneris/preload → get ticket + scriptUrl
//   2. Inject the Moneris Checkout JS (chkt_v1.00.js) with the right qa/prod URL
//   3. Wait for the script to load, then new monerisCheckout(), wire callbacks,
//      and startCheckout(ticket) — the hosted card form takes over the div
//   4. On payment_complete → POST /verify → server does receipt lookup → mark PO paid
//   5. Notify parent via onPaid() so the outer page flips to the paid view
//
// Callback contract from Moneris:
//   • page_loaded         — MCO widget is ready
//   • cancel_transaction  — user tapped Cancel; we surface a message + let them retry
//   • error_event         — MCO reports an error; we show it + let them retry
//   • payment_receipt     — receipt displayed (we skip it — using Use Own Page)
//   • payment_complete    — payment finished; time to verify server-side

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

// Global exposed by chkt_v1.00.js. We declare a loose type so TypeScript
// doesn't error — Moneris doesn't ship a first-party typings package.
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

// The div id MCO paints into. Kept short + stable so multiple mounts on
// the same page don't collide (they shouldn't — we're single-shot).
const CHECKOUT_DIV_ID = "moneris-checkout-container";

interface Props {
  poId: string;
  ref_: string; // the ?ref=... query param (paymentLinkReference)
  amountLabel: string; // pre-formatted amount for the header
  onPaid: () => void; // parent flips to the paid view
}

export default function MonerisCheckoutSection({
  poId,
  ref_,
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

  // Step 1 — preload as soon as we mount. Fresh ticket per page visit.
  const doPreload = useCallback(async () => {
    setPhase("preloading");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/pay/po/${poId}/moneris/preload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: ref_ }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Already-paid is a special case — parent should flip to paid view.
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
  }, [poId, ref_, onPaid]);

  useEffect(() => {
    doPreload();
  }, [doPreload]);

  // Step 3 — once BOTH the ticket AND the script are ready, start the
  // widget. Guard against double-start (React strict mode fires effects
  // twice in dev; startCheckout is idempotency-hostile).
  useEffect(() => {
    if (phase !== "ready" || !ticket || startedRef.current) return;
    if (!window.monerisCheckout) return;
    startedRef.current = true;

    const mco = new window.monerisCheckout();
    mco.setMode(environment);
    mco.setCheckoutDiv(CHECKOUT_DIV_ID);

    mco.setCallback("page_loaded", () => {
      // Widget is up. Nothing to do; parent already stopped showing loading.
    });

    mco.setCallback("cancel_transaction", () => {
      toast.info("Payment cancelled");
      try {
        mco.closeCheckout();
      } catch {
        // ignore — widget may already be gone
      }
      setPhase("cancelled");
      // Allow retry — reset the started guard so doPreload() can rearm.
      startedRef.current = false;
    });

    mco.setCallback("error_event", (payload) => {
      const code =
        (payload as { response_code?: string })?.response_code || "unknown";
      toast.error(`Moneris error (${code}). Please try again.`);
      try {
        mco.closeCheckout();
      } catch {
        // ignore
      }
      setErrorMsg(`Moneris error code ${code}`);
      setPhase("error");
      startedRef.current = false;
    });

    // Step 4 — payment_complete means Moneris says the widget is done.
    // Approved vs declined comes ONLY from server-side receipt lookup.
    mco.setCallback("payment_complete", async () => {
      try {
        const res = await fetch(`/api/pay/po/${poId}/moneris/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ref: ref_, ticket }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "Verification failed");
          setErrorMsg(data.error || "Verification failed");
          setPhase("error");
          startedRef.current = false;
          return;
        }
        try {
          mco.closeCheckout();
        } catch {
          // ignore
        }
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
  }, [phase, ticket, environment, poId, ref_, onPaid]);

  return (
    <>
      {/* Load the MCO script when we know which environment we're in.
          Once loaded, flip phase from script_loading → ready. */}
      {scriptUrl && (
        <Script
          src={scriptUrl}
          strategy="afterInteractive"
          onLoad={() => {
            scriptLoadedRef.current = true;
            // If ticket is already back, promote to ready; otherwise the
            // preload effect will do it when the ticket lands.
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
          // The MCO widget paints INTO this div. We keep it mounted even
          // during cancelled so a retry can reuse the same DOM node.
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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
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
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800"
          >
            <Icon icon="solar:refresh-linear" className="w-4 h-4" />
            Restart checkout · {amountLabel}
          </button>
        </div>
      )}

      <p className="text-center text-xs text-gray-400 mt-2">
        Card details are handled by Moneris — never touched by our servers.
      </p>
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
      <div className="w-14 h-14 rounded-full bg-indigo-100 mx-auto mb-4 flex items-center justify-center">
        <Icon
          icon={icon}
          className={`w-7 h-7 text-indigo-500 ${spinning ? "animate-spin" : ""}`}
        />
      </div>
      <h2 className="text-base font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-gray-500">{subtitle}</p>
    </div>
  );
}
