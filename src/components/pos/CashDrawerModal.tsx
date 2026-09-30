"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { Modal, Button } from "@/components/ui";
import { toast } from "sonner";

interface Movement {
  id: string;
  type: string;
  amount: number;
  reason?: string | null;
  createdAt: string;
}

interface OpenSession {
  id: string;
  openingFloat: number;
  openedAt: string;
  expectedCash: number;
  movements: Movement[];
  openedBy?: { firstName?: string; lastName?: string; email?: string } | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  locationId: string;
  currency: string;
  /** Called after any state change (open, movement, close) so caller can refresh. */
  onChanged?: () => void;
}

type Mode = "view" | "open" | "movement" | "close";

export default function CashDrawerModal({
  isOpen,
  onClose,
  tenantId,
  locationId,
  currency,
  onChanged,
}: Props) {
  const [session, setSession] = useState<OpenSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("view");

  const formatPrice = useCallback(
    (cents: number) =>
      new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
        (cents || 0) / 100
      ),
    [currency]
  );

  const load = useCallback(async () => {
    if (!tenantId || !locationId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/cash-drawer/current?locationId=${locationId}`
      );
      const data = await res.json();
      if (data.success) {
        setSession(data.session);
        setMode(data.session ? "view" : "open");
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Cash Drawer"
      subtitle={
        session
          ? `Open since ${new Date(session.openedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "No session open"
      }
    >
      {loading ? (
        <div className="py-12 text-center text-gray-400">
          <Icon
            icon="solar:refresh-linear"
            className="w-8 h-8 animate-spin mx-auto"
          />
        </div>
      ) : session && mode === "view" ? (
        <SessionOverview
          session={session}
          formatPrice={formatPrice}
          onOpenMovement={() => setMode("movement")}
          onOpenClose={() => setMode("close")}
        />
      ) : mode === "open" ? (
        <OpenForm
          tenantId={tenantId}
          locationId={locationId}
          currency={currency}
          onDone={() => {
            load();
            onChanged?.();
          }}
        />
      ) : mode === "movement" && session ? (
        <MovementForm
          tenantId={tenantId}
          sessionId={session.id}
          currency={currency}
          onDone={() => {
            load();
            onChanged?.();
            setMode("view");
          }}
          onCancel={() => setMode("view")}
        />
      ) : mode === "close" && session ? (
        <CloseForm
          tenantId={tenantId}
          session={session}
          currency={currency}
          formatPrice={formatPrice}
          onDone={() => {
            onChanged?.();
            onClose();
          }}
          onCancel={() => setMode("view")}
        />
      ) : null}
    </Modal>
  );
}

// ─── Views ──────────────────────────────────────────────────────────

function SessionOverview({
  session,
  formatPrice,
  onOpenMovement,
  onOpenClose,
}: {
  session: OpenSession;
  formatPrice: (c: number) => string;
  onOpenMovement: () => void;
  onOpenClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 text-white">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <p className="text-xs uppercase opacity-80">Expected in drawer</p>
            <p className="text-3xl font-bold">{formatPrice(session.expectedCash)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-80">Opening float</p>
            <p className="text-lg font-semibold">
              {formatPrice(session.openingFloat)}
            </p>
          </div>
        </div>
        <p className="text-xs opacity-80">
          Opened by{" "}
          {session.openedBy?.firstName
            ? `${session.openedBy.firstName} ${session.openedBy.lastName || ""}`
            : session.openedBy?.email || "cashier"}
        </p>
      </div>

      {/* Recent movements — just the last few, full ledger is in admin */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          Recent movements
        </h4>
        {session.movements.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Nothing recorded yet.</p>
        ) : (
          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {session.movements.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between p-2.5 text-sm"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {m.type.charAt(0) + m.type.slice(1).toLowerCase()}
                  </p>
                  {m.reason && (
                    <p className="text-xs text-gray-500 truncate">{m.reason}</p>
                  )}
                </div>
                <p
                  className={`font-semibold tabular-nums ${
                    m.amount >= 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {m.amount >= 0 ? "+" : ""}
                  {formatPrice(m.amount)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onOpenMovement} fullWidth>
          <Icon icon="solar:add-circle-linear" className="w-4 h-4 mr-2" />
          Add Movement
        </Button>
        <Button
          onClick={onOpenClose}
          fullWidth
          className="bg-red-600 hover:bg-red-700"
        >
          <Icon icon="solar:stop-circle-linear" className="w-4 h-4 mr-2" />
          Close Drawer
        </Button>
      </div>
    </div>
  );
}

// ─── Open form ──────────────────────────────────────────────────────

function OpenForm({
  tenantId,
  locationId,
  currency,
  onDone,
}: {
  tenantId: string;
  locationId: string;
  currency: string;
  onDone: () => void;
}) {
  const [floatStr, setFloatStr] = useState("100.00");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const cents = Math.round(parseFloat(floatStr || "0") * 100);
    if (cents < 0) {
      toast.error("Float can't be negative");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cash-drawer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, openingFloat: cents, note }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Drawer opened");
        onDone();
      } else {
        toast.error(data.error || "Failed to open drawer");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100 text-sm text-indigo-900">
        Count the physical cash in the drawer and enter it as the opening float.
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Opening float ({currency})
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={floatStr}
          onChange={(e) => setFloatStr(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Note (optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Morning shift float"
          className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
        />
      </div>
      <Button onClick={submit} loading={submitting} fullWidth size="lg">
        <Icon icon="solar:wallet-2-bold" className="w-5 h-5 mr-2" />
        Open Drawer
      </Button>
    </div>
  );
}

// ─── Movement form ──────────────────────────────────────────────────

function MovementForm({
  tenantId,
  sessionId,
  currency,
  onDone,
  onCancel,
}: {
  tenantId: string;
  sessionId: string;
  currency: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<"PAYOUT" | "PAYIN" | "DROP">("PAYOUT");
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const cents = Math.round(parseFloat(amountStr || "0") * 100);
    if (cents <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/cash-drawer/${sessionId}/movement`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, amount: cents, reason }),
        }
      );
      const data = await res.json();
      if (data.success) {
        toast.success("Recorded");
        onDone();
      } else {
        toast.error(data.error || "Failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Type
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "PAYIN", label: "Pay-in", icon: "solar:add-circle-bold", tone: "green" },
              { id: "PAYOUT", label: "Pay-out", icon: "solar:minus-circle-bold", tone: "red" },
              { id: "DROP", label: "Cash drop", icon: "solar:box-minimalistic-bold", tone: "red" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-colors ${
                type === t.id
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <Icon
                icon={t.icon}
                className={`w-5 h-5 ${
                  t.tone === "green" ? "text-green-600" : "text-red-600"
                }`}
              />
              <span className="text-sm font-medium text-gray-900">
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Amount ({currency})
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Reason
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            type === "PAYOUT"
              ? "e.g. Coffee run, staff meal"
              : type === "DROP"
                ? "e.g. To safe, bank deposit"
                : "e.g. Change from bank"
          }
          className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
        />
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" onClick={onCancel} fullWidth>
          Back
        </Button>
        <Button onClick={submit} loading={submitting} fullWidth>
          Record
        </Button>
      </div>
    </div>
  );
}

// ─── Close form ─────────────────────────────────────────────────────

function CloseForm({
  tenantId,
  session,
  currency,
  formatPrice,
  onDone,
  onCancel,
}: {
  tenantId: string;
  session: OpenSession;
  currency: string;
  formatPrice: (c: number) => string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [countStr, setCountStr] = useState(
    (session.expectedCash / 100).toFixed(2)
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cents = Math.round(parseFloat(countStr || "0") * 100);
  const variance = cents - session.expectedCash;

  const submit = async () => {
    if (cents < 0) {
      toast.error("Count can't be negative");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/cash-drawer/${session.id}/close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ closingCount: cents, note }),
        }
      );
      const data = await res.json();
      if (data.success) {
        toast.success(
          variance === 0
            ? "Drawer closed — reconciled"
            : `Drawer closed — ${variance > 0 ? "over" : "short"} by ${formatPrice(Math.abs(variance))}`
        );
        onDone();
      } else {
        toast.error(data.error || "Failed to close");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-600">Expected in drawer</span>
          <span className="text-lg font-bold text-gray-900">
            {formatPrice(session.expectedCash)}
          </span>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Counted cash ({currency})
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={countStr}
          onChange={(e) => setCountStr(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-lg font-semibold"
          autoFocus
        />
      </div>
      {countStr && (
        <div
          className={`p-4 rounded-xl border ${
            variance === 0
              ? "bg-gray-50 border-gray-200"
              : variance > 0
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
          }`}
        >
          <p className="text-xs uppercase text-gray-500">
            {variance === 0 ? "Reconciled" : variance > 0 ? "Over" : "Short"}
          </p>
          <p
            className={`text-2xl font-bold tabular-nums ${
              variance === 0
                ? "text-gray-700"
                : variance > 0
                  ? "text-green-700"
                  : "text-red-700"
            }`}
          >
            {variance >= 0 ? "+" : ""}
            {formatPrice(variance)}
          </p>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Note (optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. $2 short — likely miscount on $20 change"
          className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
        />
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" onClick={onCancel} fullWidth>
          Back
        </Button>
        <Button
          onClick={submit}
          loading={submitting}
          fullWidth
          className="bg-red-600 hover:bg-red-700"
        >
          Close Drawer
        </Button>
      </div>
    </div>
  );
}
