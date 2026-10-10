"use client";

// =============================================================================
// 2026-10-09 — Supplier self-serve Helcim settings.
//
// Mirrors the Stripe settings page (/supplier/settings/payments) one-for-one:
//   1. API token + webhook verifier + environment
//   2. Test connection
//   3. Save (encrypts + flips Helcim to ACTIVE, auto-suspends Stripe)
//   4. Webhook endpoint URL (read-only, with copy)
//
// Mutual exclusivity: saving here auto-suspends any active Stripe row for
// this tenant. Only one CARD processor can be active at a time.
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface CurrentConfig {
  configured: boolean;
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | null;
  apiTokenMasked: string | null;
  webhookVerifierMasked: string | null;
  accountName: string | null;
  environment: "test" | "live" | null;
  activatedAt: string | null;
}

interface TestResult {
  ok: boolean;
  account?: string;
  error?: string;
}

const PURPLE = "#6366F1";
const NAVY = "#0F172A";

export default function SupplierHelcimSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [current, setCurrent] = useState<CurrentConfig | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const [apiToken, setApiToken] = useState("");
  const [webhookVerifier, setWebhookVerifier] = useState("");
  const [accountName, setAccountName] = useState("");
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [showToken, setShowToken] = useState(false);
  const [showVerifier, setShowVerifier] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    // Helcim's URL validator blocks the word "helcim" — this endpoint
    // path (`/api/webhooks/h-ecom`) is what the operator pastes into
    // the Helcim portal.
    setWebhookUrl(`${window.location.origin}/api/webhooks/h-ecom`);

    fetch("/api/supplier/settings/helcim")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setCurrent(data);
          if (data.accountName) setAccountName(data.accountName);
          if (data.environment) setEnvironment(data.environment);
        }
      })
      .catch(() => toast.error("Failed to load current Helcim settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleTest() {
    if (!apiToken.trim() && !current?.configured) {
      toast.error("Paste your API token first");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/supplier/settings/helcim/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: apiToken.trim() }),
      });
      const data: TestResult = await res.json();
      setTestResult(data);
      if (data.ok) {
        toast.success(
          data.account ? `Connected — ${data.account}` : "Connected to Helcim"
        );
      } else {
        toast.error(data.error || "Helcim rejected the token");
      }
    } catch {
      toast.error("Network error contacting Helcim");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    const isFirstTimeSetup = !current?.configured;
    if (isFirstTimeSetup && !apiToken.trim()) {
      toast.error("API token is required for initial setup");
      return;
    }
    if (
      !isFirstTimeSetup &&
      !apiToken.trim() &&
      !webhookVerifier.trim() &&
      accountName.trim() === (current?.accountName || "") &&
      environment === current?.environment
    ) {
      toast.error("Nothing to save — fill in a field to update it");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/supplier/settings/helcim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiToken: apiToken.trim(),
          webhookVerifier: webhookVerifier.trim(),
          accountName: accountName.trim(),
          environment,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Save failed");
        return;
      }
      toast.success("Helcim settings saved — Helcim is now your active card processor");
      setApiToken("");
      setWebhookVerifier("");
      setTestResult(null);
      const refreshed = await fetch("/api/supplier/settings/helcim").then((r) => r.json());
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
          href="/supplier/settings"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <Icon icon="solar:arrow-left-linear" className="w-4 h-4" /> Back to Settings
        </Link>
        <h1 className="text-2xl lg:text-3xl font-bold" style={{ color: NAVY }}>
          Helcim settings
        </h1>
        <p className="text-gray-500 mt-1">
          Bring your own Helcim account. Funds settle directly to your bank —
          we never touch the money. Only one card processor can be active per
          tenant; enabling Helcim deactivates Stripe automatically.
        </p>
      </div>

      {current?.configured ? (
        <div className="mb-6 p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex items-start gap-3">
          <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-emerald-900">
              Live on Helcim ({current.environment === "test" ? "test mode" : "live mode"})
            </p>
            <p className="text-emerald-800 mt-0.5">
              Card payments on your checkout pages flow through Helcim. To
              rotate the token, paste a new one below and save.
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-6 p-4 rounded-xl border border-amber-200 bg-amber-50 flex items-start gap-3">
          <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">Helcim not configured</p>
            <p className="text-amber-800 mt-0.5">
              Paste your API token below to accept Helcim payments.
            </p>
          </div>
        </div>
      )}

      {/* Section 1: API token */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 lg:p-8 mb-6">
        <div className="mb-5">
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>API token</h2>
          <p className="text-sm text-gray-500 mt-1">
            Get this from{" "}
            <a
              href="https://app.helcim.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline"
              style={{ color: PURPLE }}
            >
              Helcim Portal → Settings → API Access
            </a>
            . Make sure Transaction Processing is set to "Positive Transaction".
          </p>
        </div>

        {/* Environment selector */}
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
            Environment
          </label>
          <div className="flex gap-2">
            {(["test", "live"] as const).map((env) => (
              <button
                key={env}
                type="button"
                onClick={() => setEnvironment(env)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                  environment === env
                    ? "text-white border-transparent"
                    : "text-gray-700 border-gray-200 bg-white hover:bg-gray-50"
                }`}
                style={environment === env ? { backgroundColor: PURPLE } : undefined}
              >
                {env === "test" ? "Test mode" : "Live mode"}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Match the "Test Mode" toggle on your HelcimPay.js config in the
            portal. Test cards work only in test mode.
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
            style={{ ["--tw-ring-color" as any]: PURPLE }}
          />
          <p className="text-xs text-gray-500 mt-1">
            Shown to your admins. Not visible to customers.
          </p>
        </div>

        {/* API token */}
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
            API token
          </label>
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={
                current?.apiTokenMasked
                  ? `Current: ${current.apiTokenMasked}`
                  : "Paste the API Access token from Helcim"
              }
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ ["--tw-ring-color" as any]: PURPLE }}
            />
            <button
              type="button"
              onClick={() => setShowToken((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              <Icon
                icon={showToken ? "solar:eye-closed-linear" : "solar:eye-linear"}
                className="w-4 h-4"
              />
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Encrypted at rest with AES-256-GCM. Leave blank to keep the stored
            token.
          </p>
        </div>

        {/* Webhook verifier */}
        <div className="mb-5">
          <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
            Webhook verifier{" "}
            <span className="text-gray-400 font-normal">(add after creating the webhook below)</span>
          </label>
          <div className="relative">
            <input
              type={showVerifier ? "text" : "password"}
              value={webhookVerifier}
              onChange={(e) => setWebhookVerifier(e.target.value)}
              placeholder={
                current?.webhookVerifierMasked
                  ? `Current: ${current.webhookVerifierMasked}`
                  : "Verifier token from Helcim's webhook config"
              }
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ ["--tw-ring-color" as any]: PURPLE }}
            />
            <button
              type="button"
              onClick={() => setShowVerifier((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              <Icon
                icon={showVerifier ? "solar:eye-closed-linear" : "solar:eye-linear"}
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
                <p className="font-semibold">
                  Connected{testResult.account ? ` — ${testResult.account}` : ""}
                </p>
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
            disabled={testing || (!apiToken.trim() && !current?.configured)}
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
            disabled={saving || (!current?.configured && !apiToken.trim())}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: PURPLE }}
          >
            {saving ? (
              <>
                <Icon icon="solar:refresh-linear" className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Icon icon="solar:diskette-bold" className="w-4 h-4" />
                Save &amp; activate
              </>
            )}
          </button>
        </div>
      </section>

      {/* Section 2: Webhook endpoint */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 lg:p-8 mb-6">
        <div className="mb-5">
          <h2 className="text-lg font-bold" style={{ color: NAVY }}>Webhook endpoint</h2>
          <p className="text-sm text-gray-500 mt-1">
            In Helcim Portal → Settings → Integrations → Webhooks, add a
            webhook pointing to the URL below. Copy the verifier token Helcim
            gives you back into the field above.
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
            style={{ backgroundColor: PURPLE }}
          >
            Copy
          </button>
        </div>

        <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
          Events to send
        </label>
        <div className="space-y-1.5 text-sm">
          {["transactionSuccess", "transactionFailed", "transactionRefunded"].map((ev) => (
            <div key={ev} className="flex items-center gap-2">
              <Icon icon="solar:check-circle-linear" className="w-4 h-4 text-emerald-600" />
              <code className="text-gray-800">{ev}</code>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
