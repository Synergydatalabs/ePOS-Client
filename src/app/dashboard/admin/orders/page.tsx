"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Select, Card, Badge, Modal } from "@/components/ui";

interface OrderItem {
  id: string;
  productName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  modifiersTotal: number;
  itemTotal: number;
  status: string;
  modifiers?: { modifierName: string; price: number }[];
  specialInstructions?: string;
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
  paymentStatus: string;
  paymentMethod?: string;
  table?: { tableNumber: number; name?: string };
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  items: OrderItem[];
  createdAt: string;
  completedAt?: string;
}

export default function OrdersPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState<"today" | "week" | "month" | "all">("today");

  // Modal
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);

  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    const storedLocation = localStorage.getItem("tap_active_location");
    if (storedTenant) setTenantId(storedTenant);
    if (storedLocation) setLocationId(storedLocation);
  }, []);

  const loadOrders = useCallback(async () => {
    if (!tenantId) return;

    try {
      const params = new URLSearchParams();
      if (locationId) params.set("locationId", locationId);
      if (statusFilter) params.set("status", statusFilter);

      // Calculate date range
      const now = new Date();
      let startDate = new Date();

      switch (dateFilter) {
        case "today":
          startDate.setHours(0, 0, 0, 0);
          break;
        case "week":
          startDate.setDate(now.getDate() - 7);
          break;
        case "month":
          startDate.setMonth(now.getMonth() - 1);
          break;
        case "all":
          startDate = new Date(0);
          break;
      }

      params.set("startDate", startDate.toISOString());
      params.set("limit", "100");

      const [ordersRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/orders?${params}`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);

      const [ordersData, settingsData] = await Promise.all([
        ordersRes.json(),
        settingsRes.json(),
      ]);

      if (ordersData.success) setOrders(ordersData.orders);
      if (settingsData.success) setCurrency(settingsData.tenant?.currency || "CAD");
    } catch (error) {
      toast.error("Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId, statusFilter, dateFilter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const formatPrice = (amount: number | null | undefined) => {
    const cents = Number(amount) || 0;
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(cents / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-CA", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: any }> = {
      NEW: { label: "New", variant: "warning" },
      PENDING: { label: "Pending", variant: "warning" },
      CONFIRMED: { label: "Confirmed", variant: "info" },
      PREPARING: { label: "Preparing", variant: "info" },
      READY: { label: "Ready", variant: "success" },
      SERVED: { label: "Served", variant: "success" },
      PICKED_UP: { label: "Picked Up", variant: "success" },
      DELIVERED: { label: "Delivered", variant: "success" },
      COMPLETED: { label: "Completed", variant: "success" },
      CANCELLED: { label: "Cancelled", variant: "danger" },
      REFUNDED: { label: "Refunded", variant: "danger" },
    };
    return statusMap[status] || { label: status, variant: "gray" };
  };

  const getPaymentBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: any }> = {
      PENDING: { label: "Unpaid", variant: "warning" },
      PARTIAL: { label: "Partial", variant: "warning" },
      PAID: { label: "Paid", variant: "success" },
      REFUNDED: { label: "Refunded", variant: "danger" },
    };
    return statusMap[status] || { label: status, variant: "gray" };
  };

  const getOrderTypeIcon = (type: string) => {
    switch (type) {
      case "DINE_IN":
        return "solar:buildings-2-bold";
      case "TAKEAWAY":
        return "solar:bag-4-bold";
      case "DELIVERY":
        return "solar:delivery-bold";
      default:
        return "solar:bag-2-bold";
    }
  };

  const openOrderDetails = (order: Order) => {
    setSelectedOrder(order);
    setShowOrderModal(true);
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Order updated to ${newStatus.toLowerCase()}`);
        loadOrders();
        setShowOrderModal(false);
      } else {
        toast.error(data.error || "Failed to update order");
      }
    } catch (error) {
      toast.error("Failed to update order");
    }
  };

  // Filter orders
  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      !searchQuery ||
      order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customerPhone?.includes(searchQuery);

    return matchesSearch;
  });

  // Stats
  const stats = {
    total: filteredOrders.length,
    pending: filteredOrders.filter((o) => ["NEW", "PENDING", "CONFIRMED"].includes(o.status)).length,
    preparing: filteredOrders.filter((o) => o.status === "PREPARING").length,
    completed: filteredOrders.filter((o) => ["READY", "SERVED", "PICKED_UP", "DELIVERED", "COMPLETED"].includes(o.status)).length,
  };

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Please select a business first</p>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Orders"
        subtitle={`${stats.total} order${stats.total !== 1 ? "s" : ""} found`}
        actions={
          <Button icon="solar:refresh-linear" variant="secondary" onClick={loadOrders}>
            Refresh
          </Button>
        }
      />

      <div className="p-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
              <p className="text-sm text-gray-500">Total</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-amber-600">{stats.pending}</p>
              <p className="text-sm text-gray-500">Pending</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-blue-600">{stats.preparing}</p>
              <p className="text-sm text-gray-500">Preparing</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600">{stats.completed}</p>
              <p className="text-sm text-gray-500">Completed</p>
            </div>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <Input
            placeholder="Search orders..."
            icon="solar:magnifer-linear"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />
          <Select
            options={[
              { value: "", label: "All Statuses" },
              { value: "PENDING", label: "Pending" },
              { value: "CONFIRMED", label: "Confirmed" },
              { value: "PREPARING", label: "Preparing" },
              { value: "READY", label: "Ready" },
              { value: "SERVED", label: "Served" },
              { value: "COMPLETED", label: "Completed" },
              { value: "CANCELLED", label: "Cancelled" },
            ]}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40"
          />
          <div className="flex gap-2">
            {(["today", "week", "month", "all"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateFilter(range)}
                className={`px-4 py-2 rounded-xl font-medium transition-all ${
                  dateFilter === range
                    ? "bg-teal-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {range.charAt(0).toUpperCase() + range.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Orders Table */}
        {loading ? (
          <Card padding="none">
            <div className="animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 border-b border-gray-100">
                  <div className="w-10 h-10 bg-gray-200 rounded-xl" />
                  <div className="flex-1">
                    <div className="h-5 bg-gray-200 rounded w-1/4 mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : filteredOrders.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:clipboard-list-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No orders found</h3>
            <p className="text-gray-500">
              {searchQuery || statusFilter
                ? "Try adjusting your filters"
                : "Orders will appear here when customers place them"}
            </p>
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Type</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Time</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const statusInfo = getStatusBadge(order.status);
                    const paymentInfo = getPaymentBadge(order.paymentStatus);
                    return (
                      <tr
                        key={order.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => openOrderDetails(order)}
                      >
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center">
                              <span className="font-bold text-teal-600">
                                #{order.displayNumber}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{order.orderNumber}</p>
                              {order.customerName && (
                                <p className="text-sm text-gray-500">{order.customerName}</p>
                              )}
                              {order.table && (
                                <p className="text-sm text-gray-500">
                                  Table {order.table.tableNumber}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Icon
                              icon={getOrderTypeIcon(order.orderType)}
                              className="w-5 h-5 text-gray-500"
                            />
                            <span className="text-sm">
                              {order.orderType === "DINE_IN"
                                ? "Dine In"
                                : order.orderType === "TAKEAWAY"
                                ? "Takeaway"
                                : "Delivery"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="text-gray-600">
                            {order.items.reduce((sum, item) => sum + item.quantity, 0)} items
                          </span>
                        </td>
                        <td className="font-semibold text-gray-900">
                          {formatPrice(order.total)}
                        </td>
                        <td>
                          <Badge variant={paymentInfo.variant} size="sm">
                            {paymentInfo.label}
                          </Badge>
                        </td>
                        <td>
                          <Badge variant={statusInfo.variant}>
                            {statusInfo.label}
                          </Badge>
                        </td>
                        <td className="text-sm text-gray-500">
                          {formatDate(order.createdAt)}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openOrderDetails(order)}
                              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                            >
                              <Icon icon="solar:eye-linear" className="w-5 h-5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Order Details Modal */}
      <Modal
        isOpen={showOrderModal}
        onClose={() => setShowOrderModal(false)}
        title={selectedOrder ? `Order ${selectedOrder.orderNumber}` : "Order Details"}
        size="lg"
      >
        {selectedOrder && (
          <div className="space-y-6">
            {/* Order Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-teal-100 flex items-center justify-center">
                  <span className="text-2xl font-bold text-teal-600">
                    #{selectedOrder.displayNumber}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{selectedOrder.orderNumber}</p>
                  <p className="text-sm text-gray-500">
                    {selectedOrder.orderType === "DINE_IN"
                      ? `Dine In${selectedOrder.table ? ` - Table ${selectedOrder.table.tableNumber}` : ""}`
                      : selectedOrder.orderType === "TAKEAWAY"
                      ? "Takeaway"
                      : "Delivery"}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <Badge variant={getStatusBadge(selectedOrder.status).variant} size="lg">
                  {getStatusBadge(selectedOrder.status).label}
                </Badge>
                <p className="text-sm text-gray-500 mt-1">
                  {formatDate(selectedOrder.createdAt)}
                </p>
              </div>
            </div>

            {/* Customer Info */}
            {(selectedOrder.customerName || selectedOrder.customerPhone) && (
              <div className="p-4 bg-gray-50 rounded-xl">
                <h4 className="font-medium text-gray-900 mb-2">Customer</h4>
                {selectedOrder.customerName && (
                  <p className="text-gray-600">{selectedOrder.customerName}</p>
                )}
                {selectedOrder.customerPhone && (
                  <p className="text-gray-500">{selectedOrder.customerPhone}</p>
                )}
              </div>
            )}

            {/* Order Items */}
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Items</h4>
              <div className="space-y-2">
                {selectedOrder.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between p-3 bg-gray-50 rounded-xl"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {item.quantity}x {item.productName}
                        </span>
                        {item.variantName && (
                          <Badge variant="gray" size="sm">{item.variantName}</Badge>
                        )}
                      </div>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <p className="text-sm text-gray-500 mt-1">
                          {item.modifiers.map((m) => m.modifierName).join(", ")}
                        </p>
                      )}
                      {item.specialInstructions && (
                        <p className="text-sm text-amber-600 mt-1">Note: {item.specialInstructions}</p>
                      )}
                    </div>
                    <span className="font-medium text-gray-900">
                      {formatPrice(item.itemTotal)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Order Notes */}
            {selectedOrder.notes && (
              <div className="p-4 bg-amber-50 rounded-xl">
                <h4 className="font-medium text-amber-800 mb-1">Order Notes</h4>
                <p className="text-amber-700">{selectedOrder.notes}</p>
              </div>
            )}

            {/* Order Totals */}
            <div className="border-t border-gray-200 pt-4">
              <div className="space-y-2">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatPrice(selectedOrder.subtotal)}</span>
                </div>
                {selectedOrder.discountAmount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-{formatPrice(selectedOrder.discountAmount)}</span>
                  </div>
                )}
                {selectedOrder.taxAmount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Tax</span>
                    <span>{formatPrice(selectedOrder.taxAmount)}</span>
                  </div>
                )}
                {selectedOrder.tax2Amount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Tax 2</span>
                    <span>{formatPrice(selectedOrder.tax2Amount)}</span>
                  </div>
                )}
                {selectedOrder.tipAmount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Tip</span>
                    <span>{formatPrice(selectedOrder.tipAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-200">
                  <span>Total</span>
                  <span>{formatPrice(selectedOrder.total)}</span>
                </div>
              </div>
            </div>

            {/* Payment Info */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div>
                <p className="text-sm text-gray-500">Payment Status</p>
                <Badge variant={getPaymentBadge(selectedOrder.paymentStatus).variant}>
                  {getPaymentBadge(selectedOrder.paymentStatus).label}
                </Badge>
              </div>
              {selectedOrder.paymentMethod && (
                <div className="text-right">
                  <p className="text-sm text-gray-500">Payment Method</p>
                  <p className="font-medium text-gray-900">
                    {selectedOrder.paymentMethod === "CASH"
                      ? "Cash"
                      : selectedOrder.paymentMethod === "CARD"
                      ? "Card"
                      : "Online"}
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200">
              <a
                href={`/dashboard/admin/orders/${selectedOrder.id}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 transition-colors"
              >
                <Icon icon="solar:eye-bold" className="w-4 h-4" />
                View Full Details
              </a>
              {!["COMPLETED", "CANCELLED", "REFUNDED"].includes(selectedOrder.status) && (
                <>
                  <div className="w-full text-sm text-gray-500 mt-2 mb-1">Update Status:</div>
                  {(selectedOrder.status === "NEW" || selectedOrder.status === "PENDING") && (
                    <Button variant="secondary" onClick={() => handleUpdateStatus(selectedOrder.id, "CONFIRMED")}>
                      Confirm Order
                    </Button>
                  )}
                  {selectedOrder.status === "CONFIRMED" && (
                    <Button variant="secondary" onClick={() => handleUpdateStatus(selectedOrder.id, "PREPARING")}>
                      Start Preparing
                    </Button>
                  )}
                  {selectedOrder.status === "PREPARING" && (
                    <Button onClick={() => handleUpdateStatus(selectedOrder.id, "READY")}>
                      Mark Ready
                    </Button>
                  )}
                  {selectedOrder.status === "READY" && selectedOrder.orderType === "DINE_IN" && (
                    <Button onClick={() => handleUpdateStatus(selectedOrder.id, "SERVED")}>
                      Mark Served
                    </Button>
                  )}
                  {selectedOrder.status === "READY" && selectedOrder.orderType === "TAKEAWAY" && (
                    <Button onClick={() => handleUpdateStatus(selectedOrder.id, "COMPLETED")}>
                      Mark Picked Up
                    </Button>
                  )}
                  {selectedOrder.status === "READY" && selectedOrder.orderType === "DELIVERY" && (
                    <Button onClick={() => handleUpdateStatus(selectedOrder.id, "PICKED_UP")}>
                      Driver Picked Up
                    </Button>
                  )}
                  {selectedOrder.status === "SERVED" && (
                    <Button onClick={() => handleUpdateStatus(selectedOrder.id, "COMPLETED")}>
                      Complete Order
                    </Button>
                  )}
                  {selectedOrder.status === "PICKED_UP" && (
                    <Button onClick={() => handleUpdateStatus(selectedOrder.id, "DELIVERED")}>
                      Mark Delivered
                    </Button>
                  )}
                  {selectedOrder.status === "DELIVERED" && (
                    <Button onClick={() => handleUpdateStatus(selectedOrder.id, "COMPLETED")}>
                      Complete Order
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => handleUpdateStatus(selectedOrder.id, "CANCELLED")}>
                    Cancel Order
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
