"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "@iconify/react";
import { Modal, Button } from "@/components/ui";
import { toast } from "sonner";

export interface AttachedCustomer {
  id: string;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  visitCount?: number;
  lifetimeSpend?: number;
  vipTier?: number;
}

interface SearchHit extends AttachedCustomer {
  lastVisitAt?: string | null;
  tags?: string[];
}

interface Order {
  id: string;
  displayNumber?: number;
  orderNumber?: string;
  total: number;
  currency: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
}

interface Loyalty {
  totalPoints: number;
  visitCount: number;
  currentStreak: number;
  program: { name: string };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  currency: string;
  onAttach: (customer: AttachedCustomer) => void;
}

type Mode = "search" | "create" | "detail";

export default function CustomerModal({
  isOpen,
  onClose,
  tenantId,
  currency,
  onAttach,
}: Props) {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AttachedCustomer | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search — 300ms is snappy enough for typeahead without
  // hammering the DB on every keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/tenants/${tenantId}/guest-profiles/search?q=${encodeURIComponent(query)}`
        );
        const data = await res.json();
        if (data.success) setResults(data.guests);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, tenantId]);

  const openDetail = useCallback(
    async (guest: SearchHit) => {
      setSelected(guest);
      setMode("detail");
      setLoadingDetail(true);
      try {
        const res = await fetch(
          `/api/tenants/${tenantId}/guest-profiles/${guest.id}`
        );
        const data = await res.json();
        if (data.success) {
          setRecentOrders(data.recentOrders || []);
          setLoyalty(data.loyalty || null);
        }
      } finally {
        setLoadingDetail(false);
      }
    },
    [tenantId]
  );

  const formatPrice = (cents: number, cur = currency) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: cur }).format(
      (cents || 0) / 100
    );

  const attach = (c: AttachedCustomer) => {
    onAttach(c);
    onClose();
    toast.success(`Customer attached: ${c.firstName}${c.lastName ? " " + c.lastName : ""}`);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={
        mode === "create"
          ? "New Customer"
          : mode === "detail"
            ? "Customer"
            : "Attach Customer"
      }
    >
      {mode === "create" ? (
        <CreateForm
          tenantId={tenantId}
          initialSearch={query}
          onCreated={(g) => attach(g)}
          onCancel={() => setMode("search")}
        />
      ) : mode === "detail" && selected ? (
        <DetailView
          customer={selected}
          orders={recentOrders}
          loyalty={loyalty}
          loading={loadingDetail}
          formatPrice={formatPrice}
          onBack={() => {
            setMode("search");
            setSelected(null);
          }}
          onAttach={() => attach(selected)}
        />
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Icon
              icon="solar:magnifer-linear"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
            />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search phone, email, or name..."
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
            {searching && (
              <Icon
                icon="solar:refresh-linear"
                className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin"
              />
            )}
          </div>

          {query.trim().length >= 2 && results.length === 0 && !searching ? (
            <div className="p-6 text-center text-gray-400 rounded-xl bg-gray-50 border border-gray-100">
              <Icon
                icon="solar:user-plus-bold"
                className="w-8 h-8 mx-auto mb-2 text-gray-300"
              />
              <p className="text-sm mb-3">No matching customer found</p>
              <Button onClick={() => setMode("create")} size="sm">
                <Icon icon="solar:add-circle-linear" className="w-4 h-4 mr-1" />
                Add "{query}" as new
              </Button>
            </div>
          ) : results.length > 0 ? (
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {results.map((g) => (
                <button
                  key={g.id}
                  onClick={() => openDetail(g)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-semibold flex-shrink-0">
                    {initials(g.firstName, g.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {g.firstName}
                      {g.lastName ? ` ${g.lastName}` : ""}
                      {(g.vipTier || 0) > 0 && (
                        <Icon
                          icon="solar:crown-bold"
                          className="w-3.5 h-3.5 text-amber-500 inline ml-1"
                        />
                      )}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {[g.phone, g.email].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-500 flex-shrink-0">
                    {(g.visitCount || 0) > 0 && (
                      <p>
                        {g.visitCount} visit{g.visitCount === 1 ? "" : "s"}
                      </p>
                    )}
                    {(g.lifetimeSpend || 0) > 0 && (
                      <p className="font-medium text-gray-700">
                        {formatPrice(g.lifetimeSpend || 0)}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-gray-400">
              <Icon
                icon="solar:user-linear"
                className="w-10 h-10 mx-auto mb-2 text-gray-300"
              />
              <p className="text-sm">
                Type at least 2 characters to search.
              </p>
            </div>
          )}

          <button
            onClick={() => setMode("create")}
            className="w-full text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center justify-center gap-1"
          >
            <Icon icon="solar:add-circle-linear" className="w-4 h-4" />
            Add new customer
          </button>
        </div>
      )}
    </Modal>
  );
}

// ─── Create ─────────────────────────────────────────────────────────

function CreateForm({
  tenantId,
  initialSearch,
  onCreated,
  onCancel,
}: {
  tenantId: string;
  initialSearch: string;
  onCreated: (g: AttachedCustomer) => void;
  onCancel: () => void;
}) {
  // Seed first/last/phone/email guessing from what the operator typed to
  // save a keystroke — email if it looks like one, phone if digits, else
  // treat as name.
  const seedIsEmail = /\S+@\S+/.test(initialSearch);
  const seedIsPhone = /^\+?[\d()\s.-]{5,}$/.test(initialSearch);
  const [firstName, setFirstName] = useState(
    seedIsEmail || seedIsPhone ? "" : initialSearch
  );
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState(seedIsPhone ? initialSearch : "");
  const [email, setEmail] = useState(seedIsEmail ? initialSearch : "");
  const [optInMarketing, setOptInMarketing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!firstName.trim()) {
      toast.error("First name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/guest-profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          optInMarketing,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.existed) toast.info("Existing customer matched");
        onCreated(data.guest);
      } else {
        toast.error(data.error || "Failed to create");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            First name *
          </label>
          <input
            autoFocus
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Last name
          </label>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Phone
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 555 5555"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={optInMarketing}
          onChange={(e) => setOptInMarketing(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300"
        />
        Opt in to marketing emails / SMS
      </label>

      <div className="flex gap-3 pt-2">
        <Button variant="secondary" onClick={onCancel} fullWidth>
          Back
        </Button>
        <Button onClick={submit} loading={submitting} fullWidth>
          Create &amp; Attach
        </Button>
      </div>
    </div>
  );
}

// ─── Detail ─────────────────────────────────────────────────────────

function DetailView({
  customer,
  orders,
  loyalty,
  loading,
  formatPrice,
  onBack,
  onAttach,
}: {
  customer: AttachedCustomer;
  orders: Order[];
  loyalty: Loyalty | null;
  loading: boolean;
  formatPrice: (c: number, cur?: string) => string;
  onBack: () => void;
  onAttach: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-lg">
          {initials(customer.firstName, customer.lastName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-lg">
            {customer.firstName}
            {customer.lastName ? ` ${customer.lastName}` : ""}
          </p>
          <p className="text-sm text-gray-500 truncate">
            {[customer.phone, customer.email].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <StatTile
          label="Visits"
          value={String(customer.visitCount || 0)}
          icon="solar:calendar-mark-bold"
        />
        <StatTile
          label="Lifetime spend"
          value={formatPrice(customer.lifetimeSpend || 0)}
          icon="solar:wallet-money-bold"
        />
        <StatTile
          label="Points"
          value={loyalty ? String(loyalty.totalPoints) : "—"}
          icon="solar:medal-star-bold"
        />
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          Recent orders
        </h4>
        {loading ? (
          <div className="p-4 text-center text-gray-400 text-sm">
            <Icon
              icon="solar:refresh-linear"
              className="w-5 h-5 animate-spin mx-auto"
            />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No previous orders.</p>
        ) : (
          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
            {orders.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between p-2.5 text-sm"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    Order #{o.displayNumber || o.orderNumber}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(o.createdAt).toLocaleDateString()} ·{" "}
                    {o.paymentStatus.toLowerCase()}
                  </p>
                </div>
                <p className="font-semibold text-gray-900">
                  {formatPrice(o.total, o.currency)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onBack} fullWidth>
          Back
        </Button>
        <Button onClick={onAttach} fullWidth>
          Attach to Order
        </Button>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
      <Icon icon={icon} className="w-4 h-4 text-gray-400 mx-auto mb-1" />
      <p className="text-lg font-bold text-gray-900 tabular-nums">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function initials(first: string, last?: string | null) {
  const f = first?.[0] || "?";
  const l = last?.[0] || "";
  return (f + l).toUpperCase();
}
