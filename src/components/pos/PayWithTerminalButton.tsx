"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Terminal {
  id: string;
  name: string;
  provider: "UCI" | "UPA";
  uciLane?: string | null;
  uciEnvironment?: "CERT" | "PROD" | null;
  isDefault: boolean;
  status: string;
  locationId: string;
}

interface Bill {
  id: string;
  gpBillId: string;
  status: string;
  amount: number;
  currency: string;
}

interface PayWithTerminalButtonProps {
  tenantId: string;
  orderId?: string;       // if charging an existing order
  amount?: number;        // fallback when no orderId (e.g. ad-hoc charge)
  locationId: string;
  onPaid?: (bill: Bill) => void;
  onCancelled?: () => void;
  className?: string;
}

type FlowState = "idle" | "picking" | "sending" | "waiting" | "paid" | "cancelled" | "failed";

export default function PayWithTerminalButton({
  tenantId,
  orderId,
  amount,
  locationId,
  onPaid,
  onCancelled,
  className = "",
}: PayWithTerminalButtonProps) {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>("");
  const [state, setState] = useState<FlowState>("idle");
  const [bill, setBill] = useState<Bill | null>(null);
  const [dryRun, setDryRun] = useState(false);

  // Load UCI terminals for this location
  const loadTerminals = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/terminals`);
      const data = await res.json();
      const uciAtLocation: Terminal[] = (data.terminals || []).filter(
        (t: Terminal) => t.provider === "UCI" && t.locationId === locationId
      );
      setTerminals(uciAtLocation);
      // Auto-pick default or first
      const def = uciAtLocation.find((t) => t.isDefault) || uciAtLocation[0];
      if (def) setSelectedTerminalId(def.id);
    } catch {
      toast.error("Failed to load terminals");
    }
  }, [tenantId, locationId]);

  useEffect(() => {
    loadTerminals();
  }, [loadTerminals]);

  // Poll bill status while waiting
  useEffect(() => {
    if (state !== "waiting" || !bill) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/tenants/${tenantId}/payments/uci/bill/${bill.id}`);
        const data = await res.json();
        if (data.bill) {
          const s = data.bill.status;
          if (s === "PAID") {
            setState("paid");
            onPaid?.(data.bill);
            toast.success("Payment completed on terminal!");
          } else if (s === "CANCELLED") {
            setState("cancelled");
            onCancelled?.();
            toast.info("Payment cancelled on terminal");
          } else if (s === "FAILED" || s === "EXPIRED") {
            setState("failed");
            toast.error(`Payment ${s.toLowerCase()}`);
          }
        }
      } catch {}
    }, 3000);
    return () => clearInterval(poll);
  }, [state, bill, tenantId, onPaid, onCancelled]);

  const sendBill = async () => {
    if (!selectedTerminalId) {
      toast.error("Please select a terminal");
      return;
    }
    setState("sending");
    try {
      // Provider-agnostic dispatcher. The server reads the tenant's active
      // CARD provider and forwards to the right route (GP -> /uci/bill,
      // Moneris -> /moneris/charge, etc.). Response shape passes through.
      const res = await fetch(`/api/tenants/${tenantId}/payments/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terminalId: selectedTerminalId,
          orderId,
          amount,
          tipEnabled: true,
          allowSplit: true,
          allowCash: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState("failed");
        toast.error(data.error || "Failed to send bill");
        return;
      }
      setBill(data.bill);
      setDryRun(data.dryRun);
      setState("waiting");
      if (data.dryRun) {
        toast.warning(
          "Dry-run mode — bill NOT sent to real terminal. Waiting for Global Payments Bill API spec.",
          { duration: 6000 }
        );
      } else {
        toast.success(`Sent to ${terminals.find((t) => t.id === selectedTerminalId)?.name}`);
      }
    } catch {
      setState("failed");
      toast.error("Failed to send bill");
    }
  };

  const cancelBill = async () => {
    if (!bill) return;
    try {
      await fetch(`/api/tenants/${tenantId}/payments/uci/bill/${bill.id}`, {
        method: "DELETE",
      });
      setState("cancelled");
      onCancelled?.();
      toast.info("Bill cancelled");
    } catch {
      toast.error("Failed to cancel");
    }
  };

  const reset = () => {
    setState("idle");
    setBill(null);
    setDryRun(false);
  };

  if (terminals.length === 0) {
    return (
      <div className={`p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 ${className}`}>
        <Icon icon="solar:info-circle-bold" className="w-4 h-4 inline mr-1.5" />
        No terminals registered at this location.{" "}
        <a href="/dashboard/admin/terminals" className="font-semibold underline">
          Add one →
        </a>
      </div>
    );
  }

  // Waiting state — big visual "waiting for customer to tap card"
  if (state === "waiting" && bill) {
    return (
      <div className={`p-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl text-white ${className}`}>
        <div className="flex items-center justify-center gap-3 mb-3">
          <Icon icon="solar:card-transfer-bold" className="w-8 h-8 animate-pulse" />
          <div>
            <p className="font-bold text-lg">Waiting for customer…</p>
            <p className="text-sm text-white/80">Please tap, insert, or swipe card on the terminal</p>
          </div>
        </div>
        {dryRun && (
          <div className="mt-3 p-2 rounded-lg bg-amber-400/20 border border-amber-300/30 text-amber-100 text-xs">
            <Icon icon="solar:info-circle-bold" className="w-3.5 h-3.5 inline mr-1" />
            <strong>Dry-run mode:</strong> Bill API spec pending from Global Payments. Cancel to continue.
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={cancelBill}
            className="flex-1 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-medium text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (state === "paid") {
    return (
      <div className={`p-6 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl text-white text-center ${className}`}>
        <Icon icon="solar:check-circle-bold" className="w-12 h-12 mx-auto mb-2" />
        <p className="font-bold text-lg">Payment Completed!</p>
        <button onClick={reset} className="mt-4 px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-medium">
          New Payment
        </button>
      </div>
    );
  }

  if (state === "cancelled" || state === "failed") {
    return (
      <div className={`p-4 bg-red-50 border border-red-200 rounded-xl ${className}`}>
        <p className="font-medium text-red-800">
          Payment {state === "cancelled" ? "cancelled" : "failed"}
        </p>
        <button onClick={reset} className="mt-2 text-sm font-semibold text-red-700 hover:underline">
          Try again
        </button>
      </div>
    );
  }

  // Idle — render the button + terminal picker
  return (
    <div className={`space-y-2 ${className}`}>
      {terminals.length > 1 && (
        <select
          value={selectedTerminalId}
          onChange={(e) => setSelectedTerminalId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {terminals.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.uciLane}) {t.isDefault ? "· default" : ""}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={sendBill}
        disabled={state === "sending" || !selectedTerminalId}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold text-sm shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {state === "sending" ? (
          <>
            <Icon icon="solar:refresh-bold" className="w-5 h-5 animate-spin" />
            Sending to terminal…
          </>
        ) : (
          <>
            <Icon icon="solar:card-transfer-bold" className="w-5 h-5" />
            Pay with Terminal
          </>
        )}
      </button>
    </div>
  );
}
