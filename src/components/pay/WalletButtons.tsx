"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";

/**
 * WalletButtons — official-style Apple Pay & Google Pay buttons.
 *
 * - Auto-detects device support (Apple Pay only on Safari/iOS).
 * - Auto-themes via prefers-color-scheme.
 * - Google Pay attempts the REAL Google Pay sheet via Google's Pay API
 *   with `gateway: 'globalpayments'`. Falls back to card form on any
 *   error (with a visible reason message so we can diagnose).
 * - Apple Pay falls back to card until GP enables it on the merchant
 *   account + Apple Developer setup is complete.
 */

export interface WalletButtonsProps {
  amount: number;       // in cents
  currency?: string;
  /**
   * PHASE 7a (2026-05-18): merchant display name shown in the wallet sheet.
   * The caller should pass the active tenant's brand name (or "Oreugo" /
   * "ZashX" as a domain-appropriate fallback). Defaults to "ZashX" if not
   * supplied so we never accidentally show another partner's name.
   */
  merchantName?: string;
  /**
   * Called when a wallet returns a successful token. The token string is the
   * RAW wallet payload (Apple PKPaymentToken / Google paymentMethodData token,
   * JSON-stringified). `walletType` tells the server how to wrap it for GP.
   *
   * Apple Pay used to call its own /process-sale internally; both wallets
   * now bubble up to the parent so wiring stays uniform.
   */
  onWalletToken?: (
    paymentReference: string,
    walletType: "APPLEPAY" | "PAY_BY_GOOGLE"
  ) => void;
  onFallback: () => void;
}

interface WalletConfig {
  merchantId: string | null;
  appleMerchantId: string | null;
  country: string;
  currency: string;
}

type Detected = {
  applePay: boolean;
  googlePay: boolean;
};

