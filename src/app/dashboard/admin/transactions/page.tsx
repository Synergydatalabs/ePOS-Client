"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Transaction {
  id: string;
  command: string;
  transactionType: string | null;
  amount: number | null;
  tipAmount: number | null;
  result: string | null;
  status: string;
  cardType: string | null;
  maskedPan: string | null;
  entryMode: string | null;
  referenceNumber: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: string;
  respondedAt: string | null;
  terminal: { name: string; location: { name: string } };
  // Wired in by /api/.../terminals/[terminalId] so the row can drive the
  // inline Void / Refund buttons.
  orderId?: string | null;
  paymentId?: string | null;
  transactionId?: string | null;
  authCode?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: "bg-green-50 text-green-700",
  FAILED: "bg-red-50 text-red-700",
  SENT: "bg-blue-50 text-blue-700",
  TIMEOUT: "bg-amber-50 text-amber-700",
  CANCELLED: "bg-gray-50 text-gray-700",
};

const ENTRY_MODE_LABELS: Record<string, string> = {
  Chip: "Chip",
  NFC: "NFC Tap",
  Contactless: "Contactless",
  Swipe: "Swipe",
  Manual: "Manual",
};

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  // Track which row is mid-action so we can disable both buttons + show a
  // spinner without blocking the whole table.
  const [actingId, setActingId] = useState<string | null>(null);

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("tenantId") || ""
    : "";

  const fetchTransactions = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/terminals`);
      const data = await res.json();
      if (!data.terminals) return;

      // Fetch transactions from each terminal
      const allTx: Transaction[] = [];
      for (const t of data.terminals) {
        const tRes = await fetch(`/api/tenants/${tenantId}/terminals/${t.id}`);
        const tData = await tRes.json();
        if (tData.terminal?.transactions) {
          allTx.push(
            ...tData.terminal.transactions.map((tx: Record<string, unknown>) => ({
              ...tx,
              terminal: { name: t.name, location: t.location },
            }))
          );
        }
      }

      allTx.sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
      );
      setTransactions(allTx);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const formatCents = (cents: number | null) => {
    if (cents === null || cents === undefined) return "—";
    return `$${(cents / 100).toFixed(2)}`;
  };

  // A row is only voidable / refundable when:
  //   - it succeeded
  //   - it's a sale-shaped action (AUTHORIZE / SALE)
  //   - we know the orderId + paymentId so the endpoint can scope correctly
  const isActionable = (tx: Transaction) => {
    if (tx.status !== "SUCCESS") return false;
    if (!tx.orderId || !tx.paymentId) return false;
    const t = (tx.transactionType || tx.command || "").toUpperCase();
    return t === "AUTHORIZE" || t === "SALE";
  };

  const handleVoid = async (tx: Transaction) => {
    if (!tenantId || !tx.orderId || !tx.paymentId) return;
    if (
      !confirm(
        `Void this ${formatCents(tx.amount)} ${tx.cardType || "card"} payment? This sends REVERSE to the terminal and cancels the sale.`
      )
    ) {
      return;
    }
    setActingId(tx.id);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/orders/${tx.orderId}/payment/void`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId: tx.paymentId,
            reason: "Admin void from Transactions list",
          }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("Payment voided");
        await fetchTransactions();
      } else {
        toast.error(data.error || "Void failed");
      }
    } catch {
      toast.error("Void request failed");
    } finally {
      setActingId(null);
    }
  };

  const handleRefund = async (tx: Transaction) => {
    if (!tenantId || !tx.orderId || !tx.paymentId) return;
    if (tx.amount === null) {
      toast.error("Transaction amount is missing — cannot refund");
      return;
    }
    const max = (tx.amount / 100).toFixed(2);
    const input = prompt(
      `Refund amount in dollars (max $${max}). Leave blank to refund full $${max}.`,
      max
    );
    if (input === null) return;
    const dollars = input.trim() === "" ? Number(max) : Number(input);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Invalid refund amount");
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents > tx.amount) {
      toast.error(`Refund exceeds original payment of $${max}`);
      return;
    }
    setActingId(tx.id);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/orders/${tx.orderId}/payment/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId: tx.paymentId,
            amount: cents,
            reason: "Admin refund from Transactions list",
          }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Refunded $${(cents / 100).toFixed(2)}`);
        await fetchTransactions();
      } else {
        toast.error(data.error || "Refund failed");
      }
    } catch {
      toast.error("Refund request failed");
    } finally {
      setActingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon icon="solar:refresh-bold" className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Terminal Transactions</h1>
        <p className="text-gray-500 mt-1">Recent payment terminal transaction history</p>
      </div>

      {transactions.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <Icon icon="solar:history-bold" className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900">No transactions yet</h3>
          <p className="text-gray-500">Terminal transactions will appear here after processing payments.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Card</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Entry</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Terminal</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Ref #</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3 text-sm text-gray-900">
                      {new Date(tx.sentAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-sm font-medium text-gray-900">
                      {tx.transactionType || tx.command}
                    </td>
                    <td className="px-6 py-3 text-sm font-semibold text-gray-900">
                      {formatCents(tx.amount)}
                      {tx.tipAmount ? (
                        <span className="text-xs text-gray-500 ml-1">
                          +{formatCents(tx.tipAmount)} tip
                        </span>
                      ) : null}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-700">
                      {tx.cardType && tx.maskedPan
                        ? `${tx.cardType} ${tx.maskedPan}`
                        : "—"}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-700">
                      {tx.entryMode
                        ? ENTRY_MODE_LABELS[tx.entryMode] || tx.entryMode
                        : "—"}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-700">
                      {tx.terminal?.name}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_COLORS[tx.status] || "bg-gray-50 text-gray-700"
                        }`}
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs font-mono text-gray-500">
                      {tx.referenceNumber || "—"}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {isActionable(tx) ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleVoid(tx)}
                            disabled={actingId === tx.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 disabled:opacity-40"
                            title="Void this sale (REVERSE) before batch close"
                          >
                            {actingId === tx.id ? (
                              <Icon icon="solar:refresh-bold" className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Icon icon="solar:undo-left-bold" className="w-3.5 h-3.5" />
                            )}
                            Void
                          </button>
                          <button
                            onClick={() => handleRefund(tx)}
                            disabled={actingId === tx.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 text-xs font-medium hover:bg-rose-100 disabled:opacity-40"
                            title="Refund part or all of this sale"
                          >
                            <Icon icon="solar:card-recive-linear" className="w-3.5 h-3.5" />
                            Refund
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
