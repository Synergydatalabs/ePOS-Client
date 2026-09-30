"use client";

// /dashboard/admin/integrations/google-business
//
// Three-step UX:
//   1. Not connected   → big "Connect Google" button → OAuth bounce
//   2. Connected, no location linked → location picker
//   3. Fully linked    → status card + Sync now button + Disconnect

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";

interface GbpStatus {
  connected: boolean;
  accountResource: string | null;
  locationResource: string | null;
  locationName: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

interface PickerLocation {
  accountResource: string;
  accountName: string;
  locationResource: string;
  locationTitle: string;
}

export default function GoogleBusinessIntegrationPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <GoogleBusinessIntegrationPageInner />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader title="Google Business Profile" />
      <div className="flex items-center justify-center py-20">
        <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    </div>
  );
}

function GoogleBusinessIntegrationPageInner() {
  const search = useSearchParams();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [status, setStatus] = useState<GbpStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [locations, setLocations] = useState<PickerLocation[] | null>(null);
  const [pickingLocations, setPickingLocations] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    setTenantId(localStorage.getItem("tap_active_tenant"));
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Surface any error / success in the URL (set by the OAuth callback)
  useEffect(() => {
    const err = search.get("gbp_error");
    const ok = search.get("gbp_connected");
    if (err) setMessage({ tone: "error", text: `Google didn't accept the connection: ${err}` });
    else if (ok === "1") setMessage({ tone: "success", text: "Google account connected. Pick the location to link below." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStatus() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/integrations/google-business`);
      const data = await res.json();
      if (data.success) setStatus(data.gbp);
    } catch (err) {
      console.error("Failed to load GBP status:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    if (!tenantId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/integrations/google-business`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (data.success && data.url) {
        window.location.href = data.url;   // bounce to Google's consent screen
      } else {
        setMessage({ tone: "error", text: data.error || "Failed to start OAuth." });
        setBusy(false);
      }
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "Network error." });
      setBusy(false);
    }
  }

  async function handlePickLocations() {
    if (!tenantId) return;
    setPickingLocations(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/integrations/google-business`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-locations" }),
      });
      const data = await res.json();
      if (data.success) {
        setLocations(data.locations || []);
        if (!data.locations?.length) {
          setMessage({
            tone: "info",
            text: "No managed locations found on this Google account. Add your business in business.google.com first, then return here.",
          });
        }
      } else {
        setMessage({ tone: "error", text: data.error || "Failed to fetch locations." });
      }
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "Network error." });
    } finally {
      setPickingLocations(false);
    }
  }

  async function handleLink(loc: PickerLocation) {
    if (!tenantId) return;
    setLinking(loc.locationResource);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/integrations/google-business`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          accountResource: loc.accountResource,
          locationResource: loc.locationResource,
          locationName: loc.locationTitle,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ tone: "success", text: `Linked to ${loc.locationTitle}. Try a sync below to confirm everything works.` });
        setLocations(null);
        await loadStatus();
      } else {
        setMessage({ tone: "error", text: data.error || "Link failed." });
      }
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "Network error." });
    } finally {
      setLinking(null);
    }
  }

  async function handleSync() {
    if (!tenantId) return;
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/integrations/google-business`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ tone: "success", text: "Sync complete." });
      } else {
        const failed = (data.steps || []).filter((s: any) => !s.ok).map((s: any) => `${s.name}: ${s.error}`).join("; ");
        setMessage({ tone: "error", text: failed || "Sync had errors." });
      }
      await loadStatus();
    } catch (err: any) {
      setMessage({ tone: "error", text: err?.message || "Network error." });
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!tenantId) return;
    if (!confirm("Disconnect Google Business Profile? Tokens are cleared and we stop syncing. You can reconnect any time.")) return;
    setBusy(true);
    try {
      await fetch(`/api/tenants/${tenantId}/integrations/google-business`, { method: "DELETE" });
      setLocations(null);
      await loadStatus();
      setMessage({ tone: "info", text: "Google Business Profile disconnected." });
    } finally {
      setBusy(false);
    }
  }

  if (!tenantId || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Google Business Profile" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Google Business Profile"
        subtitle="Sync your hours, address, photos, and reservation link to your Google listing"
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
            status?.connected && status.locationResource
              ? "bg-green-50 border-green-200"
              : status?.connected
              ? "bg-amber-50 border-amber-200"
              : "bg-gray-50 border-gray-200"
          }`}
        >
          <Icon
            icon={
              status?.connected && status.locationResource
                ? "solar:check-circle-bold"
                : status?.connected
                ? "solar:info-circle-bold"
                : "solar:close-circle-bold"
            }
            className={`w-6 h-6 mt-0.5 ${
              status?.connected && status.locationResource
                ? "text-green-600"
                : status?.connected
                ? "text-amber-600"
                : "text-gray-400"
            }`}
          />
          <div className="flex-1">
            <p className="font-medium text-gray-900">
              {status?.connected && status.locationResource
                ? `Linked to ${status.locationName || "your Google listing"}`
                : status?.connected
                ? "Google account connected — pick a location next"
                : "Not connected"}
            </p>
            <p className="text-sm text-gray-600 mt-0.5">
              {status?.connected && status.locationResource && status.lastSyncAt
                ? `Last synced ${new Date(status.lastSyncAt).toLocaleString()}` +
                  (status.lastSyncStatus === "error" ? ` — ${status.lastSyncError}` : "")
                : status?.connected && status.locationResource
                ? "No sync run yet — click Sync to push your details to Google."
                : status?.connected
                ? "We have your tokens but you haven't picked which business listing to sync with."
                : "Connect your Google account to start syncing hours, address, and photos to your Google listing."}
            </p>
          </div>
        </div>

        {/* Action card */}
        {!status?.connected && (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="font-semibold text-gray-900 mb-1">Connect with Google</h3>
            <p className="text-sm text-gray-600 mb-4">
              You'll be redirected to Google to sign in with the account that already owns / manages your business listing.
              We only ask for permission to manage that one listing — nothing else.
            </p>
            <button
              onClick={handleConnect}
              disabled={busy}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Icon icon="logos:google-icon" className="w-4 h-4" />
              {busy ? "Redirecting…" : "Connect with Google"}
            </button>
          </div>
        )}

        {/* Location picker — shows once connected but not yet linked */}
        {status?.connected && !status.locationResource && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">Pick the business listing to link</h3>
              <p className="text-sm text-gray-600">
                We'll list every Google Business location this Google account manages — pick the one for this business.
              </p>
            </div>
            {!locations ? (
              <button
                onClick={handlePickLocations}
                disabled={pickingLocations}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
              >
                {pickingLocations && <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />}
                {pickingLocations ? "Loading…" : "Load my Google locations"}
              </button>
            ) : locations.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No locations found.</p>
            ) : (
              <ul className="space-y-2">
                {locations.map((loc) => (
                  <li
                    key={loc.locationResource}
                    className="rounded-lg border border-gray-200 p-3 flex items-center justify-between hover:bg-gray-50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{loc.locationTitle}</p>
                      <p className="text-xs text-gray-500 truncate">{loc.accountName}</p>
                    </div>
                    <button
                      onClick={() => handleLink(loc)}
                      disabled={!!linking}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {linking === loc.locationResource ? "Linking…" : "Link"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Sync card — only shown when fully linked */}
        {status?.connected && status.locationResource && (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="font-semibold text-gray-900 mb-1">Sync</h3>
            <p className="text-sm text-gray-600 mb-4">
              Pushes your latest business details to Google and pulls any new reviews.
              In Phase 5e we're starting with the business name; hours, photos, and reservation link sync are coming next.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
              >
                {syncing && <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />}
                {syncing ? "Syncing…" : "Sync now"}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium text-sm disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

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
