"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { StatCard } from "@/components/ui/Card";
import { Button, Modal } from "@/components/ui";

interface GiftCard {
  id: string;
  code: string;
  type: "DIGITAL" | "PHYSICAL";
  status: "ACTIVE" | "REDEEMED" | "EXPIRED" | "CANCELLED";
  initialAmount: number;
  balance: number;
  currency: string;
  recipientName?: string | null;
  recipientEmail?: string | null;
  issuedAt: string;
  expiresAt?: string | null;
  issuedBy?: { firstName?: string; lastName?: string; email?: string } | null;
}

interface Transaction {
  id: string;
  type: "ISSUE" | "REDEEM" | "REFUND" | "ADJUSTMENT" | "CANCEL";
  amount: number;
  balanceAfter: number;
  notes?: string | null;
  createdAt: string;
  order?: { id: string; orderNumber: string; displayNumber: number } | null;
}

interface CardDetail extends GiftCard {
  transactions: Transaction[];
  senderName?: string | null;
  message?: string | null;
  cancelledAt?: string | null;
  cancelledReason?: string | null;
}

const STATUS_STYLES: Record<GiftCard["status"], string> = {
  ACTIVE: "bg-green-50 text-green-700 border-green-200",
  REDEEMED: "bg-gray-50 text-gray-700 border-gray-200",
  EXPIRED: "bg-amber-50 text-amber-700 border-amber-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

const TXN_ICONS: Record<Transaction["type"], { icon: string; color: string }> = {
  ISSUE: { icon: "solar:add-circle-bold", color: "text-green-600" },
  REDEEM: { icon: "solar:minus-circle-bold", color: "text-indigo-600" },
  REFUND: { icon: "solar:refresh-circle-bold", color: "text-blue-600" },
  ADJUSTMENT: { icon: "solar:pen-2-bold", color: "text-amber-600" },
  CANCEL: { icon: "solar:close-circle-bold", color: "text-red-600" },
};

export default function GiftCardsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState({ outstandingBalance: 0, activeCount: 0 });
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  const [issueOpen, setIssueOpen] = useState(false);
  const [detailCard, setDetailCard] = useState<CardDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const loadCards = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (typeFilter) qs.set("type", typeFilter);
      if (search) qs.set("search", search);

      const [cardsRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/gift-cards?${qs.toString()}`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);
      const [cardsData, settingsData] = await Promise.all([
        cardsRes.json(),
        settingsRes.json(),
      ]);
      if (cardsData.success) {
        setCards(cardsData.cards);
        setSummary(cardsData.summary);
        setTotalCount(cardsData.pagination?.total || 0);
      }
      if (settingsData.success) {
        setCurrency(settingsData.tenant?.currency || "CAD");
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId, search, statusFilter, typeFilter]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const openDetail = async (cardId: string) => {
    if (!tenantId) return;
    setDetailLoading(true);
    setDetailCard({ id: cardId } as CardDetail); // stub while loading
    try {
      const res = await fetch(`/api/tenants/${tenantId}/gift-cards/${cardId}`);
      const data = await res.json();
      if (data.success) setDetailCard(data.card);
    } finally {
      setDetailLoading(false);
    }
  };

  const cancelCard = async (cardId: string) => {
    if (!tenantId) return;
    const reason = window.prompt("Reason for cancelling this card?");
    if (reason === null) return;
    const res = await fetch(`/api/tenants/${tenantId}/gift-cards/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", reason }),
    });
    if (res.ok) {
      setDetailCard(null);
      loadCards();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to cancel card");
    }
  };

  return (
    <div>
      <AdminHeader
        title="Gift Cards"
        subtitle="Issue digital or physical stored-value cards and track balances"
      />

      <div className="p-6 space-y-6">
        {/* Summary tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Active Cards"
            value={loading ? "-" : summary.activeCount}
            icon="solar:gift-bold"
            iconColor="text-indigo-600"
          />
          <StatCard
            title="Outstanding Balance"
            value={loading ? "-" : formatPrice(summary.outstandingBalance)}
            icon="solar:wallet-money-bold"
            iconColor="text-green-600"
          />
          <StatCard
            title="Total Cards"
            value={loading ? "-" : totalCount}
            icon="solar:card-recive-bold"
            iconColor="text-teal-600"
          />
        </div>

        {/* Filter row + Issue button */}
        <div className="card p-4 flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Icon
              icon="solar:magnifer-linear"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code, email, or name..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="REDEEMED">Redeemed</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm"
          >
            <option value="">All types</option>
            <option value="DIGITAL">Digital</option>
            <option value="PHYSICAL">Physical</option>
          </select>
          <Button onClick={() => setIssueOpen(true)}>
            <Icon icon="solar:add-circle-bold" className="w-4 h-4 mr-2" />
            Issue Gift Card
          </Button>
        </div>

        {/* Cards table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400">
              <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto mb-2" />
              Loading...
            </div>
          ) : cards.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Icon icon="solar:gift-bold" className="w-12 h-12 mx-auto mb-3" />
              <p className="font-medium mb-1">No gift cards yet</p>
              <p className="text-sm">Issue your first card to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Code</th>
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-left px-4 py-3 font-medium">Recipient</th>
                    <th className="text-right px-4 py-3 font-medium">Initial</th>
                    <th className="text-right px-4 py-3 font-medium">Balance</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Issued</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cards.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => openDetail(c.id)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">{c.code}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs">
                          <Icon
                            icon={
                              c.type === "DIGITAL"
                                ? "solar:letter-bold"
                                : "solar:card-bold"
                            }
                            className="w-3.5 h-3.5"
                          />
                          {c.type === "DIGITAL" ? "Digital" : "Physical"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {c.recipientName || c.recipientEmail || (
                          <span className="text-gray-400 italic">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {formatPrice(c.initialAmount)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {formatPrice(c.balance)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded-full border ${STATUS_STYLES[c.status]}`}
                        >
                          {c.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(c.issuedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        <Icon icon="solar:alt-arrow-right-linear" className="w-4 h-4" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Issue modal */}
      {issueOpen && tenantId && (
        <IssueCardModal
          tenantId={tenantId}
          currency={currency}
          formatPrice={formatPrice}
          onClose={() => setIssueOpen(false)}
          onDone={() => {
            setIssueOpen(false);
            loadCards();
          }}
        />
      )}

      {/* Detail modal */}
      {detailCard && (
        <Modal
          isOpen={true}
          onClose={() => setDetailCard(null)}
          size="lg"
          title="Gift Card Detail"
        >
          {detailLoading || !detailCard.code ? (
            <div className="py-12 text-center text-gray-400">
              <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto" />
            </div>
          ) : (
            <CardDetailView
              card={detailCard}
              formatPrice={formatPrice}
              onCancel={() => cancelCard(detailCard.id)}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── Issue Modal ────────────────────────────────────────────────────

function IssueCardModal({
  tenantId,
  currency,
  formatPrice,
  onClose,
  onDone,
}: {
  tenantId: string;
  currency: string;
  formatPrice: (cents: number) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type, setType] = useState<"DIGITAL" | "PHYSICAL">("DIGITAL");
  const [amount, setAmount] = useState("25.00");
  const [quantity, setQuantity] = useState("1");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    count: number;
    cards: Array<{ code: string; balance: number; recipientEmail?: string }>;
  } | null>(null);

  const amountCents = Math.round(parseFloat(amount || "0") * 100);
  const totalCents = amountCents * (parseInt(quantity, 10) || 1);
  const canSubmit =
    amountCents >= 100 &&
    (type === "PHYSICAL" || recipientEmail.trim().length > 0) &&
    !submitting;

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/gift-cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          amount: amountCents,
          currency,
          quantity: type === "PHYSICAL" ? parseInt(quantity, 10) || 1 : 1,
          recipientName: recipientName || undefined,
          recipientEmail: recipientEmail || undefined,
          senderName: senderName || undefined,
          message: message || undefined,
          expiresAt: expiresAt || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ count: data.count, cards: data.cards });
      } else {
        alert(data.error || "Failed to issue card");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Success view — show the generated codes so the operator can hand them
  // out (physical) or verify the email got queued (digital).
  if (result) {
    return (
      <Modal isOpen={true} onClose={onDone} size="lg" title={`Issued ${result.count} card${result.count > 1 ? "s" : ""}`}>
        <div className="space-y-4">
          <div className="p-4 bg-green-50 rounded-xl flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <Icon icon="solar:check-circle-bold" className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-green-900">
                {result.count} card{result.count > 1 ? "s" : ""} issued
              </p>
              <p className="text-sm text-green-700">
                {type === "DIGITAL"
                  ? "Send the code to the recipient by email or SMS."
                  : "Codes below — print or write onto the physical cards."}
              </p>
            </div>
          </div>
          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {result.cards.map((c) => (
              <div
                key={c.code}
                className="flex items-center justify-between p-3 hover:bg-gray-50"
              >
                <div>
                  <p className="font-mono font-semibold text-gray-900">{c.code}</p>
                  {c.recipientEmail && (
                    <p className="text-xs text-gray-500">{c.recipientEmail}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-700">
                    {formatPrice(c.balance)}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(c.code)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                    title="Copy code"
                  >
                    <Icon icon="solar:copy-linear" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => window.print()}
              fullWidth
            >
              <Icon icon="solar:printer-bold" className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button onClick={onDone} fullWidth>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={true} onClose={onClose} size="lg" title="Issue Gift Card">
      <div className="space-y-4">
        {/* Type toggle */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Card Type
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: "DIGITAL", label: "Digital", desc: "Emailed to recipient", icon: "solar:letter-bold" },
              { id: "PHYSICAL", label: "Physical", desc: "Printed card(s)", icon: "solar:card-bold" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setType(t.id as "DIGITAL" | "PHYSICAL")}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  type === t.id
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Icon
                  icon={t.icon}
                  className={`w-6 h-6 mb-2 ${type === t.id ? "text-indigo-600" : "text-gray-400"}`}
                />
                <p className="font-semibold text-gray-900">{t.label}</p>
                <p className="text-xs text-gray-500">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount ({currency})
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
            <div className="flex gap-1 mt-2 text-xs">
              {[10, 25, 50, 100, 250].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(v.toFixed(2))}
                  className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                >
                  ${v}
                </button>
              ))}
            </div>
          </div>
          {type === "PHYSICAL" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity (batch)
              </label>
              <input
                type="number"
                min="1"
                max="500"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Total value: {formatPrice(totalCents)}
              </p>
            </div>
          )}
          {type === "DIGITAL" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expires (optional)
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
            </div>
          )}
        </div>

        {type === "DIGITAL" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Recipient Email *
                </label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="friend@example.com"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Recipient Name
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sender Name
              </label>
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="From: ..."
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Message (optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                placeholder="Happy birthday!"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none resize-none"
              />
            </div>
          </>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} loading={submitting} fullWidth>
            Issue{" "}
            {type === "PHYSICAL" && (parseInt(quantity, 10) || 1) > 1
              ? `${quantity} Cards`
              : "Card"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Detail View ────────────────────────────────────────────────────

function CardDetailView({
  card,
  formatPrice,
  onCancel,
}: {
  card: CardDetail;
  formatPrice: (cents: number) => string;
  onCancel: () => void;
}) {
  const pctLeft = card.initialAmount > 0
    ? Math.round((card.balance / card.initialAmount) * 100)
    : 0;

  return (
    <div className="space-y-5">
      <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
        <p className="text-xs uppercase opacity-80">Code</p>
        <p className="font-mono text-2xl font-bold tracking-wider">{card.code}</p>
        <div className="mt-4 flex items-baseline justify-between">
          <div>
            <p className="text-xs opacity-80">Balance</p>
            <p className="text-3xl font-bold">{formatPrice(card.balance)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-80">Initial</p>
            <p className="text-lg font-semibold">{formatPrice(card.initialAmount)}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-white/80" style={{ width: `${pctLeft}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <DetailRow label="Type">
          {card.type === "DIGITAL" ? "Digital" : "Physical"}
        </DetailRow>
        <DetailRow label="Status">
          <span
            className={`inline-block px-2 py-0.5 text-xs rounded-full border ${STATUS_STYLES[card.status]}`}
          >
            {card.status.toLowerCase()}
          </span>
        </DetailRow>
        <DetailRow label="Issued">
          {new Date(card.issuedAt).toLocaleString()}
        </DetailRow>
        <DetailRow label="Expires">
          {card.expiresAt ? new Date(card.expiresAt).toLocaleDateString() : "Never"}
        </DetailRow>
        {card.recipientName && (
          <DetailRow label="Recipient">{card.recipientName}</DetailRow>
        )}
        {card.recipientEmail && (
          <DetailRow label="Email">{card.recipientEmail}</DetailRow>
        )}
        {card.senderName && <DetailRow label="From">{card.senderName}</DetailRow>}
        {card.issuedBy && (
          <DetailRow label="Issued by">
            {card.issuedBy.firstName} {card.issuedBy.lastName} ({card.issuedBy.email})
          </DetailRow>
        )}
      </div>

      {card.message && (
        <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
          <p className="text-xs uppercase text-gray-500 mb-1">Message</p>
          <p className="text-sm text-gray-700 italic">"{card.message}"</p>
        </div>
      )}

      <div>
        <h4 className="font-semibold text-gray-900 mb-2">Transaction History</h4>
        <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-60 overflow-y-auto">
          {card.transactions.map((t) => {
            const meta = TXN_ICONS[t.type];
            return (
              <div key={t.id} className="flex items-center gap-3 p-3">
                <div className={`w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center ${meta.color}`}>
                  <Icon icon={meta.icon} className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {t.type.charAt(0) + t.type.slice(1).toLowerCase()}
                    {t.order && (
                      <span className="ml-1 text-xs text-gray-500">
                        · Order #{t.order.displayNumber || t.order.orderNumber}
                      </span>
                    )}
                  </p>
                  {t.notes && <p className="text-xs text-gray-500 truncate">{t.notes}</p>}
                  <p className="text-xs text-gray-400">
                    {new Date(t.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-semibold ${t.amount >= 0 ? "text-green-600" : "text-gray-900"}`}
                  >
                    {t.amount >= 0 ? "+" : ""}
                    {formatPrice(t.amount)}
                  </p>
                  <p className="text-xs text-gray-400">
                    → {formatPrice(t.balanceAfter)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {card.status === "ACTIVE" && (
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <button
            onClick={onCancel}
            className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
          >
            <Icon icon="solar:close-circle-linear" className="w-4 h-4" />
            Cancel Card
          </button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <div className="text-gray-900">{children}</div>
    </div>
  );
}
