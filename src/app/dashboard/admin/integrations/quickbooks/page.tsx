"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Card } from "@/components/ui";
import { toast } from "sonner";

type Region = "US" | "CA";

interface Connection {
  id: string;
  provider: "QUICKBOOKS_US" | "QUICKBOOKS_CA";
  status: "DISCONNECTED" | "CONNECTED" | "ERROR" | "REVOKED";
  realmId?: string | null;
  companyName?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  connectedAt?: string | null;
  salesAccountRef?: string | null;
  taxLiabilityRef?: string | null;
  tipsLiabilityRef?: string | null;
  discountsAccountRef?: string | null;
  refundsAccountRef?: string | null;
  cashAccountRef?: string | null;
  cardAccountRef?: string | null;
}

interface AccountRow {
  Id: string;
  Name: string;
  AccountType?: string;
  AccountSubType?: string;
}

interface ApiState {
  connections: Connection[];
  serverConfigured: { US: boolean; CA: boolean };
  accounts: AccountRow[];
}

const MAPPING_LABELS: Array<{ key: keyof Connection; label: string; hint: string }> = [
  { key: "salesAccountRef", label: "Sales income", hint: "Income account where gross sales post" },
  { key: "taxLiabilityRef", label: "Sales tax liability", hint: "Liability account for tax collected" },
  { key: "tipsLiabilityRef", label: "Tips payable (liability)", hint: "Not income — owed to employees" },
  { key: "discountsAccountRef", label: "Discounts (contra-revenue)", hint: "Debit side of the entry" },
  { key: "refundsAccountRef", label: "Refunds", hint: "Debit side; refunds paid out" },
  { key: "cashAccountRef", label: "Cash / Undeposited Funds", hint: "Debit side for cash sales" },
  { key: "cardAccountRef", label: "Card / merchant clearing", hint: "Debit side for card sales" },
];

export default function QuickBooksIntegrationPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-gray-400">
          <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto" />
        </div>
      }
    >
      <QuickBooksPageInner />
    </Suspense>
  );
}

