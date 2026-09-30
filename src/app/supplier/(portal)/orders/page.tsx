"use client";

// Supplier PO inbox. Replaces the Phase A placeholder.
//
// Shows every PO the supplier has received, filterable by status tab.
// Clicking a row opens the detail view (/supplier/orders/[orderId]) where
// the state transitions live.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface OrderRow {
  id: string;
  poNumber: string;
  status: "SUBMITTED" | "ACKNOWLEDGED" | "SHIPPED" | "DELIVERED" | "CANCELLED";
  currency: string;
  totalCents: number;
  submittedAt: string;
  acknowledgedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  expectedDeliveryAt: string | null;
  merchantTenant: { id: string; name: string };
  _count: { items: number };
  // Phase D #74: unread message badge — messages sent by MERCHANT
  // that this supplier hasn't read yet.
  unreadMessageCount?: number;
}

interface StatusCounts {
  SUBMITTED?: number;
  ACKNOWLEDGED?: number;
  SHIPPED?: number;
  DELIVERED?: number;
  CANCELLED?: number;
}

const STATUS_TABS: {
  key: "" | OrderRow["status"];
  label: string;
  countKey?: keyof StatusCounts;
}[] = [
  { key: "", label: "All" },
  { key: "SUBMITTED", label: "New", countKey: "SUBMITTED" },
  { key: "ACKNOWLEDGED", label: "Acknowledged", countKey: "ACKNOWLEDGED" },
  { key: "SHIPPED", label: "Shipped", countKey: "SHIPPED" },
  { key: "DELIVERED", label: "Delivered", countKey: "DELIVERED" },
  { key: "CANCELLED", label: "Cancelled", countKey: "CANCELLED" },
];

const STATUS_STYLES: Record<OrderRow["status"], { bg: string; text: string; label: string }> = {
  SUBMITTED:    { bg: "bg-blue-100",    text: "text-blue-800",    label: "New" },
  ACKNOWLEDGED: { bg: "bg-indigo-100",  text: "text-indigo-800",  label: "Acknowledged" },
  SHIPPED:      { bg: "bg-amber-100",   text: "text-amber-800",   label: "Shipped" },
  DELIVERED:    { bg: "bg-emerald-100", text: "text-emerald-800", label: "Delivered" },
  CANCELLED:    { bg: "bg-gray-200",    text: "text-gray-700",    label: "Cancelled" },
};

export default function SupplierOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [counts, setCounts] = useState<StatusCounts>({});
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<"" | OrderRow["status"]>("");
  const [searchQuery, setSearchQuery] = useState("");

  const load = () => {
    const params = new URLSearchParams();
    if (activeStatus) params.set("status", activeStatus);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    const query = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/supplier/orders${query}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setOrders(data.orders);
          setCounts(data.counts || {});
        } else {
          toast.error(data.error || "Failed to load orders");
        }
      })
      .catch(() => toast.error("Failed to load orders"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatus]);

  // Search debounces via a small timer — re-fetch 300ms after typing stops.
  // Cheap client-side pattern; a proper debounce hook would be overkill.
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const money = (cents: number, currency: string) =>
    `${currency} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Purchase Orders</h1>
        <p className="text-gray-500 mt-1">
          Orders your customers have sent you. Acknowledge, ship, and mark delivered from here.
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => {
          const count = tab.countKey ? counts[tab.countKey] || 0 : undefined;
          const active = activeStatus === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveStatus(tab.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors flex-shrink-0 ${
                active
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {tab.label}
              {count != null && (
                <span
                  className={`text-xs px-1.5 py-0 rounded-full ${
                    active ? "bg-white/20" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="mb-5">
        <div className="relative max-w-md">
          <Icon
            icon="solar:magnifer-linear"
            className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            type="text"
            placeholder="Search by PO number…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <Icon
            icon="solar:clipboard-list-linear"
            className="w-16 h-16 text-gray-300 mx-auto mb-4"
          />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            {activeStatus || searchQuery
              ? "No orders match your filters"
              : "No orders yet"}
          </h2>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            {activeStatus || searchQuery
              ? "Try clearing the filter or the search query."
              : "When a merchant places a purchase order, it'll land here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const style = STATUS_STYLES[o.status];
            return (
              <Link
                key={o.id}
                href={`/supplier/orders/${o.id}`}
                className="block bg-white rounded-2xl border border-gray-200 p-5 hover:border-indigo-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono font-semibold text-gray-900">
                        {o.poNumber}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.bg} ${style.text}`}
                      >
                        {style.label}
                      </span>
                      {(o.unreadMessageCount ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-rose-100 text-rose-800">
                          <Icon icon="solar:chat-round-linear" className="w-3 h-3" />
                          {o.unreadMessageCount} new
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700">
                      From <span className="font-medium">{o.merchantTenant.name}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>
                        {o._count.items} item{o._count.items !== 1 ? "s" : ""}
                      </span>
                      <span>
                        Submitted {new Date(o.submittedAt).toLocaleDateString()}
                      </span>
                      {o.expectedDeliveryAt && o.status === "SHIPPED" && (
                        <span className="text-amber-700 font-medium">
                          ETA {new Date(o.expectedDeliveryAt).toLocaleDateString()}
                        </span>
                      )}
                      {o.deliveredAt && (
                        <span className="text-emerald-700 font-medium">
                          Delivered {new Date(o.deliveredAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-gray-900">
                      {money(o.totalCents, o.currency)}
                    </p>
                    <Icon
                      icon="solar:alt-arrow-right-linear"
                      className="w-4 h-4 text-gray-400 ml-auto mt-1"
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