export default function WalletButtons({
  amount,
  currency = "CAD",
  merchantName,
  onWalletToken,
  onFallback,
}: WalletButtonsProps) {
  const [detected, setDetected] = useState<Detected>({ applePay: false, googlePay: false });
  const [config, setConfig] = useState<WalletConfig | null>(null);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let applePay = false;
    let googlePay = false;

    try {
      const ApplePaySession = (window as any).ApplePaySession;
      if (ApplePaySession?.canMakePayments) {
        applePay = !!ApplePaySession.canMakePayments();
      }
    } catch {}

    try {
      googlePay =
        typeof (window as any).PaymentRequest === "function" && !applePay;
    } catch {}

    setDetected({ applePay, googlePay });
  }, []);

  useEffect(() => {
    if (!detected.applePay && !detected.googlePay) return;
    fetch("/api/payments/dropin/access-token", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.wallets) setConfig(data.wallets as WalletConfig);
      })
      .catch(() => {});
  }, [detected]);

  // PHASE 7c-fix (2026-05-18): A wallet button should only render when BOTH
  // conditions hold:
  //   1. The device/browser actually supports that wallet (detected.*)
  //   2. The server returned a usable merchant ID (config.*MerchantId)
  //
  // Without (2), the button would appear on Safari/Chrome but the click
  // handler would silently fall back — confusing UX, especially in sandbox
  // where we don't have an Apple Pay merchant cert provisioned (CSR path).
  //
  // For Apple Pay specifically: the native flow here requires OUR own Apple
  // Pay merchant identity certificate (the "with CSR" path). In sandbox /
  // dev-portal accounts GP recommends using their hosted drop-in Apple Pay
  // instead (the "without CSR" path) — which lives in DropInCheckout.tsx
  // and auto-renders when GP_DROPIN_APPLE_MERCHANT_ID env var is set.
  //
  // So leaving GP_DROPIN_APPLE_MERCHANT_ID empty in sandbox cleanly hides
  // the native button here AND prevents the drop-in from showing one too,
  // until GP gives us the right value to use.
  const canShowApplePay = detected.applePay && !!config?.appleMerchantId;
  const canShowGooglePay = detected.googlePay && !!config?.merchantId;

  // Hide the entire component when neither browser-supports-it AND we have
  // a usable merchant ID for the wallet. Note: config loads async, so before
  // it arrives both flags are false and we render null (briefly). When config
  // arrives, the appropriate buttons appear.
  if (!canShowApplePay && !canShowGooglePay) return null;

  const amountStr = (amount / 100).toFixed(2);
  const merchantId = config?.merchantId || null;
  const appleMerchantId = config?.appleMerchantId || null;
  const country = config?.country || "CA";

  const handleGooglePay = async () => {
    setBusy("google");
    setWalletNotice(null);
    try {
      if (!merchantId) {
        setWalletNotice(
          "Google Pay merchant ID not configured on the server. Falling back to card form."
        );
        onFallback();
        return;
      }

      await loadScript("https://pay.google.com/gp/p/js/pay.js");
      const GooglePayClient = (window as any).google?.payments?.api?.PaymentsClient;
      if (!GooglePayClient) throw new Error("Google Pay SDK didn't expose PaymentsClient");

      // NEXT_PUBLIC_GP_ENV controls Google Pay sheet environment.
      // - "prod" -> Google PRODUCTION (real tokens; GP sandbox can still
      //   decrypt these for real-card testing).
      // - default -> TEST (returns dummy tokens; useful only for UI/UX testing
      //   since GP cannot process them).
      const googlePayEnv =
        process.env.NEXT_PUBLIC_GP_ENV === "prod" ? "PRODUCTION" : "TEST";
      const client = new GooglePayClient({ environment: googlePayEnv });

      // Probe support first — if no eligible wallet/cards, this rejects fast
      const isReady = await client.isReadyToPay({
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [
          {
            type: "CARD",
            parameters: {
              allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
              allowedCardNetworks: ["VISA", "MASTERCARD", "AMEX", "DISCOVER"],
            },
          },
        ],
      });

      if (!isReady?.result) {
        setWalletNotice(
          "Google Pay isn't set up on this device yet. Use a card below."
        );
        onFallback();
        return;
      }

      const paymentData = await client.loadPaymentData({
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [
          {
            type: "CARD",
            parameters: {
              allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
              allowedCardNetworks: ["VISA", "MASTERCARD", "AMEX", "DISCOVER"],
            },
            tokenizationSpecification: {
              type: "PAYMENT_GATEWAY",
              parameters: {
                gateway: "globalpayments",
                gatewayMerchantId: merchantId,
              },
            },
          },
        ],
        merchantInfo: {
          // PHASE 7a (2026-05-18): brand-aware merchant name shown in wallet sheet
          merchantName: merchantName || "ZashX",
          // Google Pay REQUIRES merchantId when environment is "PRODUCTION".
          // Get this from https://pay.google.com/business/console — it's
          // separate from your GP gateway merchantId. Optional in TEST mode.
          // Falls back to undefined if env var not set (TEST mode tolerates this).
          ...(process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID
            ? { merchantId: process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID }
            : {}),
        },
        transactionInfo: {
          totalPriceStatus: "FINAL",
          totalPrice: amountStr,
          currencyCode: currency,
          countryCode: country,
        },
      });

      const tokenStr = paymentData?.paymentMethodData?.tokenizationData?.token;
      if (!tokenStr) {
        throw new Error("No token returned from Google Pay");
      }

      // GP's payment_token wants ONLY the inner tokenization data — the JSON
      // string Google returns inside paymentMethodData.tokenizationData.token.
      // That string itself decodes to { signature, protocolVersion, signedMessage },
      // which is what GP decrypts on their side with the Payment Processing cert.
      //
      // Earlier we sent the FULL paymentMethodData wrapper (with type, info,
      // tokenizationData) and GP returned "Invalid token provided" (40085)
      // because they don't expect the outer Google envelope — just the token.
      //
      // The server (sale-client.ts) JSON.parse's this string into an object
      // before sending to GP, so payment_token in the GP request becomes:
      //   { signature: "...", protocolVersion: "ECv1", signedMessage: "..." }
      onWalletToken?.(tokenStr, "PAY_BY_GOOGLE");
    } catch (err: any) {
      const msg = err?.message || String(err);
      // User cancelled the sheet — silent
      if (/cancel|aborted/i.test(msg)) {
        setWalletNotice(null);
      } else {
        setWalletNotice(
          `Google Pay couldn't process this payment (${msg}). Please use the card form below.`
        );
        console.warn("[GooglePay]", err);
      }
      onFallback();
    } finally {
      setBusy(null);
    }
  };

  const handleApplePay = async () => {
    if (!appleMerchantId) {
      setWalletNotice(
        "Apple Pay isn't enabled yet on this merchant. Please use the card form below."
      );
      onFallback();
      return;
    }

    const ApplePaySession = (window as any).ApplePaySession;
    if (!ApplePaySession || !ApplePaySession.canMakePayments()) {
      setWalletNotice("Apple Pay isn't available on this device.");
      onFallback();
      return;
    }

    setBusy("apple");
    try {
      const paymentRequest = {
        countryCode: country || "CA",
        currencyCode: currency,
        merchantCapabilities: ["supports3DS"],
        supportedNetworks: ["visa", "masterCard", "amex", "discover"],
        total: {
          label: "Oreugo",
          amount: amountStr,
          type: "final",
        },
      };

      // ApplePaySession version 6 — works on iOS 16+ / macOS 13+
      const session = new ApplePaySession(6, paymentRequest);

      // Step 1: merchant validation (Apple calls back to verify the domain)
      session.onvalidatemerchant = async (event: any) => {
        try {
          const res = await fetch("/api/payments/apple-pay/validate-merchant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              validationURL: event.validationURL,
              displayName: "Oreugo",
            }),
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || "Validation failed");
          session.completeMerchantValidation(data.merchantSession);
        } catch (err: any) {
          console.error("[Apple Pay] Merchant validation failed:", err);
          session.abort();
          setWalletNotice(
            `Apple Pay setup needs Global Payments to complete linking. Error: ${err?.message || "validation failed"}`
          );
          setBusy(null);
          onFallback();
        }
      };

      // Step 2: payment authorized — Apple returns the encrypted payment token.
      // We bubble it up to the parent's onWalletToken handler (same pattern as
      // Google Pay) so the parent does the /process-sale call with the
      // orderId. We can't call /process-sale here because we don't have
      // orderId in this component.
      //
      // Trade-off: Apple's ApplePaySession.STATUS_SUCCESS / STATUS_FAILURE
      // needs to be reported back to the sheet, but the parent's fetch is
      // async and not visible here. So we optimistically complete the sheet
      // and let the parent show the error UI if /process-sale fails.
      // (Apple's sheet has already collected and signed the card; a "failed"
      //  status here just changes the sheet's animation.)
      session.onpaymentauthorized = (event: any) => {
        try {
          const applePayPayload = event.payment.token;
          session.completePayment(ApplePaySession.STATUS_SUCCESS);
          onWalletToken?.(JSON.stringify(applePayPayload), "APPLEPAY");
        } catch (err: any) {
          session.completePayment(ApplePaySession.STATUS_FAILURE);
          setWalletNotice(err?.message || "Payment failed");
          onFallback();
        } finally {
          setBusy(null);
        }
      };

      session.oncancel = () => {
        setBusy(null);
        // user cancelled — no fallback, just dismiss
      };

      session.begin();
    } catch (err: any) {
      console.error("[Apple Pay] launch error:", err);
      setWalletNotice(`Apple Pay couldn't start: ${err?.message || "unknown"}`);
      setBusy(null);
      onFallback();
    }
  };

  // Always show our Apple Pay button on iOS Safari. GP's library doesn't
  // render its own (we tested — the `apms` config option I tried wasn't real).
  // Until GP confirms either:
  //   a) the exact REST endpoint/body for merchant validation, OR
  //   b) the correct JS library method (e.g. GlobalPayments.applePay.button()),
  // ours is the only Apple Pay button users see.
  return (
    <div className="space-y-2">
      {canShowApplePay && (
        <ApplePayButton
          disabled={busy === "apple"}
          onClick={handleApplePay}
          aria={`Pay $${amountStr} with Apple Pay`}
        />
      )}

      {canShowGooglePay && (
        <GooglePayButton
          disabled={busy === "google"}
          onClick={handleGooglePay}
          aria={`Pay $${amountStr} with Google Pay`}
        />
      )}

      {walletNotice && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {walletNotice}
        </div>
      )}

      {/* OR divider */}
      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">
          or
        </span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>
    </div>
  );
}

