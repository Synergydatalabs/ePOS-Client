"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Card, Input } from "@/components/ui";
import { toast } from "sonner";

interface Connection {
  id: string;
  status: "DISCONNECTED" | "CONNECTED" | "ERROR" | "REVOKED";
  externalLocationId?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  connectedAt?: string | null;
  apiKeySet: boolean;
  apiSecretSet: boolean;
  webhookSecretSet: boolean;
}

export default function DeliverectIntegrationPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Inputs — only sent to server if the merchant actually types something,
  // so we don't overwrite existing secrets with blanks on partial saves.
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [externalLocationId, setExternalLocationId] = useState("");
  // Plaintext webhook secret is only shown ONCE right after rotate.
  const [showWebhookSecret, setShowWebhookSecret] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/integrations/deliverect`
      );
      const d = await res.json();
      if (d.success) {
        setConn(d.connection);
        setExternalLocationId(d.connection?.externalLocationId || "");
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (connectFlag = false) => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const body: any = { externalLocationId };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (apiSecret.trim()) body.apiSecret = apiSecret.trim();
      if (connectFlag) body.connected = true;

      const res = await fetch(
        `/api/tenants/${tenantId}/integrations/deliverect`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (res.ok) {
        toast.success(connectFlag ? "Connected" : "Saved");
        setApiKey("");
        setApiSecret("");
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Save failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const rotateSecret = async () => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/integrations/deliverect/rotate-secret`,
        { method: "POST" }
      );
      const d = await res.json();
      if (d.success) {
        setShowWebhookSecret(d.webhookSecret);
        toast.success("Webhook secret rotated — copy it now");
        load();
      } else {
        toast.error(d.error || "Rotate failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const syncMenu = async () => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/integrations/deliverect/sync-menu`,
        { method: "POST" }
      );
      const d = await res.json();
      if (d.success) {
        toast.success("Menu pushed to Deliverect");
        load();
      } else {
        toast.error(d.error || "Menu sync failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!tenantId) return;
    if (!confirm("Disconnect Deliverect? Delivery orders will stop reaching iTap until you reconnect.")) return;
    setBusy(true);
    try {
      await fetch(`/api/tenants/${tenantId}/integrations/deliverect`, {
        method: "DELETE",
      });
      toast.success("Disconnected");
      load();
    } finally {
      setBusy(false);
    }
  };

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/integrations/deliverect/webhook`
      : "/api/integrations/deliverect/webhook";

  return (
    <div>
      <AdminHeader
        title="Deliverect"
        subtitle="One integration for DoorDash, Uber Eats, and SkipTheDishes"
      />

      <div className="p-6 space-y-6 max-w-3xl">
        {/* Provider explainer */}
        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center flex-shrink-0">
              <Icon icon="solar:delivery-bold" className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">How this works</h3>
              <p className="text-sm text-gray-600 mt-1">
                Deliverect is a middleware you subscribe to (typically $50–100/mo per location).
                It connects to DoorDash / Uber Eats / SkipTheDishes for you. Once you enter your
                Deliverect credentials below, iTap can push your menu to all three platforms
                and receive orders back into your POS automatically.
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Sign up at{" "}
                <a
                  href="https://www.deliverect.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 hover:underline"
                >
                  deliverect.com
                </a>
                {" "}→ get your API key + secret + location ID from their dashboard.
              </p>
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="card p-12 text-center text-gray-400">
            <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto mb-2" />
            Loading...
          </div>
        ) : (
          <>
            {/* Connection status */}
            <Card>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">Status</h3>
                  <p className="text-sm text-gray-500">
                    {conn?.status === "CONNECTED"
                      ? `Connected ${conn.connectedAt ? new Date(conn.connectedAt).toLocaleDateString() : ""}`
                      : "Not connected — enter your Deliverect credentials below"}
                  </p>
                </div>
                <span
                  className={`inline-block px-2 py-0.5 text-xs rounded-full border ${
                    conn?.status === "CONNECTED"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : conn?.status === "ERROR"
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-gray-50 text-gray-600 border-gray-200"
                  }`}
                >
                  {conn?.status?.toLowerCase() || "disconnected"}
                </span>
              </div>
              {conn?.lastError && (
                <p className="text-xs text-red-600 mb-2">
                  Last error: {conn.lastError}
                  {conn.lastErrorAt && ` · ${new Date(conn.lastErrorAt).toLocaleString()}`}
                </p>
              )}
              {conn?.lastSyncAt && (
                <p className="text-xs text-gray-500">
                  Last menu sync: {new Date(conn.lastSyncAt).toLocaleString()}
                </p>
              )}
            </Card>

            {/* Credentials form */}
            <Card>
              <h3 className="font-semibold text-gray-900 mb-3">Deliverect credentials</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    API Key {conn?.apiKeySet && <span className="text-xs text-green-600 ml-2">✓ saved</span>}
                  </label>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={conn?.apiKeySet ? "•••••••• (leave blank to keep existing)" : "Deliverect client id"}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    API Secret {conn?.apiSecretSet && <span className="text-xs text-green-600 ml-2">✓ saved</span>}
                  </label>
                  <input
                    type="password"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder={conn?.apiSecretSet ? "•••••••• (leave blank to keep existing)" : "Deliverect client secret"}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Location ID
                  </label>
                  <input
                    type="text"
                    value={externalLocationId}
                    onChange={(e) => setExternalLocationId(e.target.value)}
                    placeholder="From Deliverect's location settings"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none font-mono text-sm"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button variant="secondary" onClick={() => save(false)} loading={busy}>
                    Save
                  </Button>
                  {conn?.status !== "CONNECTED" && (
                    <Button
                      onClick={() => save(true)}
                      disabled={
                        busy ||
                        !externalLocationId ||
                        (!conn?.apiKeySet && !apiKey.trim()) ||
                        (!conn?.apiSecretSet && !apiSecret.trim())
                      }
                    >
                      <Icon icon="solar:link-linear" className="w-4 h-4 mr-1" />
                      Save &amp; Connect
                    </Button>
                  )}
                  {conn?.status === "CONNECTED" && (
                    <button
                      onClick={disconnect}
                      className="ml-auto text-sm text-red-600 hover:text-red-700 font-medium"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            </Card>

            {/* Webhook config */}
            {conn?.status === "CONNECTED" && (
              <Card>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">Webhook</h3>
                    <p className="text-sm text-gray-500">
                      In Deliverect's dashboard, set the webhook URL + secret so incoming
                      delivery orders reach iTap.
                    </p>
                  </div>
                </div>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs uppercase text-gray-500 mb-1">Webhook URL</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-gray-50 rounded-lg font-mono text-xs break-all">
                        {webhookUrl}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(webhookUrl)}
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                        title="Copy"
                      >
                        <Icon icon="solar:copy-linear" className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs uppercase text-gray-500">
                        Webhook Secret{" "}
                        {conn.webhookSecretSet && (
                          <span className="text-green-600 ml-1">✓ saved</span>
                        )}
                      </p>
                      <button
                        onClick={rotateSecret}
                        disabled={busy}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                      >
                        {conn.webhookSecretSet ? "Rotate" : "Generate"}
                      </button>
                    </div>
                    {showWebhookSecret ? (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                        <p className="text-xs text-amber-900 mb-1 font-medium">
                          Copy this now — it won't be shown again.
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 font-mono text-xs break-all">
                            {showWebhookSecret}
                          </code>
                          <button
                            onClick={() =>
                              navigator.clipboard.writeText(showWebhookSecret)
                            }
                            className="p-1.5 rounded hover:bg-white/50 text-amber-700"
                            title="Copy"
                          >
                            <Icon icon="solar:copy-linear" className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : conn.webhookSecretSet ? (
                      <p className="text-xs text-gray-500 italic">
                        Encrypted at rest — click Rotate to generate a new one.
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 italic">
                        Not yet generated — click Generate above.
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Menu sync */}
            {conn?.status === "CONNECTED" && (
              <Card>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">Menu Sync</h3>
                    <p className="text-sm text-gray-500">
                      Push your current active products to Deliverect — flows through to all
                      connected delivery platforms.
                    </p>
                  </div>
                  <Button onClick={syncMenu} loading={busy}>
                    <Icon icon="solar:upload-linear" className="w-4 h-4 mr-1" />
                    Sync Menu Now
                  </Button>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
