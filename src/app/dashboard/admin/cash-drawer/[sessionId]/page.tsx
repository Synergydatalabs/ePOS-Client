"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { Card, Badge } from "@/components/ui";

interface Movement {
  id: string;
  type: string;
  amount: number;
  reason?: string | null;
  createdAt: string;
  order?: { id: string; displayNumber?: number; orderNumber?: string } | null;
  performedBy?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;
}

interface SessionDetail {
  id: string;
  status: "OPEN" | "CLOSED";
  openingFloat: number;
  openingNote?: string | null;
  closingCount?: number | null;
  expectedCash?: number | null;
  variance?: number | null;
  closingNote?: string | null;
  openedAt: string;
  closedAt?: string | null;
  location?: { name: string } | null;
  terminal?: { name: string } | null;
  openedBy?: { firstName?: string; lastName?: string; email?: string } | null;
  closedBy?: { firstName?: string; lastName?: string; email?: string } | null;
  movements: Movement[];
  totals: {
    total: number;
    in: number;
    out: number;
    byType: Record<string, number>;
  };
}

const MOVE_META: Record<
  string,
  { label: string; icon: string; tone: "in" | "out" | "neutral" }
> = {
  OPENING:  { label: "Opening float", icon: "solar:play-circle-bold", tone: "in" },
  PAYMENT:  { label: "Cash sale",     icon: "solar:cart-check-bold",  tone: "in" },
  PAYIN:    { label: "Pay-in",        icon: "solar:add-circle-bold",  tone: "in" },
  REFUND:   { label: "Refund",        icon: "solar:refresh-circle-bold", tone: "out" },
  PAYOUT:   { label: "Pay-out",       icon: "solar:minus-circle-bold", tone: "out" },
  DROP:     { label: "Cash drop",     icon: "solar:box-minimalistic-bold", tone: "out" },
  CLOSING:  { label: "Close adjustment", icon: "solar:pen-2-bold", tone: "neutral" },
};

