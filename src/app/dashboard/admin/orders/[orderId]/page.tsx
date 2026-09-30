"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Card, Badge, Button } from "@/components/ui";
import RefundModal from "@/components/pos/RefundModal";

interface OrderItem {
  id: string;
  productName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  modifiersTotal: number;
  itemTotal: number;
  status: string;
  specialInstructions?: string;
  modifiers?: { id: string; modifierName: string; price: number; quantity: number }[];
  allergenNotes?: { id: string; note: string; isAllergy: boolean; allergen?: { name: string } }[];
}

interface RefundRow {
  id: string;
  amount: number;
  reason?: string | null;
  status: string;
  providerRef?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

interface PaymentRow {
  id: string;
  provider: string;
  method?: string | null;
  amount: number;
  status: string;
  currency: string;
  completedAt?: string | null;
  createdAt: string;
  refunds: RefundRow[];
}

interface Order {
  id: string;
  orderNumber: string;
  displayNumber: number;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "APPOINTMENT";
  status: string;
  subtotal: number;
  taxAmount: number;
  tax2Amount: number;
  tipAmount: number;
  discountAmount: number;
  total: number;
  totalCost: number;
  profit?: number;
  profitMargin?: number;
  currency: string;
  paymentStatus: string;
  paymentMethod?: string;
  table?: { id: string; tableNumber: number; name?: string };
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  deliveryAddress?: string;
  deliveryNotes?: string;
  notes?: string;
  items: OrderItem[];
  payments?: PaymentRow[];
  location?: { id: string; name: string };
  createdBy?: { firstName: string; lastName: string; email: string };
  createdAt: string;
  completedAt?: string;
}

const STATUS_FLOW: Record<string, { label: string; color: string; next?: { status: string; label: string } }> = {
  NEW:        { label: "New",        color: "bg-amber-50 text-amber-700 border-amber-200",   next: { status: "CONFIRMED", label: "Confirm Order" } },
  PENDING:    { label: "Pending",    color: "bg-amber-50 text-amber-700 border-amber-200",   next: { status: "CONFIRMED", label: "Confirm Order" } },
  CONFIRMED:  { label: "Confirmed",  color: "bg-blue-50 text-blue-700 border-blue-200",      next: { status: "PREPARING", label: "Start Preparing" } },
  PREPARING:  { label: "Preparing",  color: "bg-indigo-50 text-indigo-700 border-indigo-200", next: { status: "READY", label: "Mark Ready" } },
  READY:      { label: "Ready",      color: "bg-green-50 text-green-700 border-green-200",   next: { status: "SERVED", label: "Mark Served" } },
  SERVED:     { label: "Served",     color: "bg-teal-50 text-teal-700 border-teal-200",      next: { status: "COMPLETED", label: "Complete Order" } },
  PICKED_UP:  { label: "Picked Up",  color: "bg-teal-50 text-teal-700 border-teal-200",      next: { status: "COMPLETED", label: "Complete Order" } },
  DELIVERED:  { label: "Delivered",  color: "bg-teal-50 text-teal-700 border-teal-200",      next: { status: "COMPLETED", label: "Complete Order" } },
  COMPLETED:  { label: "Completed",  color: "bg-green-100 text-green-800 border-green-300" },
  CANCELLED:  { label: "Cancelled",  color: "bg-red-50 text-red-700 border-red-200" },
  REFUNDED:   { label: "Refunded",   color: "bg-gray-100 text-gray-700 border-gray-300" },
};

export default function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const loadOrder = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/orders/${orderId}`);
      const data = await res.json();
      if (data.success) {
        setOrder(data.order);
      } else {
        toast.error(data.error || "Order not found");
      }
    } catch {
      toast.error("Failed to load order");
    } finally {
      setLoading(false);
    }
  }, [tenantId, orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const formatPrice = (amount: number | null | undefined) => {
    const cents = Number(amount) || 0;
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: order?.currency || "CAD",
    }).format(cents / 100);
  };

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString("en-CA", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });

  const handleUpdateStatus = async (newStatus: string) => {
    if (!tenantId || !order) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Order marked as ${newStatus.toLowerCase().replace("_", " ")}`);
        loadOrder();
      } else {
        toast.error(data.error || "Failed to update");
      }
    } catch {
      toast.error("Failed to update");
    } finally {
      setUpdating(false);
    }
  };

  const handleCancel = async () => {
    if (!tenantId || !order) return;
    if (!confirm("Are you sure you want to cancel this order?")) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/orders/${orderId}?reason=Cancelled by staff`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Order cancelled");
        loadOrder();
      } else {
        toast.error(data.error || "Failed to cancel");
      }
    } catch {
      toast.error("Failed to cancel");
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-200 rounded w-64" />
          <div className="h-32 bg-gray-200 rounded" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-12 text-center">
        <Icon icon="solar:clipboard-list-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Order not found</h2>
        <Button onClick={() => router.push("/dashboard/admin/orders")}>Back to Orders</Button>
      </div>
    );
  }

  const statusConfig = STATUS_FLOW[order.status] || STATUS_FLOW.NEW;
  const canCancel = !["COMPLETED", "CANCELLED", "REFUNDED"].includes(order.status);
  const canAdvance = statusConfig.next && !["COMPLETED", "CANCELLED", "REFUNDED"].includes(order.status);

  // For TAKEAWAY/DELIVERY, skip SERVED step — go straight to COMPLETED from READY
  const nextAction = order.status === "READY" && (order.orderType === "TAKEAWAY" || order.orderType === "DELIVERY")
    ? { status: "COMPLETED", label: order.orderType === "TAKEAWAY" ? "Mark Picked Up" : "Complete Order" }
    : statusConfig.next;

  return (
    <div>
      <AdminHeader
        title={`Order #${order.displayNumber}`}
        subtitle={order.orderNumber}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon="solar:arrow-left-linear" onClick={() => router.push("/dashboard/admin/orders")}>
              Back
            </Button>
            <Button variant="secondary" icon="solar:printer-linear" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Status banner */}
        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border-2 ${statusConfig.color}`}>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/80 flex items-center justify-center">
              <Icon
                icon={
                  order.orderType === "DINE_IN" ? "solar:buildings-2-bold"
                  : order.orderType === "TAKEAWAY" ? "solar:bag-4-bold"
                  : order.orderType === "DELIVERY" ? "solar:delivery-bold"
                  : "solar:calendar-bold"
                }
                className="w-7 h-7"
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider opacity-75">Status</p>
              <p className="text-2xl font-bold">{statusConfig.label}</p>
              <p className="text-sm opacity-75 mt-0.5">
                {order.orderType === "DINE_IN"
                  ? `Dine In${order.table ? ` · Table ${order.table.tableNumber}` : ""}`
                  : order.orderType === "TAKEAWAY"
                  ? "Takeaway"
                  : order.orderType === "DELIVERY"
                  ? "Delivery"
                  : "Appointment"}
                {" · "}{formatDateTime(order.createdAt)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canAdvance && nextAction && (
              <Button
                onClick={() => handleUpdateStatus(nextAction.status)}
                disabled={updating}
                icon="solar:arrow-right-circle-bold"
              >
                {nextAction.label}
              </Button>
            )}
            {canCancel && (
              <Button variant="danger" onClick={handleCancel} disabled={updating} icon="solar:close-circle-linear">
                Cancel
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main column: Items + Totals */}
          <div className="lg:col-span-2 space-y-6">
            {/* Items */}
            <Card>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Items ({order.items.length})</h3>
              <div className="space-y-3">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between p-4 bg-gray-50 rounded-xl">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">
                          {item.quantity}× {item.productName}
                        </span>
                        {item.variantName && (
                          <Badge variant="gray" size="sm">{item.variantName}</Badge>
                        )}
                      </div>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {item.modifiers.map((m) => (
                            <p key={m.id} className="text-sm text-gray-600">
                              + {m.modifierName} {m.price > 0 && <span className="text-gray-400">({formatPrice(m.price)})</span>}
                            </p>
                          ))}
                        </div>
                      )}
                      {item.allergenNotes && item.allergenNotes.length > 0 && (
                        <div className="mt-2 flex gap-1 flex-wrap">
                          {item.allergenNotes.map((an) => (
                            <Badge key={an.id} variant={an.isAllergy ? "danger" : "warning"} size="sm">
                              {an.isAllergy && <Icon icon="solar:danger-triangle-bold" className="w-3 h-3 mr-1" />}
                              {an.allergen?.name || an.note}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {item.specialInstructions && (
                        <p className="mt-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                          <Icon icon="solar:info-circle-bold" className="w-4 h-4 inline mr-1" />
                          {item.specialInstructions}
                        </p>
                      )}
                    </div>
                    <div className="text-right ml-4">
                      <p className="font-semibold text-gray-900">{formatPrice(item.itemTotal)}</p>
                      <p className="text-xs text-gray-500">{formatPrice(item.unitPrice)} each</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Notes */}
            {order.notes && (
              <Card>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Order Notes</h3>
                <p className="text-gray-600 whitespace-pre-wrap">{order.notes}</p>
              </Card>
            )}

            {/* Totals */}
            <Card>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Fare Summary</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatPrice(order.subtotal)}</span>
                </div>
                {order.discountAmount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>−{formatPrice(order.discountAmount)}</span>
                  </div>
                )}
                {order.taxAmount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Tax</span>
                    <span>{formatPrice(order.taxAmount)}</span>
                  </div>
                )}
                {order.tax2Amount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Tax 2</span>
                    <span>{formatPrice(order.tax2Amount)}</span>
                  </div>
                )}
                {order.tipAmount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Tip</span>
                    <span>{formatPrice(order.tipAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-200">
                  <span>Total</span>
                  <span>{formatPrice(order.total)}</span>
                </div>
                {order.profit !== undefined && (
                  <div className="flex justify-between text-sm text-emerald-600 pt-1">
                    <span>Profit ({order.profitMargin?.toFixed(1)}%)</span>
                    <span>{formatPrice(order.profit)}</span>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Sidebar: Customer, Payment, Meta */}
          <div className="space-y-6">
            {/* Payment */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Payment</h3>
                {/* Show refund button whenever there's at least one refundable payment */}
                {order.payments && order.payments.some(
                  (p) =>
                    p.status !== "FAILED" &&
                    p.status !== "CANCELLED" &&
                    p.amount - p.refunds.filter((r) => r.status !== "FAILED" && r.status !== "CANCELLED").reduce((s, r) => s + r.amount, 0) > 0
                ) && (
                  <button
                    onClick={() => setRefundOpen(true)}
                    className="text-xs font-medium text-red-600 hover:text-red-700 flex items-center gap-1"
                  >
                    <Icon icon="solar:refresh-circle-linear" className="w-4 h-4" />
                    Refund
                  </button>
                )}
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Status</span>
                  <Badge
                    variant={
                      order.paymentStatus === "COMPLETED" || order.paymentStatus === "PAID"
                        ? "success"
                        : order.paymentStatus === "REFUNDED" || order.paymentStatus === "PARTIALLY_REFUNDED"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {order.paymentStatus === "PARTIALLY_REFUNDED"
                      ? "Partially Refunded"
                      : order.paymentStatus}
                  </Badge>
                </div>

                {/* Per-payment ledger — one row per tender, with refunds nested underneath */}
                {order.payments && order.payments.length > 0 ? (
                  <div className="space-y-2 border-t border-gray-100 pt-3">
                    {order.payments.map((p) => {
                      const activeRefunds = p.refunds.filter(
                        (r) => r.status !== "FAILED" && r.status !== "CANCELLED"
                      );
                      const refundedTotal = activeRefunds.reduce(
                        (s, r) => s + r.amount,
                        0
                      );
                      const netPaid = p.amount - refundedTotal;
                      const method = (p.method || p.provider || "").toLowerCase();
                      return (
                        <div key={p.id}>
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-1.5 text-gray-700">
                              <Icon
                                icon={
                                  method === "cash"
                                    ? "solar:wallet-money-bold"
                                    : method === "gift_card"
                                      ? "solar:gift-bold"
                                      : "solar:card-bold"
                                }
                                className="w-4 h-4 text-gray-500"
                              />
                              <span className="capitalize">
                                {method.replace("_", " ")}
                              </span>
                            </div>
                            <span className={netPaid <= 0 ? "text-gray-400 line-through" : "font-semibold text-gray-900"}>
                              {new Intl.NumberFormat("en-CA", {
                                style: "currency",
                                currency: p.currency || order.currency,
                              }).format(p.amount / 100)}
                            </span>
                          </div>
                          {activeRefunds.map((r) => (
                            <div
                              key={r.id}
                              className="ml-6 mt-1 flex items-center justify-between text-xs text-red-600"
                            >
                              <span className="flex items-center gap-1">
                                <Icon icon="solar:arrow-left-linear" className="w-3 h-3" />
                                Refunded
                                {r.reason && (
                                  <span className="text-gray-500">
                                    · {r.reason}
                                  </span>
                                )}
                              </span>
                              <span className="font-medium">
                                -{new Intl.NumberFormat("en-CA", {
                                  style: "currency",
                                  currency: p.currency || order.currency,
                                }).format(r.amount / 100)}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : order.paymentMethod ? (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Method</span>
                    <div className="flex items-center gap-1.5">
                      <Icon
                        icon={order.paymentMethod === "CASH" ? "solar:wallet-money-bold" : "solar:card-bold"}
                        className="w-4 h-4 text-gray-500"
                      />
                      <span className="text-sm font-medium text-gray-900 capitalize">
                        {order.paymentMethod.toLowerCase()}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>

            {/* Customer */}
            {(order.customerName || order.customerPhone || order.customerEmail) && (
              <Card>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Customer</h3>
                <div className="space-y-2">
                  {order.customerName && (
                    <div className="flex items-center gap-2 text-sm">
                      <Icon icon="solar:user-bold" className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{order.customerName}</span>
                    </div>
                  )}
                  {order.customerPhone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Icon icon="solar:phone-bold" className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{order.customerPhone}</span>
                    </div>
                  )}
                  {order.customerEmail && (
                    <div className="flex items-center gap-2 text-sm">
                      <Icon icon="solar:letter-bold" className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-900">{order.customerEmail}</span>
                    </div>
                  )}
                  {order.deliveryAddress && (
                    <div className="flex items-start gap-2 text-sm pt-2 border-t border-gray-100">
                      <Icon icon="solar:map-point-bold" className="w-4 h-4 text-gray-400 mt-0.5" />
                      <span className="text-gray-900">{order.deliveryAddress}</span>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Meta */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Details</h3>
              <div className="space-y-2 text-sm">
                {order.location && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Location</span>
                    <span className="font-medium text-gray-900">{order.location.name}</span>
                  </div>
                )}
                {order.createdBy && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Created by</span>
                    <span className="font-medium text-gray-900">
                      {order.createdBy.firstName} {order.createdBy.lastName}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Created</span>
                  <span className="font-medium text-gray-900">{formatDateTime(order.createdAt)}</span>
                </div>
                {order.completedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Completed</span>
                    <span className="font-medium text-gray-900">{formatDateTime(order.completedAt)}</span>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Refund modal — mounted globally so it can outlive the payment card */}
      {refundOpen && order.payments && tenantId && (
        <RefundModal
          isOpen={refundOpen}
          onClose={() => setRefundOpen(false)}
          tenantId={tenantId}
          orderId={order.id}
          orderTotal={order.total}
          currency={order.currency}
          payments={order.payments.map((p) => ({
            id: p.id,
            method: (p.method || p.provider || "").toLowerCase(),
            amount: p.amount,
            refundedAmount: p.refunds
              .filter((r) => r.status !== "FAILED" && r.status !== "CANCELLED")
              .reduce((s, r) => s + r.amount, 0),
          }))}
          onRefunded={() => {
            loadOrder();
          }}
        />
      )}
    </div>
  );
}
