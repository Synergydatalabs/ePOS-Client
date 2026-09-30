"use client";

// ============================================================================
// /dashboard/admin/integrations/sms
//
// Mode A — Shared (default): ZASHX-managed AWS SNS sender, billed per message.
//                            One toggle, sender label, done.
// Mode B — BYO Twilio:        Partner provides Twilio Account SID + Auth Token
//                            + From number. Credentials encrypted at rest.
// ============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";

interface SmsStatus {
  enabled: boolean;
  provider: "shared" | "twilio";
  configured: boolean;
  senderLabel: string | null;
  twilioFromNumber: string | null;
  twilioAccountSidStored: boolean;
  twilioAuthTokenStored: boolean;
  connectedAt: string | null;
}

export default function SmsIntegrationPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [status, setStatus] = useState<SmsStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [mode, setMode] = useState<"shared" | "twilio">("shared");
  const [enabled, setEnabled] = useState(false);
  const [senderLabel, setSenderLabel] = useState("");
  const [twilioAccountSid, setTwilioAccountSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [twilioFromNumber, setTwilioFromNumber] = useState("");

  // UX state
  const [saving, setSaving] = useState(false);
  const [testingPhone, setTestingPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    setTenantId(localStorage.getItem("tap_active_tenant"));
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function loadStatus() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/integrations/sms`);
      const data = await res.json();
      if (data.success) {
        setStatus(data.sms);
        setMode(data.sms.provider || "shared");
        setEnabled(!!data.sms.enabled);
        setSenderLabel(data.sms.senderLabel || "");
        setTwilioFromNumber(data.sms.twilioFromNumber || "");
      }
    } catch (err) {
      console.error("Failed to load SMS status:", err);
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
      const res = await fetch(`/api/tenants/${tenantId}/integrations/sms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          provider: mode,
          senderLabel,
          twilioAccountSid: mode === "twilio" ? twilioAccountSid : "",
          twilioAuthToken: mode === "twilio" ? twilioAuthToken : "",
          twilioFromNumber: mode === "twilio" ? twilioFromNumber : "",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({
          tone: "success",
          text:
            mode === "shared"
              ? "Saved. SMS is now active via the shared sender."
              : "Saved. Hit 'Send test SMS' below to verify Twilio accepts your credentials.",
        });
        setTwilioAccountSid("");
        setTwilioAuthToken("");
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
      const res = await fetch(`/api/tenants/${tenantId}/integrations/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toPhone: testingPhone }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({
          tone: "success",
          text: `Test sent via ${data.provider}. Check your phone — message id ${(data.messageId || "").slice(0, 16)}…`,
        });
      } else {
        setMessage({
          tone: "error",
          text: `Test failed: ${data.error || "unknown"}. Provider: ${data.provider || "unknown"}.`,
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
    if (!confirm("Disable SMS for this business? Any stored Twilio credentials will be cleared. You can re-enable any time.")) return;
    setSaving(true);
    try {
      await fetch(`/api/tenants/${tenantId}/integrations/sms`, { method: "DELETE" });
      setEnabled(false);
      setTwilioAccountSid("");
      setTwilioAuthToken("");
      setTwilioFromNumber("");
      await loadStatus();
      setMessage({ tone: "info", text: "SMS disabled." });
    } finally {
      setSaving(false);
    }
  }

  if (!tenantId || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="SMS Integration" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  const isActive = status?.enabled;

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="SMS Integration"
        subtitle="Send waitlist + reservation reminders to customers who aren't on WhatsApp"
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
            isActive && status?.provider === "twilio"
              ? "bg-green-50 border-green-200"
              : isActive
              ? "bg-emerald-50 border-emerald-200"
              : "bg-gray-50 border-gray-200"
          }`}
        >
          <Icon
            icon={isActive ? "solar:check-circle-bold" : "solar:close-circle-bold"}
            className={`w-6 h-6 mt-0.5 ${isActive ? "text-emerald-600" : "text-gray-400"}`}
          />
          <div className="flex-1">
            <p className="font-medium text-gray-900">
              {isActive
                ? status?.provider === "twilio"
                  ? `Enabled — using your Twilio number ${status.twilioFromNumber || ""}`
                  : "Enabled — using shared sender"
                : "SMS is disabled"}
            </p>
            <p className="text-sm text-gray-600 mt-0.5">
              {isActive
                ? status?.provider === "shared"
                  ? "Waitlist pings and reservation reminders are going out via SMS as needed. Billed per message."
                  : `Connected ${status?.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : ""}.`
                : "Pick a mode below and enable to start sending SMS reminders."}
            </p>
          </div>
        </div>

        {/* Mode selector */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="font-semibold text-gray-900 mb-1">Choose your SMS sender</h3>
          <p className="text-sm text-gray-500 mb-4">
            Most businesses pick the shared sender. Bring your own only if you've already got a Twilio number you want to use.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                    No setup. Goes through our managed SMS pipeline. Your business name is prepended to every message so recipients know who sent it.
                    Charged at <strong>$0.02 / SMS</strong>.
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode("twilio")}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                mode === "twilio"
                  ? "border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-200"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-start gap-3">
                <Icon icon="solar:settings-bold" className="w-5 h-5 text-gray-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">Bring your own Twilio</span>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">Advanced</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    Messages send from <em>your</em> Twilio number. You pay Twilio directly. Useful if you already have a 10DLC / toll-free setup.
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          {/* Shared toggle */}
          <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <div className="font-medium text-gray-900">Enable SMS for this business</div>
              <div className="text-sm text-gray-500 mt-0.5">
                When off, the system silently skips SMS sends (WhatsApp is still tried if configured).
              </div>
            </div>
          </label>

          {/* Sender label — shown for shared mode */}
          {mode === "shared" && (
            <Field
              label="Sender label"
              hint="Prepended to every SMS so customers know who's texting them (e.g. 'Oreugo: Your table is ready'). Leave blank to send the raw message."
              value={senderLabel}
              onChange={setSenderLabel}
              placeholder="Oreugo"
            />
          )}

          {/* Twilio fields — only in BYO mode */}
          {mode === "twilio" && (
            <>
              <hr className="my-2 border-gray-100" />
              <p className="text-xs uppercase tracking-wide font-semibold text-gray-500">
                Twilio credentials (encrypted at rest; leave blank to keep current value)
              </p>
              <Field
                label="Account SID"
                hint="From Twilio Console → Account info. Starts with AC…"
                type="password"
                value={twilioAccountSid}
                onChange={setTwilioAccountSid}
                placeholder={status?.twilioAccountSidStored ? "•••• stored — leave blank to keep" : "AC…"}
                required={!status?.twilioAccountSidStored}
              />
              <Field
                label="Auth Token"
                hint="From Twilio Console → Account info → API keys & tokens"
                type="password"
                value={twilioAuthToken}
                onChange={setTwilioAuthToken}
                placeholder={status?.twilioAuthTokenStored ? "•••• stored — leave blank to keep" : "32-char auth token"}
                required={!status?.twilioAuthTokenStored}
              />
              <Field
                label="From number"
                hint="Your purchased Twilio phone number in E.164 format"
                value={twilioFromNumber}
                onChange={setTwilioFromNumber}
                placeholder="+14165550123"
                required
              />
            </>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />}
              {saving ? "Saving…" : "Save settings"}
            </button>
            {isActive && (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={saving}
                className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium text-sm disabled:opacity-50"
              >
                Disable SMS
              </button>
            )}
          </div>
        </form>

        {/* Test send */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="font-semibold text-gray-900 mb-2">Send a test SMS</h3>
          <p className="text-sm text-gray-600 mb-4">
            Enter your phone number to verify the SMS pipeline works end-to-end.
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
              disabled={testing || !testingPhone || !isActive}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {testing && <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />}
              {testing ? "Sending…" : "Send test"}
            </button>
          </div>
          {!isActive && (
            <p className="text-xs text-amber-600 mt-2">
              Enable SMS above first — the test button is disabled while SMS is off.
            </p>
          )}
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
