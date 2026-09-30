"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Script from "next/script";
import { Icon } from "@iconify/react";

// Global types for the GP JS library (loaded from CDN)
declare global {
  interface Window {
    GlobalPayments?: any;
  }
}

export interface DropInCheckoutProps {
  orderId?: string;
  tenantId?: string;
  amount: number;            // in cents
  currency?: string;         // "CAD" | "USD" | ...
  description?: string;
  /** PHASE 7a (2026-05-18): merchant display name for Google Pay sheet.
   *  Should be the active tenant's brand name. Defaults to "ZashX" so we
   *  never accidentally show another partner's name. */
  merchantName?: string;
  /** Called when the payment succeeds. Receives the GP transaction info. */
  onSuccess?: (result: {
    transactionId?: string;
    authCode?: string;
    cardBrand?: string;
    cardLast4?: string;
    amount?: number;
    currency?: string;
  }) => void;
  /** Called when the payment fails (declined, timeout, etc.) */
  onError?: (message: string) => void;
  /** Override label on the built-in pay button (Drop-in styles it) */
  style?: "gp-default" | "blank";
}

type Stage = "loading-script" | "fetching-token" | "ready" | "processing" | "paid" | "error";

export default function DropInCheckout({
  orderId,
  tenantId,
  amount,
  currency = "CAD",
  description,
  merchantName,
  onSuccess,
  onError,
  style = "gp-default",
}: DropInCheckoutProps) {
  const [stage, setStage] = useState<Stage>("loading-script");
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [jsLibUrl, setJsLibUrl] = useState<string | null>(null);
  const [jsEnv, setJsEnv] = useState<"sandbox" | "production">("sandbox");
  const [walletConfig, setWalletConfig] = useState<{
    merchantId: string | null;
    appleMerchantId: string | null;
    country: string;
    currency: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<any>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  const amountDollars = (Number(amount) / 100).toFixed(2);

  // Step 1 — fetch the short-lived access token from our backend.
  const fetchToken = useCallback(async () => {
    setStage("fetching-token");
    setError(null);
    try {
      const res = await fetch("/api/payments/dropin/access-token", { method: "POST" });

      // Handle non-2xx with friendly messages BEFORE trying to parse JSON
      // (a 404 returns an HTML error page that crashes res.json())
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            "Payment service is not available — the server hasn't been redeployed with the latest code yet."
          );
        }
        const text = await res.text().catch(() => "");
        // Try to extract a JSON error if the body actually is JSON
        try {
          const maybe = JSON.parse(text);
          throw new Error(maybe?.error || `Server returned ${res.status}`);
        } catch {
          throw new Error(`Payment service error (HTTP ${res.status})`);
        }
      }

      const data = await res.json();
      if (!data.success || !data.token) {
        throw new Error(data.error || "Failed to get payment access token");
      }
      setJsLibUrl(data.jsLibUrl || null);
      setJsEnv(data.env === "production" ? "production" : "sandbox");
      if (data.wallets) setWalletConfig(data.wallets);
      return data.token as string;
    } catch (err: any) {
      const msg = err?.message || "Failed to get payment access token";
      setError(msg);
      setStage("error");
      onError?.(msg);
      throw err;
    }
  }, [onError]);

  // Step 2 — once the GP script is loaded and we have a token, mount the Drop-in.
  const initDropIn = useCallback(
    async (token: string) => {
      if (initializedRef.current) return;
      if (!window.GlobalPayments) {
        // script hasn't loaded yet — try again on next tick
        setTimeout(() => initDropIn(token), 150);
        return;
      }

      initializedRef.current = true;

      window.GlobalPayments.configure({
        accessToken: token,
        apiVersion: "2021-03-22",
        env: jsEnv,
      });

      // Build form config — add Apple Pay / Google Pay alternative payment
      // methods (APMs) when the merchant ID is available. GP's library will
      // render the wallet buttons, hand off tokenization, and call
      // `token-success` with the resulting paymentReference (same flow as card).
      const formConfig: Record<string, unknown> = {
        style,
        amount: amountDollars,
        enableSavedPaymentMethods: false,
      };

      const apms: Record<string, unknown> = {};

      if (walletConfig?.merchantId) {
        apms["google-pay"] = {
          merchantInfo: {
            merchantId: walletConfig.merchantId,
            // PHASE 7a (2026-05-18): brand-aware merchant name shown in wallet
            merchantName: merchantName || "ZashX",
          },
          buttonColor: "black",
          buttonType: "long",
          countryCode: walletConfig.country || "CA",
          currencyCode: walletConfig.currency || currency,
        };
      }

      if (walletConfig?.appleMerchantId) {
        apms["apple-pay"] = {
          merchantId: walletConfig.appleMerchantId,
          merchantCapabilities: ["supports3DS"],
          buttonStyle: "black",
          buttonType: "plain",
          countryCode: walletConfig.country || "CA",
          currencyCode: walletConfig.currency || currency,
        };
      }

      if (Object.keys(apms).length > 0) {
        formConfig.apms = apms;
      }

      const cardForm = window.GlobalPayments.creditCard.form(
        "#gp-dropin-form",
        formConfig
      );

      cardForm.ready(() => {
        setStage("ready");
      });

      cardForm.on("token-success", async (resp: any) => {
        setStage("processing");
        try {
          const saleRes = await fetch("/api/payments/dropin/process-sale", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paymentReference: resp.paymentReference,
              amount,
              currency,
              orderId,
              tenantId,
              description,
            }),
          });

          // Handle non-2xx safely — 404 returns HTML, not JSON
          if (!saleRes.ok && saleRes.status === 404) {
            throw new Error(
              "Payment processing endpoint not available — server may need redeployment."
            );
          }

          const text = await saleRes.text();
          let saleData: any = {};
          try {
            saleData = JSON.parse(text);
          } catch {
            throw new Error(`Server returned a non-JSON response (HTTP ${saleRes.status})`);
          }

          if (!saleRes.ok || !saleData.success) {
            throw new Error(saleData.error || saleData.responseMessage || "Payment declined");
          }
          setSuccessInfo(saleData);
          setStage("paid");
          onSuccess?.(saleData);
        } catch (err: any) {
          const msg = err?.message || "Payment failed";
          setError(msg);
          setStage("error");
          onError?.(msg);
        }
      });

      cardForm.on("token-error", (resp: any) => {
        const msg = resp?.reasons?.[0]?.message || "Card validation failed";
        setError(msg);
        setStage("error");
        onError?.(msg);
      });
    },
    [jsEnv, style, amount, amountDollars, currency, orderId, tenantId, description, onSuccess, onError]
  );

  // Orchestrate: once script loaded AND we have container, go.
  useEffect(() => {
    if (!scriptLoaded || !formContainerRef.current) return;
    if (initializedRef.current) return;
    (async () => {
      try {
        const token = await fetchToken();
        await initDropIn(token);
      } catch {
        /* error state already set */
      }
    })();
  }, [scriptLoaded, fetchToken, initDropIn]);

  // Retry helper
  const retry = () => {
    initializedRef.current = false;
    if (formContainerRef.current) formContainerRef.current.innerHTML = "";
    setStage("loading-script");
    setError(null);
    setTimeout(() => setStage("fetching-token"), 50);
  };

  return (
    <div className="w-full">
      {/* Load the GP JS library — default URL until token-fetch returns the real one */}
      <Script
        src={jsLibUrl || "https://js.globalpay.com/4.1.11/globalpayments.js"}
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onReady={() => setScriptLoaded(true)}
      />

      {stage === "loading-script" || stage === "fetching-token" ? (
        <div className="flex items-center justify-center gap-3 py-8 text-gray-500">
          <Icon icon="solar:refresh-bold" className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading secure payment form…</span>
        </div>
      ) : null}

      {/* Drop-in container — always mounted so the form can render */}
      <div
        ref={formContainerRef}
        id="gp-dropin-form"
        className={stage === "paid" || stage === "error" ? "hidden" : ""}
      />

      {stage === "processing" && (
        <div className="flex items-center justify-center gap-3 py-4 text-indigo-600">
          <Icon icon="solar:refresh-bold" className="w-5 h-5 animate-spin" />
          <span className="text-sm font-medium">Processing your payment…</span>
        </div>
      )}

      {stage === "paid" && (
        <div className="py-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
            <Icon icon="solar:check-circle-bold" className="w-10 h-10 text-green-600" />
          </div>
          <h3 className="text-lg font-bold text-gray-900">Payment approved</h3>
          {successInfo?.cardBrand && (
            <p className="text-sm text-gray-600 mt-1">
              {successInfo.cardBrand} •••• {successInfo.cardLast4 || "••••"}
            </p>
          )}
          {successInfo?.authCode && (
            <p className="text-xs text-gray-400 mt-1">Auth: {successInfo.authCode}</p>
          )}
        </div>
      )}

      {stage === "error" && (
        <div className="py-4 px-4 rounded-2xl bg-red-50 border border-red-200">
          <div className="flex items-start gap-3">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-red-800">Payment could not be completed</p>
              <p className="text-sm text-red-700 mt-1">{error}</p>
              <button
                onClick={retry}
                className="mt-2 text-sm font-medium text-red-700 hover:text-red-900 underline"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
