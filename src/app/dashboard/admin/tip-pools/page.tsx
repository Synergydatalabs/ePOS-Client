"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Modal } from "@/components/ui";
import { StatCard } from "@/components/ui/Card";
import { toast } from "sonner";

interface Pool {
  id: string;
  status: "OPEN" | "DISTRIBUTED" | "CLOSED";
  rule: "BY_HOURS" | "EVENLY" | "BY_ROLE";
  periodStart: string;
  periodEnd: string;
  tipsCollected: number;
  location?: { name: string };
  createdBy?: { firstName?: string; lastName?: string; email?: string };
  createdAt: string;
  _count: { distributions: number };
}

const STATUS_STYLES: Record<Pool["status"], string> = {
  OPEN: "bg-amber-50 text-amber-700 border-amber-200",
  DISTRIBUTED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  CLOSED: "bg-gray-50 text-gray-600 border-gray-200",
};

const RULE_LABELS: Record<Pool["rule"], string> = {
  BY_HOURS: "By Hours",
  EVENLY: "Evenly",
  BY_ROLE: "By Role",
};

export default function TipPoolsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const formatPrice = useCallback(
    (cents: number) =>
      new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
        (cents || 0) / 100
      ),
    [currency]
  );

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [pRes, lRes, sRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/tip-pools`),
        fetch(`/api/tenants/${tenantId}/locations`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);
      const [pData, lData, sData] = await Promise.all([
        pRes.json(),
        lRes.json(),
        sRes.json(),
      ]);
      if (pData.success) setPools(pData.pools);
      if (lData.success) setLocations(lData.locations || []);
      if (sData.success) setCurrency(sData.tenant?.currency || "CAD");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const openPool = pools.filter((p) => p.status === "OPEN").length;
  const totalPooled = pools.reduce((s, p) => s + p.tipsCollected, 0);

  return (
    <div>
      <AdminHeader
        title="Tip Pools"
        subtitle="Pool tips over a shift and redistribute to staff by hours, evenly, or by role"
      />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Open Drafts"
            value={loading ? "-" : openPool}
            icon="solar:document-add-bold"
            iconColor="text-amber-600"
          />
          <StatCard
            title="Pools (window)"
            value={loading ? "-" : pools.length}
            icon="solar:layers-bold"
            iconColor="text-indigo-600"
          />
          <StatCard
            title="Total Pooled"
            value={loading ? "-" : formatPrice(totalPooled)}
            icon="solar:wallet-money-bold"
            iconColor="text-green-600"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Icon icon="solar:add-circle-bold" className="w-4 h-4 mr-2" />
            New Pool
          </Button>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400">
              <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto mb-2" />
              Loading...
            </div>
          ) : pools.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Icon icon="solar:layers-bold" className="w-12 h-12 mx-auto mb-3" />
              <p className="font-medium mb-1 text-gray-600">No tip pools yet</p>
              <p className="text-sm">
                Create a pool for a shift period — tips are auto-collected from paid orders.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Period</th>
                    <th className="text-left px-4 py-3 font-medium">Location</th>
                    <th className="text-left px-4 py-3 font-medium">Rule</th>
                    <th className="text-right px-4 py-3 font-medium">Pooled</th>
                    <th className="text-right px-4 py-3 font-medium">Staff</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pools.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="text-gray-900 font-medium">
                          {new Date(p.periodStart).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(p.periodStart).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {" – "}
                          {new Date(p.periodEnd).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {p.location?.name || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {RULE_LABELS[p.rule]}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                        {formatPrice(p.tipsCollected)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {p._count.distributions}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full border ${STATUS_STYLES[p.status]}`}>
                          {p.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        <Link href={`/dashboard/admin/tip-pools/${p.id}`}>
                          <Icon icon="solar:alt-arrow-right-linear" className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {creating && tenantId && (
        <CreatePoolModal
          tenantId={tenantId}
          locations={locations}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            load();
            window.location.href = `/dashboard/admin/tip-pools/${id}`;
          }}
        />
      )}
    </div>
  );
}

function CreatePoolModal({
  tenantId,
  locations,
  onClose,
  onCreated,
}: {
  tenantId: string;
  locations: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  // Default period = today's shift (opens 6 AM, closes now) — usually the
  // right window when the manager runs this at end-of-shift.
  const now = new Date();
  const start = new Date(now);
  start.setHours(6, 0, 0, 0);
  const toLocal = (d: Date) => {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };
  const [locationId, setLocationId] = useState(locations[0]?.id || "");
  const [periodStart, setPeriodStart] = useState(toLocal(start));
  const [periodEnd, setPeriodEnd] = useState(toLocal(now));
  const [rule, setRule] = useState<"BY_HOURS" | "EVENLY" | "BY_ROLE">("BY_HOURS");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!locationId) {
      toast.error("Pick a location");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/tip-pools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          periodStart: new Date(periodStart).toISOString(),
          periodEnd: new Date(periodEnd).toISOString(),
          rule,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Pool created — review shares before closing");
        onCreated(data.pool.id);
      } else {
        toast.error(data.error || "Create failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} size="md" title="New Tip Pool">
      <div className="space-y-4">
        {locations.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Period start
            </label>
            <input
              type="datetime-local"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Period end
            </label>
            <input
              type="datetime-local"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Distribution rule
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: "BY_HOURS", label: "By Hours", icon: "solar:clock-circle-bold" },
                { id: "EVENLY", label: "Evenly", icon: "solar:equal-bold" },
                { id: "BY_ROLE", label: "By Role", icon: "solar:users-group-rounded-bold" },
              ] as const
            ).map((r) => (
              <button
                key={r.id}
                onClick={() => setRule(r.id)}
                className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-colors ${
                  rule === r.id
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Icon
                  icon={r.icon}
                  className={`w-5 h-5 ${rule === r.id ? "text-indigo-600" : "text-gray-400"}`}
                />
                <span className="text-xs font-medium text-gray-900">{r.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} fullWidth>
            Create Pool
          </Button>
        </div>
      </div>
    </Modal>
  );
}
