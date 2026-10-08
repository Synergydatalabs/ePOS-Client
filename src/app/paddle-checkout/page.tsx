"use client";

// =============================================================================
// /paddle-checkout — Paddle.js overlay checkout host page
//
// 2026-10-08: Paddle Billing (unlike Paddle Classic) has no built-in hosted
// checkout. The customer flow is:
//   1. /l/[slug] POSTs to /api/public/payment-links/[slug]/paddle-start
//   2. paddle-start creates a Paddle transaction + returns Paddle's
//      data.checkout.url, which is `${checkout.url}?_ptxn=<txn_id>` — i.e.
//      the checkout URL we told Paddle plus the transaction id.
//   3. We set checkout.url to THIS page, so the browser arrives at
//      /paddle-checkout?invoiceId=<id>&_ptxn=<txn>.
//   4. This page loads Paddle.js, reads _ptxn from the URL and calls
//      Paddle.Checkout.open({ transactionId }) which renders Paddle's
//      overlay (card / KakaoPay / Alipay / PayPal / etc).
//   5. After the customer pays, Paddle.js honours successUrl and sends
//      the browser to /pay/invoice/<id>?paid=1&via=paddle, where the
//      polling effect catches the webhook-flipped invoice.
//
// Branding: Indian Beans palette so the page the customer sees BEHIND
// Paddle's overlay matches the rest of their flow.
// =============================================================================

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Script from "next/script";

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (opts: Record<string, unknown>) => void;
      Checkout: {
        open: (opts: Record<string, unknown>) => void;
      };
    };
  }
}

const INDIAN_BEANS_GREEN = "#17301F";
const INDIAN_BEANS_GOLD = "#E0A526";

function PaddleCheckoutInner() {
  const searchParams = useSearchParams();
  const txnId = searchParams?.get("_ptxn") || null;
  const invoiceId = searchParams?.get("invoiceId") || null;
  const [state, setState] = useState<"loading" | "opening" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  const paddleEnv =
    process.env.NEXT_PUBLIC_PADDLE_ENV === "sandbox" ? "sandbox" : "production";

  useEffect(() => {
    if (!clientToken) {
      setErrorMessage("Payment system is not fully configured. Please contact Indian Beans.");
      setState("error");
      return;
    }
    if (!txnId) {
      setErrorMessage("Missing transaction reference in the checkout URL.");
      setState("error");
      return;
    }
    if (!invoiceId) {
      setErrorMessage("Missing invoice reference in the checkout URL.");
      setState("error");
      return;
    }
  }, [txnId, invoiceId, clientToken]);

  function openCheckout() {
    if (!window.Paddle || !txnId || !invoiceId || !clientToken) return;
    if (state === "opening" || state === "ready") return;
    setState("opening");
    try {
      window.Paddle.Environment.set(paddleEnv);
      window.Paddle.Initialize({
        token: clientToken,
        checkout: {
          settings: {
            displayMode: "overlay",
            theme: "light",
            variant: "one-page",
            successUrl: `${window.location.origin}/pay/invoice/${invoiceId}?paid=1&via=paddle`,
          },
        },
        eventCallback: (event: { name?: string }) => {
          if (!event?.name) return;
          // Visible in browser devtools; useful for debugging.
          console.log("[PADDLE-CHECKOUT]", event.name, event);
        },
      });
      window.Paddle.Checkout.open({
        transactionId: txnId,
      });
      setState("ready");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not open checkout.";
      setErrorMessage(msg);
      setState("error");
    }
  }

  if (state === "error") {
    return (
      <ShellWrap>
        <div className="rounded-2xl bg-white border border-amber-200 p-8 max-w-md text-center">
          <h1 className="text-xl font-bold" style={{ color: INDIAN_BEANS_GREEN }}>
            Checkout unavailable
          </h1>
          <p className="mt-2 text-sm text-gray-600">{errorMessage}</p>
          <p className="mt-4 text-xs text-gray-500">
            Please return to the invoice and try again, or contact{" "}
            <a href="mailto:hello@indianbeans.com" className="underline">
              hello@indianbeans.com
            </a>
            .
          </p>
        </div>
      </ShellWrap>
    );
  }

  return (
    <ShellWrap>
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        strategy="afterInteractive"
        onLoad={openCheckout}
      />
      <div className="rounded-2xl bg-white border border-gray-100 p-10 max-w-md text-center shadow-sm">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-5"
          style={{ backgroundColor: `${INDIAN_BEANS_GOLD}22` }}
        >
          <span
            className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: INDIAN_BEANS_GOLD, borderTopColor: "transparent" }}
          />
        </div>
        <h1
          className="text-xl font-bold tracking-tight"
          style={{ color: INDIAN_BEANS_GREEN }}
        >
          Opening secure checkout…
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          A payment window from our secure partner will appear in a moment.
        </p>
        <p className="mt-6 text-xs text-gray-400">
          Powered by Paddle · Processed by Indian Beans
        </p>
      </div>
    </ShellWrap>
  );
}

function ShellWrap({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: "#F8F6F1" }}
    >
      {/* Indian Beans brand header */}
      <div className="flex items-center gap-3 mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sites/indianbeans/assets/logo.svg"
          alt="Indian Beans"
          className="h-10 w-auto"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).replaceWith(
              Object.assign(document.createElement("span"), {
                textContent: "Indian Beans",
                className: "text-2xl font-extrabold",
                style: `color: ${INDIAN_BEANS_GREEN};`,
              })
            );
          }}
        />
      </div>
      {children}
    </div>
  );
}

export default function PaddleCheckoutPage() {
  return (
    <Suspense fallback={<ShellWrap><p className="text-sm text-gray-500">Loading…</p></ShellWrap>}>
      <PaddleCheckoutInner />
    </Suspense>
  );
}
