"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Card, Badge } from "@/components/ui";
import { toast } from "sonner";

interface Distribution {
  id: string;
  hoursWorked: string;
  role: string;
  weight: string;
  shareAmount: number;
  membership: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    role: string;
  };
}

interface EligibleMember {
  membershipId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role: string;
  hoursWorked: number;
}

interface Pool {
  id: string;
  status: "OPEN" | "DISTRIBUTED" | "CLOSED";
  rule: "BY_HOURS" | "EVENLY" | "BY_ROLE";
  periodStart: string;
  periodEnd: string;
  tipsCollected: number;
  roleWeights?: Record<string, number> | null;
  notes?: string | null;
  location?: { name: string };
  createdBy?: { firstName?: string; lastName?: string; email?: string };
  closedBy?: { firstName?: string; lastName?: string; email?: string };
  closedAt?: string | null;
  distributions: Distribution[];
}

const ROLE_OPTIONS = ["TENANT_OWNER", "POS_ADMIN", "POS_MANAGER", "POS_STAFF", "KITCHEN_STAFF"];

export default function TipPoolDetailPage({
  params,
}: {
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = use(params);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [pool, setPool] = useState<Pool | null>(null);
  const [eligible, setEligible] = useState<EligibleMember[]>([]);
  const [currency, setCurrency] = useState("CAD");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tipsEdit, setTipsEdit] = useState<string>("");
  const [roleWeights, setRoleWeights] = useState<Record<string, number>>({});

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/tip-pools/${poolId}`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);
      const [pData, sData] = await Promise.all([pRes.json(), sRes.json()]);
      if (pData.success) {
        setPool(pData.pool);
        setEligible(pData.eligibleMembers || []);
        setTipsEdit((pData.pool.tipsCollected / 100).toFixed(2));
        setRoleWeights(
          pData.pool.roleWeights ||
            Object.fromEntries(ROLE_OPTIONS.map((r) => [r, r === "POS_STAFF" ? 100 : 0]))
        );
      }
      if (sData.success) setCurrency(sData.tenant?.currency || "CAD");
    } finally {
      setLoading(false);
    }
  }, [tenantId, poolId]);

  useEffect(() => {
    load();
  }, [load]);

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
      (cents || 0) / 100
    );

  const patch = async (body: any) => {
    if (!tenantId || !pool) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/tip-pools/${poolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Update failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const distribute = async () => {
    if (!tenantId) return;
    setBusy(true);
    try {
      // Save any pending role-weight / tips edits before distributing
      const patchBody: any = {};
      const editedTips = Math.round(parseFloat(tipsEdit || "0") * 100);
      if (pool && editedTips !== pool.tipsCollected) {
        patchBody.tipsCollected = editedTips;
      }
      if (pool?.rule === "BY_ROLE") {
        patchBody.roleWeights = roleWeights;
      }
      if (Object.keys(patchBody).length > 0) {
        await fetch(`/api/tenants/${tenantId}/tip-pools/${poolId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
      }

      const res = await fetch(
        `/api/tenants/${tenantId}/tip-pools/${poolId}/distribute`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Distributed to ${data.count} staff`);
        load();
      } else {
        toast.error(data.error || "Distribute failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!tenantId || !pool) return;
    if (!confirm("Close this pool? Distributions become read-only after this.")) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/tip-pools/${poolId}/close`,
        { method: "POST" }
      );
      if (res.ok) {
        toast.success("Pool closed");
        load();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Close failed");
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading || !pool) {
    return (
      <div>
        <AdminHeader title="Tip Pool" subtitle="Loading..." />
        <div className="p-12 text-center text-gray-400">
          <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  const isEditable = pool.status !== "CLOSED";
  const totalDistributed = pool.distributions.reduce((s, d) => s + d.shareAmount, 0);

  return (
    <div>
      <AdminHeader
        title="Tip Pool"
        subtitle={`${pool.location?.name || "Location"} · ${new Date(
          pool.periodStart
        ).toLocaleDateString()}`}
      />

      <div className="p-6 space-y-6">
        <Link
          href="/dashboard/admin/tip-pools"
          className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
        >
          <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
          Back to pools
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <div className="flex items-baseline justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                  Tips Collected
                </h3>
                <Badge variant={pool.status === "CLOSED" ? "default" : pool.status === "DISTRIBUTED" ? "info" : "warning"}>
                  {pool.status}
                </Badge>
              </div>
              {isEditable ? (
                <div className="flex items-baseline gap-3">
                  <span className="text-gray-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tipsEdit}
                    onChange={(e) => setTipsEdit(e.target.value)}
                    className="text-3xl font-bold text-gray-900 bg-transparent border-b border-gray-200 focus:border-indigo-500 outline-none w-40 tabular-nums"
                  />
                  <span className="text-xs text-gray-500">
                    Auto-collected from paid orders — override if needed
                  </span>
                </div>
              ) : (
                <p className="text-3xl font-bold text-gray-900">
                  {formatPrice(pool.tipsCollected)}
                </p>
              )}
            </Card>

            {pool.rule === "BY_ROLE" && isEditable && (
              <Card>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Role Weights
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  Weight is applied to hours worked. E.g. server 100, bar back 30 → server's
                  hour is worth 3.3× a bar back's hour.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ROLE_OPTIONS.map((r) => (
                    <div key={r} className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-gray-700 capitalize">
                        {r.toLowerCase().replace("_", " ")}
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={roleWeights[r] || 0}
                        onChange={(e) =>
                          setRoleWeights((prev) => ({
                            ...prev,
                            [r]: parseInt(e.target.value, 10) || 0,
                          }))
                        }
                        className="w-16 px-2 py-1 rounded border border-gray-200 text-right text-sm"
                      />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                {pool.status === "OPEN" ? "Eligible Staff (preview)" : "Distributions"}
              </h3>
              {pool.status === "OPEN" ? (
                eligible.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">
                    No clocked-in staff overlap this period.
                  </p>
                ) : (
                  <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
                    {eligible.map((m) => (
                      <div key={m.membershipId} className="flex items-center justify-between p-3 text-sm">
                        <div>
                          <p className="font-medium text-gray-900">
                            {m.firstName ? `${m.firstName} ${m.lastName || ""}` : m.email}
                          </p>
                          <p className="text-xs text-gray-500 capitalize">
                            {m.role.toLowerCase().replace("_", " ")}
                          </p>
                        </div>
                        <p className="text-gray-700 tabular-nums">
                          {m.hoursWorked.toFixed(2)}h
                        </p>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
                  {pool.distributions.map((d) => (
                    <div key={d.id} className="flex items-center justify-between p-3 text-sm">
                      <div>
                        <p className="font-medium text-gray-900">
                          {d.membership.firstName
                            ? `${d.membership.firstName} ${d.membership.lastName || ""}`
                            : d.membership.email}
                        </p>
                        <p className="text-xs text-gray-500 capitalize">
                          {d.role.toLowerCase().replace("_", " ")} ·{" "}
                          {Number(d.hoursWorked).toFixed(2)}h
                        </p>
                      </div>
                      <p className="text-lg font-bold text-gray-900 tabular-nums">
                        {formatPrice(d.shareAmount)}
                      </p>
                    </div>
                  ))}
                  {pool.distributions.length > 0 && (
                    <div className="flex items-center justify-between p-3 bg-gray-50 text-sm">
                      <span className="font-semibold text-gray-700">Total</span>
                      <span className="font-bold text-gray-900 tabular-nums">
                        {formatPrice(totalDistributed)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {isEditable && (
              <div className="flex gap-3">
                <Button
                  onClick={distribute}
                  loading={busy}
                  disabled={busy || eligible.length === 0}
                  fullWidth
                >
                  <Icon icon="solar:calculator-bold" className="w-4 h-4 mr-2" />
                  {pool.status === "OPEN" ? "Distribute" : "Recalculate"}
                </Button>
                {pool.status === "DISTRIBUTED" && (
                  <Button
                    onClick={close}
                    loading={busy}
                    fullWidth
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <Icon icon="solar:lock-keyhole-bold" className="w-4 h-4 mr-2" />
                    Close Pool
                  </Button>
                )}
              </div>
            )}
          </div>

          <div>
            <Card>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Details
              </h3>
              <div className="space-y-2 text-sm">
                <MetaRow label="Rule">
                  {pool.rule.replace("_", " ")}
                </MetaRow>
                <MetaRow label="Period">
                  {new Date(pool.periodStart).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </MetaRow>
                <MetaRow label="To">
                  {new Date(pool.periodEnd).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </MetaRow>
                {pool.createdBy && (
                  <MetaRow label="Created by">
                    {pool.createdBy.firstName || pool.createdBy.email}
                  </MetaRow>
                )}
                {pool.closedBy && (
                  <MetaRow label="Closed by">
                    {pool.closedBy.firstName || pool.closedBy.email}
                    {pool.closedAt && ` · ${new Date(pool.closedAt).toLocaleDateString()}`}
                  </MetaRow>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <div className="text-gray-900">{children}</div>
    </div>
  );
}