export default function CashDrawerDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [currency, setCurrency] = useState("CAD");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [sessRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/cash-drawer/${sessionId}`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);
      const [sessData, settingsData] = await Promise.all([
        sessRes.json(),
        settingsRes.json(),
      ]);
      if (sessData.success) setSession(sessData.session);
      if (settingsData.success) setCurrency(settingsData.tenant?.currency || "CAD");
    } finally {
      setLoading(false);
    }
  }, [tenantId, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
      (cents || 0) / 100
    );

  if (loading || !session) {
    return (
      <div>
        <AdminHeader title="Cash Drawer" subtitle="Loading..." />
        <div className="p-12 text-center text-gray-400">
          <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title={`Session · ${new Date(session.openedAt).toLocaleString()}`}
        subtitle={`${session.location?.name || "Location"}${session.terminal?.name ? " · " + session.terminal.name : ""}`}
      />

      <div className="p-6 space-y-6">
        <Link
          href="/dashboard/admin/cash-drawer"
          className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
        >
          <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
          Back to sessions
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: overview */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                Summary
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryItem
                  label="Opening float"
                  value={formatPrice(session.openingFloat)}
                />
                <SummaryItem
                  label="Cash in"
                  value={formatPrice(session.totals.in)}
                  tone="green"
                />
                <SummaryItem
                  label="Cash out"
                  value={formatPrice(session.totals.out)}
                  tone="red"
                />
                <SummaryItem
                  label={session.status === "CLOSED" ? "Counted" : "Expected"}
                  value={formatPrice(
                    session.status === "CLOSED"
                      ? session.closingCount || 0
                      : session.totals.total
                  )}
                  tone="indigo"
                />
              </div>

              {session.status === "CLOSED" && session.variance != null && (
                <div
                  className={`mt-4 p-4 rounded-xl border ${
                    session.variance === 0
                      ? "bg-gray-50 border-gray-200"
                      : session.variance > 0
                        ? "bg-green-50 border-green-200"
                        : "bg-red-50 border-red-200"
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        {session.variance === 0
                          ? "Reconciled"
                          : session.variance > 0
                            ? "Over"
                            : "Short"}
                      </p>
                      <p className="text-xs text-gray-500">
                        Counted {formatPrice(session.closingCount || 0)} vs
                        expected {formatPrice(session.expectedCash || 0)}
                      </p>
                    </div>
                    <p
                      className={`text-2xl font-bold ${
                        session.variance === 0
                          ? "text-gray-700"
                          : session.variance > 0
                            ? "text-green-700"
                            : "text-red-700"
                      }`}
                    >
                      {session.variance >= 0 ? "+" : ""}
                      {formatPrice(session.variance)}
                    </p>
                  </div>
                  {session.closingNote && (
                    <p className="text-xs text-gray-600 mt-2 italic">
                      "{session.closingNote}"
                    </p>
                  )}
                </div>
              )}
            </Card>

            {/* Movements ledger */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Movements ({session.movements.length})
              </h3>
              <div className="divide-y divide-gray-100">
                {session.movements.map((m) => {
                  const meta = MOVE_META[m.type] || {
                    label: m.type,
                    icon: "solar:banknote-bold",
                    tone: "neutral" as const,
                  };
                  return (
                    <div
                      key={m.id}
                      className="flex items-start gap-3 py-3"
                    >
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          meta.tone === "in"
                            ? "bg-green-50 text-green-600"
                            : meta.tone === "out"
                              ? "bg-red-50 text-red-600"
                              : "bg-gray-50 text-gray-500"
                        }`}
                      >
                        <Icon icon={meta.icon} className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-medium text-gray-900">
                            {meta.label}
                            {m.order && (
                              <Link
                                href={`/dashboard/admin/orders/${m.order.id}`}
                                className="ml-2 text-xs text-indigo-600 hover:text-indigo-700"
                              >
                                Order #{m.order.displayNumber || m.order.orderNumber}
                              </Link>
                            )}
                          </p>
                          <p
                            className={`font-semibold tabular-nums ${
                              m.amount >= 0 ? "text-green-700" : "text-red-700"
                            }`}
                          >
                            {m.amount >= 0 ? "+" : ""}
                            {formatPrice(m.amount)}
                          </p>
                        </div>
                        <p className="text-xs text-gray-500">
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {m.performedBy?.firstName &&
                            ` · ${m.performedBy.firstName} ${m.performedBy.lastName || ""}`}
                        </p>
                        {m.reason && (
                          <p className="text-xs text-gray-500 truncate">
                            {m.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Right: session meta */}
          <div className="space-y-4">
            <Card>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Session
              </h3>
              <div className="space-y-3 text-sm">
                <MetaRow label="Status">
                  <Badge variant={session.status === "OPEN" ? "success" : "default"}>
                    {session.status}
                  </Badge>
                </MetaRow>
                <MetaRow label="Opened">
                  {new Date(session.openedAt).toLocaleString()}
                </MetaRow>
                <MetaRow label="Cashier">
                  {session.openedBy?.firstName
                    ? `${session.openedBy.firstName} ${session.openedBy.lastName || ""}`
                    : session.openedBy?.email || "—"}
                </MetaRow>
                {session.openingNote && (
                  <div>
                    <p className="text-xs uppercase text-gray-500 mb-1">
                      Opening note
                    </p>
                    <p className="text-gray-700 italic">"{session.openingNote}"</p>
                  </div>
                )}
                {session.closedAt && (
                  <>
                    <MetaRow label="Closed">
                      {new Date(session.closedAt).toLocaleString()}
                    </MetaRow>
                    <MetaRow label="Closed by">
                      {session.closedBy?.firstName
                        ? `${session.closedBy.firstName} ${session.closedBy.lastName || ""}`
                        : session.closedBy?.email || "—"}
                    </MetaRow>
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "red" | "indigo";
}) {
  const color =
    tone === "green"
      ? "text-green-700"
      : tone === "red"
        ? "text-red-700"
        : tone === "indigo"
          ? "text-indigo-700"
          : "text-gray-900";
  return (
    <div>
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <div className="text-gray-900">{children}</div>
    </div>
  );
}
