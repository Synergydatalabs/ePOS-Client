"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import Link from "next/link";
import { format } from "date-fns";
import RefundModal from "@/components/pos/RefundModal";

interface Order {
  id: string;
  orderNumber: string;
  displayNumber: number;
  orderType: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  subtotal: number;
  taxAmount: number;
  total: number;
  createdAt: string;
  paidAt: string | null;
  table?: { tableNumber: number };
  _count?: { items: number };
  payments?: {
    id: string;
    provider: string;
    status: string;
    method: string | null;
    amount: number;
    providerRef: string | null;
    metadata: Record<string, unknown> | null;
  }[];
}

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  currency: string;
  businessType?: string;
}

export default function POSHistoryPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  // Order the refund modal is open for (null when closed). Kept as an
  // object rather than a boolean + separate id so switching between orders
  // resets the modal state cleanly.
  const [refundFor, setRefundFor] = useState<Order | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [currency, setCurrency] = useState("CAD");

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const response = await fetch("/api/pos/auth/session");
      const data = await response.json();

      if (!data.authenticated) {
        router.replace("/pos/login");
        return;
      }

      if (data.mustChangePassword) {
        router.replace("/pos/login?changePassword=true");
        return;
      }

      setUser(data.user);
      setTenant(data.tenant);
      setTenantId(data.tenant.id);
      setCurrency(data.tenant.currency || "CAD");
      localStorage.setItem("tap_active_tenant", data.tenant.id);
      setAuthChecked(true);
    } catch (error) {
      console.error("Session check failed:", error);
      router.replace("/pos/login");
    }
  };

  const loadOrders = useCallback(async () => {
    if (!tenantId) return;

    setLoading(true);
    try {
      const locationId = localStorage.getItem("tap_active_location");
      let url = `/api/tenants/${tenantId}/orders?limit=50`;
      if (locationId) url += `&locationId=${locationId}`;
      if (filter !== "all") url += `&status=${filter}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.success) {
        setOrders(data.orders);
      }
    } catch (error) {
      console.error("Failed to load orders:", error);
      toast.error("Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [tenantId, filter]);

  useEffect(() => {
    if (authChecked && tenantId) {
      loadOrders();
    }
  }, [authChecked, tenantId, loadOrders]);

  const handleLogout = async () => {
    try {
      await fetch("/api/pos/auth/logout", { method: "POST" });
      router.replace("/pos/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleVoid = async (orderId: string, paymentId: string) => {
    if (!tenantId) return;
    if (!confirm("Void this payment? The full amount will be reversed.")) return;

    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/orders/${orderId}/payment/void`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId }),
        }
      );
      const data = await res.json();
      if (data.success) {
        toast.success("Payment voided successfully");
        loadOrders();
      } else {
        toast.error(data.error || "Void failed");
      }
    } catch {
      toast.error("Void request failed");
    }
  };

  // Open the modal for this order — the modal handles amount, reason,
  // refund-destination and calls back through onRefunded when done.
  const openRefundFor = (order: Order) => {
    setRefundFor(order);
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PENDING":
        return "bg-amber-100 text-amber-700";
      case "CONFIRMED":
        return "bg-blue-100 text-blue-700";
      case "PREPARING":
        return "bg-purple-100 text-purple-700";
      case "READY":
        return "bg-green-100 text-green-700";
      case "COMPLETED":
        return "bg-gray-100 text-gray-700";
      case "CANCELLED":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const getOrderTypeIcon = (type: string) => {
    switch (type) {
      case "DINE_IN":
        return "solar:armchair-bold";
      case "TAKEAWAY":
        return "solar:bag-4-bold";
      case "DELIVERY":
        return "solar:delivery-bold";
      case "APPOINTMENT":
        return "solar:calendar-bold";
      default:
        return isSalon ? "solar:calendar-bold" : "solar:bag-4-bold";
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const userName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : user?.email.split('@')[0] || 'Staff';

  const isSalon = tenant?.businessType === "salon";
  const isRetail = tenant?.businessType === "retail";

  const filterTabs = isSalon
    ? [
        { value: "all", label: "All" },
        { value: "CONFIRMED", label: "Booked" },
        { value: "PREPARING", label: "In Progress" },
        { value: "COMPLETED", label: "Completed" },
        { value: "CANCELLED", label: "Cancelled" },
      ]
    : isRetail
      ? [
          { value: "all", label: "All" },
          { value: "PENDING", label: "Pending" },
          { value: "COMPLETED", label: "Completed" },
          { value: "CANCELLED", label: "Cancelled" },
        ]
      : [
          { value: "all", label: "All" },
          { value: "PENDING", label: "Pending" },
          { value: "CONFIRMED", label: "Confirmed" },
          { value: "PREPARING", label: "Preparing" },
          { value: "READY", label: "Ready" },
          { value: "COMPLETED", label: "Completed" },
        ];

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/pos" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
              <Icon icon="solar:arrow-left-linear" className="w-5 h-5" />
            </Link>
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${isSalon ? "from-purple-500 to-purple-600" : "from-green-500 to-emerald-600"} flex items-center justify-center`}>
              <Icon icon={isSalon ? "solar:calendar-bold" : "solar:clipboard-list-bold"} className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">{isSalon ? "Appointments" : "Orders"}</h1>
              <p className="text-sm text-gray-500">{orders.length} {isSalon ? "appointments" : "orders"}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:block">{userName}</span>
            <button
              onClick={loadOrders}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            >
              <Icon icon="solar:refresh-linear" className="w-5 h-5" />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-red-500"
            >
              <Icon icon="solar:logout-2-outline" className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 mt-3 overflow-x-auto">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === tab.value
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Orders List */}
      <div className="p-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-1/4 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <Icon icon="solar:clipboard-list-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">{isSalon ? "No appointments found" : "No orders found"}</h3>
            <p className="text-gray-400">{isSalon ? "Appointments will appear here" : "Orders will appear here"}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div
                key={order.id}
                className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Icon icon={getOrderTypeIcon(order.orderType)} className="w-5 h-5 text-gray-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900">#{order.displayNumber}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                          {order.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">
                        {isSalon ? "Appointment" : order.orderType.replace("_", " ")}
                        {order.table && ` • Table ${order.table.tableNumber}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">{formatPrice(order.total)}</p>
                    <p className="text-xs text-gray-400">
                      {format(new Date(order.createdAt), "MMM d, h:mm a")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">
                    {order._count?.items || 0} item{(order._count?.items || 0) !== 1 ? "s" : ""}
                    {order.paymentMethod && (
                      <span className="ml-2 text-gray-400">
                        {order.paymentMethod === "CARD" || order.paymentMethod === "CONTACTLESS" || order.paymentMethod === "INTERAC"
                          ? `Paid by ${order.paymentMethod.toLowerCase()}`
                          : order.paymentMethod === "CASH"
                            ? "Paid cash"
                            : ""}
                      </span>
                    )}
                  </span>
                  <span className="text-gray-400">
                    Order {order.orderNumber}
                  </span>
                </div>

                {/* Void/Refund buttons for card payments */}
                {order.payments?.some(
                  (p) => p.provider === "GP_UPA" && (p.status === "COMPLETED" || p.status === "PARTIALLY_REFUNDED")
                ) && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                    {order.payments
                      ?.filter((p) => p.provider === "GP_UPA" && p.status === "COMPLETED")
                      .map((p) => (
                        <div key={p.id} className="flex gap-2">
                          <button
                            onClick={() => handleVoid(order.id, p.id)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                          >
                            <Icon icon="solar:close-circle-bold" className="w-3.5 h-3.5" />
                            Void
                          </button>
                          <button
                            onClick={() => openRefundFor(order)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                          >
                            <Icon icon="solar:undo-left-bold" className="w-3.5 h-3.5" />
                            Refund
                          </button>
                        </div>
                      ))}
                    {order.payments
                      ?.filter((p) => p.provider === "GP_UPA" && p.status === "PARTIALLY_REFUNDED")
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => openRefundFor(order)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                        >
                          <Icon icon="solar:undo-left-bold" className="w-3.5 h-3.5" />
                          Refund More
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Refund modal — single instance rebound to whichever order is being refunded */}
      {refundFor && tenantId && (
        <RefundModal
          isOpen={true}
          onClose={() => setRefundFor(null)}
          tenantId={tenantId}
          orderId={refundFor.id}
          orderTotal={refundFor.total}
          currency={currency}
          payments={(refundFor.payments || []).map((p) => ({
            id: p.id,
            method: (p.method || p.provider || "").toLowerCase(),
            amount: p.amount,
            refundedAmount: 0, // history page doesn't fetch nested refunds; server enforces the cap
          }))}
          onRefunded={() => {
            setRefundFor(null);
            loadOrders();
          }}
        />
      )}
    </div>
  );
}