// ============================================================
// Apple Pay button — uses iconify's official Apple Pay logo
// (already includes Apple symbol + "Pay" with correct alignment)
// ============================================================
function ApplePayButton({
  disabled,
  onClick,
  aria,
}: {
  disabled?: boolean;
  onClick: () => void;
  aria: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className="
        w-full h-12 rounded-xl flex items-center justify-center
        bg-black hover:bg-zinc-900 active:bg-zinc-950
        dark:bg-white dark:hover:bg-zinc-100 dark:active:bg-zinc-200
        transition-colors disabled:opacity-60
      "
    >
      <Icon
        icon="logos:apple-pay"
        className="h-6 w-auto invert dark:invert-0"
        aria-hidden="true"
      />
    </button>
  );
}

// ============================================================
// Google Pay button — uses iconify's official Google Pay logo
// ============================================================
function GooglePayButton({
  disabled,
  onClick,
  aria,
}: {
  disabled?: boolean;
  onClick: () => void;
  aria: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className="
        w-full h-12 rounded-xl flex items-center justify-center
        bg-black hover:bg-zinc-900 active:bg-zinc-950
        dark:bg-white dark:hover:bg-zinc-100 dark:active:bg-zinc-200
        border border-transparent dark:border-gray-300
        transition-colors disabled:opacity-60
      "
    >
      <Icon
        icon="logos:google-pay"
        className="h-6 w-auto invert dark:invert-0"
        aria-hidden="true"
      />
    </button>
  );
}

// ============================================================
// Helpers
// ============================================================

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("No document"));
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}
