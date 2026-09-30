"use client";

// =============================================================================
// Phase F #6d (2026-08-27) — Supplier self-serve Stripe settings.
//
// Three-section form:
//   1. API keys              — paste pk_, sk_/rk_, whsec_ ; Test + Save
//   2. Webhook endpoint      — read-only URL + events list to configure in
//                              Stripe Dashboard
//   3. Checkout branding     — informational; links to their Stripe
//                              Dashboard's branding page. We do NOT store
//                              or send branding — Stripe applies the branding
//                              attached to whichever account the API keys
//                              belong to.
//
// Currently-stored keys are shown MASKED (pk_test_••••••••WM). The GET
// endpoint never returns raw secrets to the browser.
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface CurrentConfig {
  configured: boolean;
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | null;
  publishableKey: string | null;
  secretKeyMasked: string | null;
  webhookSecretMasked: string | null;
  accountName: string | null;
  environment: "test" | "live" | "unknown" | null;
  activatedAt: string | null;
}

interface TestResult {
  ok: boolean;
  environment?: "test" | "live";
  currencies?: string[];
  livemode?: boolean;
  error?: string;
}

const TEAL = "#0F766E";
const NAVY = "#0F172A";

export default function SupplierPaymentSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [current, setCurrent] = useState<CurrentConfig | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Form fields — start empty; the current-stored values are shown MASKED
  // alongside so the operator knows something is already there.
  const [publishableKey, setPublishableKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [accountName, setAccountName] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    // Build the webhook URL from window.location so it's always the right
    // host for the environment the supplier is looking at (hub, staging,
    // localhost).
    setWebhookUrl(`${window.location.origin}/api/webhooks/payment/stripe/supplier-invoice`);

    fetch("/api/supplier/settings/payments")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setCurrent(data);
          if (data.publishableKey) setPublishableKey(data.publishableKey);
          if (data.accountName) setAccountName(data.accountName);
        }
      })
      .catch(() => toast.error("Failed to load current settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleTest() {
    // Phase F #6f (2026-08-28): allow testing the stored key too — empty
    // secretKey field + existing configured tenant means "test whatever
    // Stripe key is currently saved for me" (verifies it hasn't been
    // rotated/revoked without needing the operator to re-paste it).
    if (!secretKey.trim() && !current?.configured) {
      toast.error("Paste your secret key first");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/supplier/settings/payments/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secretKey: secretKey.trim() }),
      });
      const data: TestResult = await res.json();
      setTestResult(data);
      if (data.ok) {
        toast.success(`Connected — ${data.environment} mode`);
      } else {
        toast.error(data.error || "Stripe rejected the key");
      }
    } catch {
      toast.error("Network error contacting Stripe");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    // Phase F #6f (2026-08-28): partial-update UX. First-time setup still
    // requires both keys, but once a tenant is configured, an empty input
    // means "keep the stored value" — so the operator can update just the
    // webhook secret (or just rotate the secret key) without re-typing
    // fields that haven't changed. Mirrors the server-side change in
    // ../route.ts POST handler.
    const isFirstTimeSetup = !current?.configured;
    if (isFirstTimeSetup && (!publishableKey.trim() || !secretKey.trim())) {
      toast.error("Publishable and secret keys are both required for initial setup");
      return;
    }
    if (
      !isFirstTimeSetup &&
      !publishableKey.trim() &&
      !secretKey.trim() &&
      !webhookSecret.trim() &&
      accountName.trim() === (current?.accountName || "")
    ) {
      toast.error("Nothing to save — fill in a field to update it");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/supplier/settings/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publishableKey: publishableKey.trim(),
          secretKey: secretKey.trim(),
          webhookSecret: webhookSecret.trim(),
          accountName: accountName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Save failed");
        return;
      }
      toast.success("Stripe keys saved");
      // Clear the raw-key fields on success — the masked values in `current`
      // now represent the truth. Refresh `current`.
      setSecretKey("");
      setWebhookSecret("");
      setTestResult(null);
      const refreshed = await fetch("/api/supplier/settings/payments").then((r) => r.json());
      if (refreshed.success) setCurrent(refreshed);
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-10 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-1/3" />
          <div className="h-64 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-3xl mx-auto">
      <div className="mb-8">
        <Link
          href="/supplier/payments"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <Icon icon="solar:arrow-left-linear" className="w-4 h-4" /> Back to Payments
        </Link>
        <h1 className="text-2xl lg:text-3xl font-bold" style={{ color: NAVY }}>
          Stripe settings
        </h1>
        <p className="text-gray-500 mt-1">
          Bring your own Stripe account. Funds settle directly to your bank —
          hub never touches the money.
        </p>
      </div>

      {/* Current status pill */}
      {current?.configured ? (
        <div className="mb-6 p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex items-start gap-3">
          <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-emerald-900">
              Live on Stripe {current.environment === "test" ? "(test mode)" : "(live mode)"}
            </p>
            <p className="text-emerald-800 mt-0.5">
              New invoices include a Stripe Checkout payment link automatically.
              To rotate keys, paste new ones below and save.
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-6 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3">
          <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">Stripe not configured</p>
            <p className="text-amber-800 mt-0.5">
              Until you paste keys below, invoices are created without a card-payment
              link — customers can only pay out-of-band.
            </p>
          </div>
        </div>
      )}

      {/* ============ Section 1: API keys ============ */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 lg:p-8 mb-6">
        <div className="mb-5">
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>API keys</h2>
          <p className="text-sm text-gray-500 mt-1">
            Get these from{" "}
            <a
              href="https://dashboard.stripe.com/apikeys"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline"
              style={{ color: TEAL }}
            >
              Stripe Dashboard → Developers → API keys
            </a>
            . Restricted keys (rk_…) are recommended over full secret keys (sk_…) —
            they limit blast radius if leaked.
          </p>
        </div>

        {/* Account label */}
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
            Account label
          </label>
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="e.g. Synergy Data Labs — Live"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ ["--tw-ring-color" as any]: TEAL }}
          />
          <p className="text-xs text-gray-500 mt-1">
            Shown to your admins to identify the account. Not visible to customers.
          </p>
        </div>

        {/* Publishable key */}
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
            Publishable key
          </label>
          <input
            type="text"
            value={publishableKey}
            onChange={(e) => setPublishableKey(e.target.value)}
            placeholder="pk_live_… or pk_test_…"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ ["--tw-ring-color" as any]: TEAL }}
          />
          {current?.publishableKey && !publishableKey && (
            <p className="text-xs text-gray-500 mt-1">
              Currently stored: <span className="font-mono">{current.publishableKey}</span>
            </p>
          )}
        </div>

        {/* Secret / restricted key */}
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
            Secret key <span className="text-gray-400 font-normal">(or restricted key)</span>
          </label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={
                current?.secretKeyMasked ? `Current: ${current.secretKeyMasked}` : "sk_live_… / rk_live_…"
              }
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ ["--tw-ring-color" as any]: TEAL }}
            />
            <button
              type="button"
              onClick={() => setShowSecret((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              <Icon
                icon={showSecret ? "solar:eye-closed-linear" : "solar:eye-linear"}
                className="w-4 h-4"
              />
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Never stored in plain text — encrypted at rest with AES-256-GCM. Leave
            blank to keep the currently stored key.
          </p>
        </div>

        {/* Webhook signing secret */}
        <div className="mb-5">
          <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
            Webhook signing secret <span className="text-gray-400 font-normal">(add after creating the endpoint below)</span>
          </label>
          <div className="relative">
            <input
              type={showWebhook ? "text" : "password"}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={
                current?.webhookSecretMasked
                  ? `Current: ${current.webhookSecretMasked}`
                  : "whsec_…"
              }
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ ["--tw-ring-color" as any]: TEAL }}
            />
            <button
              type="button"
              onClick={() => setShowWebhook((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              <Icon
                icon={showWebhook ? "solar:eye-closed-linear" : "solar:eye-linear"}
                className="w-4 h-4"
              />
            </button>
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm flex items-start gap-2 ${
              testResult.ok
                ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
                : "bg-red-50 border border-red-200 text-red-900"
            }`}
          >
            <Icon
              icon={testResult.ok ? "solar:check-circle-bold" : "solar:close-circle-bold"}
              className="w-4 h-4 flex-shrink-0 mt-0.5"
            />
            <div className="min-w-0">
              {testResult.ok ? (
                <>
                  <p className="font-semibold">
                    Connected — {testResult.environment} mode
                    {testResult.livemode === false && " (test)"}
                  </p>
                  {testResult.currencies && testResult.currencies.length > 0 && (
                    <p className="mt-0.5">
                      Account currencies: {testResult.currencies.join(", ").toUpperCase()}
                    </p>
                  )}
                </>
              ) : (
                <p>{testResult.error}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleTest}
            // Phase F #6f (2026-08-28): enabled when either a fresh key is
            // typed OR a key is already stored (in which case Test runs
            // against the stored one — same partial-update UX as Save).
            disabled={testing || (!secretKey.trim() && !current?.configured)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? (
              <>
                <Icon icon="solar:refresh-linear" className="w-4 h-4 animate-spin" />
                Testing…
              </>
            ) : (
              <>
                <Icon icon="solar:test-tube-bold" className="w-4 h-4" />
                Test connection
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleSave}
            // Phase F #6f (2026-08-28): allow save once configured even with
            // some fields blank — server treats blanks as "keep existing".
            // First-time setup still needs both required keys populated.
            disabled={
              saving ||
              (!current?.configured && (!publishableKey.trim() || !secretKey.trim()))
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: TEAL }}
          >
            {saving ? (
              <>
                <Icon icon="solar:refresh-linear" className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Icon icon="solar:diskette-bold" className="w-4 h-4" />
                Save keys
              </>
            )}
          </button>
        </div>
      </section>

      {/* ============ Section 2: Webhook endpoint ============ */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 lg:p-8 mb-6">
        <div className="mb-5">
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>Webhook endpoint</h2>
          <p className="text-sm text-gray-500 mt-1">
            Add this URL in{" "}
            <a
              href="https://dashboard.stripe.com/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline"
              style={{ color: TEAL }}
            >
              Stripe Dashboard → Developers → Webhooks
            </a>
            , then copy the signing secret it gives you back into the field above.
          </p>
        </div>

        <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
          Endpoint URL
        </label>
        <div className="flex items-center gap-2 mb-4">
          <input
            readOnly
            value={webhookUrl}
            className="flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono bg-gray-50 text-gray-700"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={() => copyToClipboard(webhookUrl, "Endpoint URL")}
            className="px-3 py-2.5 rounded-lg text-sm font-semibold text-white flex-shrink-0"
            style={{ backgroundColor: TEAL }}
          >
            Copy
          </button>
        </div>

        <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
          Events to send
        </label>
        <div className="space-y-1.5 text-sm">
          {[
            "checkout.session.completed",
            "payment_intent.succeeded",
            "payment_intent.payment_failed",
            "charge.refunded",
          ].map((ev) => (
            <div key={ev} className="flex items-center gap-2">
              <Icon icon="solar:check-circle-linear" className="w-4 h-4 text-emerald-600" />
              <code className="text-gray-800">{ev}</code>
            </div>
          ))}
        </div>
      </section>

      {/* ============ Section 3: Checkout branding ============ */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 lg:p-8">
        <div className="mb-5">
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>Checkout branding</h2>
          <p className="text-sm text-gray-500 mt-1">
            Your Stripe Checkout page's logo, icon, and colors are controlled from
            your own Stripe Dashboard — not from hub. Stripe reads the branding
            attached to the account whose keys you paste above.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            What buyers see
          </p>
          <ol className="text-sm text-gray-700 space-y-2">
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white border border-gray-200 text-xs font-semibold flex items-center justify-center" style={{ color: TEAL }}>1</span>
              <span>Buyer opens the payment link → <b>hub</b>-branded invoice page (your business name at the top)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white border border-gray-200 text-xs font-semibold flex items-center justify-center" style={{ color: TEAL }}>2</span>
              <span>Clicks "Pay with card" → <b>your Stripe</b>-branded checkout page (your logo, your colors)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white border border-gray-200 text-xs font-semibold flex items-center justify-center" style={{ color: TEAL }}>3</span>
              <span>Pays → returned to the hub-branded receipt page</span>
            </li>
          </ol>
        </div>

        <a
          href="https://dashboard.stripe.com/settings/branding"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: TEAL }}
        >
          <Icon icon="solar:palette-bold" className="w-4 h-4" />
          Open Stripe → Settings → Branding
          <Icon icon="solar:arrow-right-up-linear" className="w-4 h-4" />
        </a>
        <p className="text-xs text-gray-500 mt-3">
          Recommended: 512×512 icon, 800×240 wordmark logo (both JPG or PNG on a
          solid background), and a brand color that matches your logo.
        </p>
      </section>
    </div>
  );
}
