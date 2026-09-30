"use client";

// ============================================================================
// /dashboard/admin/integrations/whatsapp
//
// Manual paste form. The business owner gets 5 values from Meta and pastes
// them here. Save & test sends a real WhatsApp to a number they choose so
// they can prove the connection works before they trust it for guests.
//
// Embedded Signup (1-click) will be added in a future phase behind the same
// page — toggle by `connectionType === "embedded"`.
// ============================================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";

interface WhatsAppStatus {
  connected: boolean;
  source: "tenant" | "shared" | "none";
  phoneNumberId: string | null;
  displayName: string | null;
  connectionType: string | null;
  connectedAt: string | null;
  healthStatus: string | null;
  usingSharedSender: boolean;
}

export default function WhatsAppIntegrationPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState("");
  const [displayName, setDisplayName] = useState("");

  // UX state
  const [saving, setSaving] = useState(false);
  const [testingPhone, setTestingPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  // "shared" = use ZASHX-managed sender (Mode A, no setup needed).
  // "byo" = bring-your-own Meta credentials (Mode B, 5-field form).
  // Defaults to shared; flips to byo automatically once the partner has saved
  // their own credentials.
  const [mode, setMode] = useState<"shared" | "byo">("shared");

  useEffect(() => {
    setTenantId(localStorage.getItem("tap_active_tenant"));
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    loadStatus();
  }, [tenantId]);

  async function loadStatus() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/integrations/whatsapp`);
      const data = await res.json();
      if (data.success) {
        setStatus(data.whatsapp);
        if (data.whatsapp.phoneNumberId) setPhoneNumberId(data.whatsapp.phoneNumberId);
        if (data.whatsapp.displayName) setDisplayName(data.whatsapp.displayName);
        // If the tenant has their own credentials saved, snap to BYO mode
        // so they see (and can edit) their setup. Otherwise default to
        // the shared sender card.
        setMode(data.whatsapp.source === "tenant" ? "byo" : "shared");
      }
    } catch (err) {
      console.error("Failed to load status:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/tenants/${tenantId}/integrations/whatsapp`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumberId,
          wabaId,
          accessToken,
          appSecret,
          webhookVerifyToken,
          displayName,
          connectionType: "manual",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({
          tone: "success",
          text: "Saved. Tip: hit 'Send test message' below to confirm Meta accepts your credentials.",
        });
        // Clear secret fields after successful save — never display them again
        setAccessToken("");
        setAppSecret("");
        setWebhookVerifyToken("");
        await loadStatus();
      } else {
        setMessage({ tone: "error", text: data.error || "Save failed." });
      }
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "Network error." });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!tenantId || !testingPhone) return;
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/integrations/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toPhone: testingPhone }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({
          tone: "success",
          text:
            `Test sent via ${data.credentialSource ?? data.provider}. ` +
            `Check your WhatsApp — message id ${(data.messageId || "").slice(0, 12)}…`,
        });
      } else {
        setMessage({
          tone: "error",
          text: `Test failed: ${data.error || "unknown error"}. Double-check the phone number ID and access token, then save again.`,
        });
      }
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "Network error." });
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!tenantId) return;
    if (!confirm("Disconnect WhatsApp? Your stored Meta credentials will be deleted. The platform will fall back to the shared sender until you reconnect.")) {
      return;
    }
    setSaving(true);
    try {
      await fetch(`/api/tenants/${tenantId}/integrations/whatsapp`, { method: "DELETE" });
      setPhoneNumberId(""); setWabaId(""); setDisplayName("");
      setAccessToken(""); setAppSecret(""); setWebhookVerifyToken("");
      await loadStatus();
      setMessage({ tone: "info", text: "Disconnected. The shared platform sender will be used until you reconnect." });
    } finally {
      setSaving(false);
    }
  }

  if (!tenantId || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="WhatsApp Business" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="WhatsApp Business"
        subtitle="Connect your Meta Business Account so messages go out from your number and brand"
        actions={
          <Link
            href="/dashboard/admin/integrations"
            className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
          >
            <Icon icon="solar:arrow-left-bold" className="w-4 h-4" />
            All integrations
          </Link>
        }
      />

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Status banner */}
        <div
          className={`rounded-xl border p-4 flex items-start gap-3 ${
            status?.source === "tenant"
              ? "bg-green-50 border-green-200"
              : status?.source === "shared"
              ? "bg-amber-50 border-amber-200"
              : "bg-gray-50 border-gray-200"
          }`}
        >
          <Icon
            icon={
              status?.source === "tenant"
                ? "solar:check-circle-bold"
                : status?.source === "shared"
                ? "solar:info-circle-bold"
                : "solar:close-circle-bold"
            }
            className={`w-6 h-6 mt-0.5 ${
              status?.source === "tenant"
                ? "text-green-600"
                : status?.source === "shared"
                ? "text-amber-600"
                : "text-gray-400"
            }`}
          />
          <div className="flex-1">
            <p className="font-medium text-gray-900">
              {status?.source === "tenant"
                ? `Connected as "${status.displayName || "your business"}"`
                : status?.source === "shared"
                ? "Using shared sender"
                : "Not connected"}
            </p>
            <p className="text-sm text-gray-600 mt-0.5">
              {status?.source === "tenant"
                ? `Phone number ID: ${status.phoneNumberId} · Connected ${
                    status.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : ""
                  }`
                : status?.source === "shared"
                ? "Messages currently send from the shared sender's number. Paste your own credentials below to use your business name."
                : "WhatsApp messages are disabled. Set up Meta credentials below to enable."}
            </p>
          </div>
        </div>

        {/* Mode selector — Shared (Mode A) vs BYO (Mode B) */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="font-semibold text-gray-900 mb-1">Choose how you want WhatsApp to work</h3>
          <p className="text-sm text-gray-500 mb-4">
            Most businesses pick the shared sender — zero setup, messages go out right away.
            Bring your own only if you need messages to come from your business's own WhatsApp number.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Mode A — Shared */}
            <button
              type="button"
              onClick={() => setMode("shared")}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                mode === "shared"
                  ? "border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-200"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-start gap-3">
                <Icon icon="solar:bolt-bold" className="w-5 h-5 text-indigo-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">Use shared sender</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">Recommended</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    One click, no Meta setup. Messages send from a shared number with your business display name. Ideal for getting started.
                  </p>
                </div>
              </div>
            </button>

            {/* Mode B — BYO */}
            <button
              type="button"
              onClick={() => setMode("byo")}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                mode === "byo"
                  ? "border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-200"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-start gap-3">
                <Icon icon="solar:settings-bold" className="w-5 h-5 text-gray-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">Bring your own WhatsApp Business</span>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">Advanced</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    Messages send from <em>your</em> WhatsApp Business number. Requires a Meta Business Account and ~30 min of one-time setup.
                  </p>
                </div>
              </div>
            </button>
          </div>

          {mode === "shared" && status?.source !== "tenant" && (
            <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 flex items-start gap-2">
              <Icon icon="solar:check-circle-bold" className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">You're all set — the shared sender is active.</p>
                <p className="mt-0.5 text-emerald-700/90">Customer messages (booking confirmations, waitlist pings, "your table is ready") send automatically through the shared WhatsApp sender. No further setup needed.</p>
              </div>
            </div>
          )}

          {mode === "shared" && status?.source === "tenant" && (
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-start gap-2">
              <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Your own Meta credentials are still stored.</p>
                <p className="mt-0.5 text-amber-700/90">Click <strong>Disconnect</strong> in the form below if you want to switch the platform fully to the shared sender.</p>
              </div>
            </div>
          )}
        </div>

        {/* Setup walkthrough — only relevant in BYO mode */}
        {mode === "byo" && (
        <details className="rounded-xl border border-gray-200 bg-white p-5">
          <summary className="font-medium text-gray-900 cursor-pointer flex items-center gap-2">
            <Icon icon="solar:book-bookmark-bold" className="w-5 h-5 text-indigo-600" />
            How to get these 5 values from Meta (~30 min, one-time)
          </summary>
          <ol className="mt-4 space-y-3 text-sm text-gray-700 list-decimal list-inside">
            <li>
              Go to <a className="text-indigo-600 underline" href="https://business.facebook.com" target="_blank" rel="noreferrer">business.facebook.com</a> and sign in (or create) your Meta Business Account.
            </li>
            <li>
              <strong>Business Settings → WhatsApp Accounts → Add</strong>. Add a phone number you own. It must NOT be active in the WhatsApp consumer app — if it is, migrate it first.
            </li>
            <li>
              Verify your number via SMS or call. Pick a <strong>display name</strong> (e.g., "La Bella Roma") — Meta approves most small-business names instantly.
            </li>
            <li>
              <strong>Business Settings → Users → System Users → Add</strong>. Create a system user, assign your WhatsApp Business Account, generate a token with permissions <code>whatsapp_business_messaging</code> + <code>whatsapp_business_management</code>, token expiration <strong>Never</strong>. <strong>Copy the token — you'll only see it once.</strong>
            </li>
            <li>
              <strong>WhatsApp Manager → API Setup</strong>. Note the <strong>Phone Number ID</strong> and <strong>WhatsApp Business Account ID</strong>.
            </li>
            <li>
              <strong>Apps → your app → Settings → Basic</strong>. Click "Show" on <strong>App Secret</strong> and copy it.
            </li>
            <li>
              <strong>Apps → your app → WhatsApp → Configuration</strong>. Set Callback URL to <code className="bg-gray-100 px-1.5 py-0.5 rounded">https://itap.zashx.com/api/webhooks/whatsapp</code>, pick any random string for the Verify Token (paste it below too), subscribe to <strong>messages</strong> field.
            </li>
            <li>Paste all 5 values below, click Save, then send a test message to confirm.</li>
          </ol>
        </details>
        )}

        {/* BYO credentials form — only shown when partner picks "Bring your own" */}
        {mode === "byo" && (
        <form onSubmit={handleSave} className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Phone Number ID"
              hint="From Meta API Setup page (NOT the phone number itself)"
              value={phoneNumberId}
              onChange={setPhoneNumberId}
              placeholder="123456789012345"
              required
            />
            <Field
              label="WhatsApp Business Account ID"
              hint="From Meta API Setup page"
              value={wabaId}
              onChange={setWabaId}
              placeholder="987654321098765"
            />
            <Field
              label="Display Name (optional)"
              hint="What appears as the sender name to guests"
              value={displayName}
              onChange={setDisplayName}
              placeholder="La Bella Roma"
            />
          </div>

          <hr className="my-4 border-gray-100" />

          <p className="text-xs uppercase tracking-wide font-semibold text-gray-500">
            Secrets (encrypted at rest; leave blank to keep current value)
          </p>

          <Field
            label="Access Token (System User permanent token)"
            hint="Used as the Bearer token when we call Meta's API. Starts with EAA…"
            type="password"
            value={accessToken}
            onChange={setAccessToken}
            placeholder={status?.connected ? "•••• stored — leave blank to keep" : "EAA…long token…"}
            required={!status?.connected}
          />
          <Field
            label="App Secret"
            hint="From Apps → your app → Settings → Basic. Used to verify Meta signs every webhook we receive."
            type="password"
            value={appSecret}
            onChange={setAppSecret}
            placeholder={status?.connected ? "•••• stored — leave blank to keep" : "abc123…"}
            required={!status?.connected}
          />
          <Field
            label="Webhook Verify Token"
            hint="Any random string. Must match what you paste into Meta's webhook config."
            type="password"
            value={webhookVerifyToken}
            onChange={setWebhookVerifyToken}
            placeholder={status?.connected ? "•••• stored — leave blank to keep" : "random-secret-string"}
            required={!status?.connected}
          />

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={saving || !phoneNumberId}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />}
              {saving ? "Saving…" : "Save credentials"}
            </button>
            {status?.source === "tenant" && (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={saving}
                className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium text-sm disabled:opacity-50"
              >
                Disconnect (switch to shared sender)
              </button>
            )}
          </div>
        </form>
        )}

        {/* Test send card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="font-semibold text-gray-900 mb-2">Send a test message</h3>
          <p className="text-sm text-gray-600 mb-4">
            Enter a phone number (yours) to verify the stored credentials actually reach Meta and a WhatsApp arrives. This sends "✅ Test message from your integration."
          </p>
          <div className="flex gap-2">
            <input
              type="tel"
              value={testingPhone}
              onChange={(e) => setTestingPhone(e.target.value)}
              placeholder="+1 416 555 1234"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !testingPhone}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {testing && <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />}
              {testing ? "Sending…" : "Send test"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Note: in dev mode (no Meta creds set), this logs to the server console instead of sending a real message.
          </p>
        </div>

        {/* Feedback */}
        {message && (
          <div
            className={`rounded-lg p-3 text-sm flex items-start gap-2 ${
              message.tone === "success"
                ? "bg-green-50 text-green-800 border border-green-200"
                : message.tone === "error"
                ? "bg-red-50 text-red-800 border border-red-200"
                : "bg-blue-50 text-blue-800 border border-blue-200"
            }`}
          >
            <Icon
              icon={
                message.tone === "success"
                  ? "solar:check-circle-bold"
                  : message.tone === "error"
                  ? "solar:close-circle-bold"
                  : "solar:info-circle-bold"
              }
              className="w-5 h-5 flex-shrink-0 mt-0.5"
            />
            <span>{message.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
function Field({
  label, hint, value, onChange, placeholder, type = "text", required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "tel";
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-800 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        spellCheck={false}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}