function QuickBooksPageInner() {
  const params = useSearchParams();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [region, setRegion] = useState<Region>("US");
  const [data, setData] = useState<ApiState | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [businessDate, setBusinessDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [preview, setPreview] = useState<any | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  // Surface callback query results (?qboConnected=1 / ?qboError=...)
  useEffect(() => {
    if (params.get("qboConnected")) {
      toast.success("QuickBooks connected");
    }
    const err = params.get("qboError");
    if (err) toast.error(decodeURIComponent(err));
  }, [params]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/integrations/quickbooks?region=${region}`
      );
      const d = await res.json();
      if (d.success) {
        setData(d);
        const conn = d.connections.find(
          (c: Connection) => c.provider === `QUICKBOOKS_${region}`
        );
        setMapping({
          salesAccountRef: conn?.salesAccountRef || "",
          taxLiabilityRef: conn?.taxLiabilityRef || "",
          tipsLiabilityRef: conn?.tipsLiabilityRef || "",
          discountsAccountRef: conn?.discountsAccountRef || "",
          refundsAccountRef: conn?.refundsAccountRef || "",
          cashAccountRef: conn?.cashAccountRef || "",
          cardAccountRef: conn?.cardAccountRef || "",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId, region]);

  useEffect(() => {
    load();
  }, [load]);

  const conn = data?.connections.find(
    (c) => c.provider === `QUICKBOOKS_${region}`
  );
  const serverReady = data?.serverConfigured[region];

  const saveMapping = async () => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/integrations/quickbooks`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ region, ...mapping }),
        }
      );
      if (res.ok) {
        toast.success("Mapping saved");
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Save failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!tenantId) return;
    if (!confirm("Disconnect QuickBooks? You'll need to reconnect to push future syncs.")) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/integrations/quickbooks?region=${region}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        toast.success("Disconnected");
        load();
      }
    } finally {
      setBusy(false);
    }
  };

  const runSync = async (dryRun: boolean) => {
    if (!tenantId) return;
    setBusy(true);
    setPreview(null);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/integrations/quickbooks/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ region, businessDate, dryRun }),
        }
      );
      const d = await res.json();
      if (res.ok && d.success) {
        setPreview(d.preview);
        if (dryRun) {
          toast.success("Preview ready — nothing pushed to QBO");
        } else {
          toast.success(`Pushed to QBO — JE ref ${d.externalRef}`);
          load();
        }
      } else {
        toast.error(d.error || "Sync failed");
        if (d.preview) setPreview(d.preview);
      }
    } finally {
      setBusy(false);
    }
  };

  const connectUrl =
    tenantId && serverReady
      ? `/api/integrations/quickbooks/authorize?tenantId=${tenantId}&region=${region}`
      : null;

  return (
    <div>
      <AdminHeader
        title="QuickBooks Online"
        subtitle="Push daily sales summary as a Journal Entry"
      />

      <div className="p-6 space-y-6">
        {/* Region toggle */}
        <div className="card p-3 flex items-center gap-2">
          {(["US", "CA"] as Region[]).map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                region === r
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              QuickBooks {r}
            </button>
          ))}
        </div>

        {loading ? (
          <Loading />
        ) : !serverReady ? (
          <div className="card p-6 border-l-4 border-l-amber-400 bg-amber-50/50">
            <p className="font-semibold text-amber-900 mb-1">
              Not configured on this server
            </p>
            <p className="text-sm text-amber-800">
              QuickBooks {region} isn't configured yet. Set the following env
              vars and restart:
            </p>
            <pre className="mt-3 p-3 bg-white rounded-lg text-xs font-mono border border-amber-100">
              QBO_{region}_CLIENT_ID=...{"\n"}QBO_{region}_CLIENT_SECRET=...{"\n"}QBO_REDIRECT_URI=https://itap.zashx.com/api/integrations/quickbooks/callback{"\n"}QBO_ENVIRONMENT=sandbox{"  # or production"}{"\n"}INTEGRATION_ENC_KEY=&lt;64-hex-char key for token encryption at rest&gt;
            </pre>
          </div>
        ) : !conn || conn.status !== "CONNECTED" ? (
          <Card>
            <div className="p-4 text-center">
              <Icon
                icon="solar:link-broken-linear"
                className="w-12 h-12 text-gray-300 mx-auto mb-3"
              />
              <p className="font-semibold text-gray-900 mb-1">
                Not connected to QuickBooks {region}
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Connect to push daily sales summaries as Journal Entries.
              </p>
              {conn?.lastError && (
                <p className="text-xs text-red-600 mb-3">
                  Last error: {conn.lastError}
                </p>
              )}
              {connectUrl && (
                <a
                  href={connectUrl}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                >
                  <Icon icon="solar:link-linear" className="w-4 h-4" />
                  Connect QuickBooks {region}
                </a>
              )}
            </div>
          </Card>
        ) : (
          <>
            {/* Connection status */}
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 border border-green-200">
                      Connected
                    </span>
                    {conn.realmId && (
                      <span className="text-xs text-gray-500 font-mono">
                        realm {conn.realmId}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    Connected {conn.connectedAt ? new Date(conn.connectedAt).toLocaleDateString() : "—"}
                    {conn.lastSyncAt &&
                      ` · Last synced ${new Date(conn.lastSyncAt).toLocaleString()}`}
                  </p>
                </div>
                <button
                  onClick={disconnect}
                  disabled={busy}
                  className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  Disconnect
                </button>
              </div>
            </Card>

            {/* Chart of Accounts mapping */}
            <Card>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">
                    Chart of Accounts mapping
                  </h3>
                  <p className="text-xs text-gray-500">
                    Pick which QBO account each POS bucket posts to. Save
                    before you push a sync.
                  </p>
                </div>
                <Button onClick={saveMapping} loading={busy}>
                  Save Mapping
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {MAPPING_LABELS.map((f) => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-gray-700">
                      {f.label}
                    </label>
                    <p className="text-xs text-gray-500 mb-1">{f.hint}</p>
                    <select
                      value={mapping[f.key as string] || ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [f.key]: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-sm"
                    >
                      <option value="">— Not mapped —</option>
                      {data?.accounts.map((a) => (
                        <option key={a.Id} value={a.Id}>
                          {a.Name}
                          {a.AccountType ? ` · ${a.AccountType}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {(data?.accounts.length || 0) === 0 && (
                <p className="mt-3 text-xs text-amber-700">
                  Couldn't load your QBO chart of accounts. Try again after a
                  moment — the token may need a refresh.
                </p>
              )}
            </Card>

            {/* Sync */}
            <Card>
              <h3 className="font-semibold text-gray-900 mb-3">
                Push daily summary
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                Builds one JournalEntry per business date aggregating all paid
                orders. Dry-run shows the preview without touching QBO.
              </p>
              <div className="flex items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Business date
                  </label>
                  <input
                    type="date"
                    value={businessDate}
                    onChange={(e) => setBusinessDate(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-gray-200 text-sm"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => runSync(true)}
                  loading={busy}
                >
                  <Icon icon="solar:eye-linear" className="w-4 h-4 mr-1" />
                  Dry Run
                </Button>
                <Button onClick={() => runSync(false)} loading={busy}>
                  <Icon icon="solar:upload-linear" className="w-4 h-4 mr-1" />
                  Push to QBO
                </Button>
              </div>

              {preview && (
                <div className="mt-4 border border-gray-100 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 border-b border-gray-100">
                    Journal Entry Preview
                  </div>
                  {preview.warnings?.length > 0 && (
                    <div className="p-3 bg-amber-50 border-b border-amber-100">
                      {preview.warnings.map((w: string, i: number) => (
                        <p key={i} className="text-xs text-amber-800">
                          ⚠ {w}
                        </p>
                      ))}
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Memo</th>
                        <th className="text-center px-3 py-2 font-medium">Side</th>
                        <th className="text-right px-3 py-2 font-medium">Amount</th>
                        <th className="text-left px-3 py-2 font-medium">Account</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.lines?.map((l: any, i: number) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-gray-900">{l.memo}</td>
                          <td className="px-3 py-2 text-center text-xs">
                            <span
                              className={`inline-block px-2 py-0.5 rounded ${
                                l.side === "Debit"
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-purple-50 text-purple-700"
                              }`}
                            >
                              {l.side}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            ${(l.amountCents / 100).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                            {l.accountRef || (
                              <span className="text-red-600">Unmapped</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="card p-12 text-center text-gray-400">
      <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto mb-2" />
      Loading...
    </div>
  );
}
