"use client";

// Detailed statement for one merchant — Phase D #75.
//
// Shows every open PO with its due date, days-overdue, outstanding
// amount, and aging bucket. The "Email Statement" button sends the same
// data as a formatted email to the merchant's owner (or an override
// address the supplier types in).

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface AgingBreakdown {
  notYetDue: number;
  "1_30": number;
  "31_60": number;
  "61_90": number;
  over_90: number;
}
interface StatementLine {
  poId: string;
  poNumber: string;
  submittedAt: string;
  dueDate: string;
  daysOverdue: number;
  bucket: string;
  totalCents: number;
  paidAmountCents: number;
  outstandingCents: number;
  status: string;
  paymentStatus: string;
  currency: string;
}
interface Statement {
  merchantTenantId: string;
  merchantName: string;
  merchantEmail: string | null;
  supplierName: string;
  netTermsDays: number;
  currency: string;
  asOf: string;
  lines: StatementLine[];
  aging: AgingBreakdown;
  totalOutstandingCents: number;
}

const fmtMoney = (c: number, currency: string) =>
  `${currency} ${(c / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

const BUCKET_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  notYetDue: { bg: "bg-emerald-100", text: "text-emerald-800", label: "Not yet due" },
  "1_30":    { bg: "bg-amber-100",   text: "text-amber-900",   label: "1–30 days" },
  "31_60":   { bg: "bg-orange-100",  text: "text-orange-900",  label: "31–60 days" },
  "61_90":   { bg: "bg-red-100",     text: "text-red-800",     label: "61–90 days" },
  over_90:   { bg: "bg-rose-100",    text: "text-rose-800",    label: "90+ days" },
};

export default function StatementDetailPage({
  params,
}: {
  params: Promise<{ merchantTenantId: string }>;
}) {
  const { merchantTenantId } = use(params);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendNote, setSendNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch(`/api/supplier/statements/${merchantTenantId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setStatement(data.statement);
          setSendTo(data.statement.merchantEmail || "");
        } else {
          toast.error(data.error || "Failed to load statement");
        }
      })
      .catch(() => toast.error("Failed to load statement"))
      .finally(() => setLoading(false));
  }, [merchantTenantId]);

  const sendStatement = async () => {
    if (!sendTo.trim()) {
      toast.error("Enter an email address");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(
        `/api/supplier/statements/${merchantTenantId}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: sendTo.trim(),
            note: sendNote.trim() || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Send failed");
        return;
      }
      toast.success(`Statement sent to ${data.sentTo}`);
      setSendOpen(false);
      setSendNote("");
    } catch {
      toast.error("Send failed");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-1/3" />
          <div className="h-32 bg-gray-100 rounded-2xl" />
          <div className="h-64 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (!statement) return null;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/supplier/statements" className="text-indigo-600 hover:underline">
          Statements
        </Link>
        <Icon icon="solar:alt-arrow-right-linear" className="w-3.5 h-3.5" />
        <span>{statement.merchantName}</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{statement.merchantName}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {statement.lines.length} open PO
            {statement.lines.length !== 1 ? "s" : ""} · Terms Net{" "}
            {statement.netTermsDays} · As of{" "}
            {new Date(statement.asOf).toLocaleString()}
          </p>
        </div>
        <button
          onClick={() => setSendOpen(true)}
          disabled={statement.totalOutstandingCents === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          <Icon icon="solar:letter-linear" className="w-5 h-5" />
          Email Statement
        </button>
      </div>

      {/* Totals + aging */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
        <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          Total outstanding
        </p>
        <p className="text-4xl font-bold text-gray-900 mb-4">
          {fmtMoney(statement.totalOutstandingCents, statement.currency)}
        </p>
        <div className="grid grid-cols-5 gap-2 pt-4 border-t border-gray-100">
          {(
            [
              ["notYetDue", "Not yet due"],
              ["1_30", "1–30 days"],
              ["31_60", "31–60 days"],
              ["61_90", "61–90 days"],
              ["over_90", "90+ days"],
            ] as [keyof AgingBreakdown, string][]
          ).map(([k, label]) => {
            const v = statement.aging[k];
            const s = BUCKET_STYLES[k];
            return (
              <div key={k} className="text-center">
                <p className="text-[11px] uppercase text-gray-500">{label}</p>
                <p className={`mt-1 font-semibold text-sm ${v > 0 ? s.text : "text-gray-400"}`}>
                  {fmtMoney(v, statement.currency)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
              <th className="p-3">PO #</th>
              <th className="p-3">Submitted</th>
              <th className="p-3">Due</th>
              <th className="p-3">Age</th>
              <th className="p-3 text-right">PO Total</th>
              <th className="p-3 text-right">Paid</th>
              <th className="p-3 text-right">Outstanding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {statement.lines.map((l) => {
              const s = BUCKET_STYLES[l.bucket];
              return (
                <tr key={l.poId} className="hover:bg-gray-50">
                  <td className="p-3">
                    <Link
                      href={`/supplier/orders/${l.poId}`}
                      className="font-mono font-semibold text-indigo-600 hover:underline"
                    >
                      {l.poNumber}
                    </Link>
                  </td>
                  <td className="p-3 text-gray-600">{fmtDate(l.submittedAt)}</td>
                  <td className="p-3 text-gray-600">{fmtDate(l.dueDate)}</td>
                  <td className="p-3">
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}
                    >
                      {l.daysOverdue > 0 ? `${l.daysOverdue}d late` : s.label}
                    </span>
                  </td>
                  <td className="p-3 text-right text-gray-700">
                    {fmtMoney(l.totalCents, l.currency)}
                  </td>
                  <td className="p-3 text-right text-gray-500">
                    {l.paidAmountCents > 0
                      ? fmtMoney(l.paidAmountCents, l.currency)
                      : "—"}
                  </td>
                  <td className="p-3 text-right font-semibold text-gray-900">
                    {fmtMoney(l.outstandingCents, l.currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Send modal */}
      {sendOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setSendOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              Email Statement
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  To
                </label>
                <input
                  type="email"
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                  placeholder={statement.merchantEmail || "customer@example.com"}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {statement.merchantEmail
                    ? "Defaults to the merchant's owner email — override for AP contact."
                    : "No merchant email on file. Enter one to send."}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Note (optional)
                </label>
                <textarea
                  value={sendNote}
                  onChange={(e) => setSendNote(e.target.value)}
                  rows={3}
                  placeholder="e.g. Please arrange payment by end of month."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={() => setSendOpen(false)}
                className="px-4 py-2 rounded-xl text-gray-700 border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={sendStatement}
                disabled={sending}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send Statement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
