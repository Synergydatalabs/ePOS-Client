"use client";

// Supplier's view of a single PO. Shows:
//   - Header with PO number, current status, merchant name
//   - Timeline (submitted / acknowledged / shipped / delivered / cancelled)
//   - Ship-to address (snapshotted at submit time; NEVER refetched)
//   - Line items with unit price and line total
//   - Notes both directions
//   - Action buttons contextual to the current status:
//       SUBMITTED    → Acknowledge, Cancel
//       ACKNOWLEDGED → Mark as Shipped, Cancel
//       SHIPPED      → Mark as Delivered
//       DELIVERED / CANCELLED → terminal, no actions
//
// Every mutation goes through POST /api/supplier/orders/[id] with an
// `action` field — see that route for the state-machine guard.

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { Button, Modal } from "@/components/ui";
import PoMessageThread from "@/components/marketplace/PoMessageThread";

type Status = "SUBMITTED" | "ACKNOWLEDGED" | "SHIPPED" | "DELIVERED" | "CANCELLED";
type PaymentStatus = "UNPAID" | "PENDING" | "PAID" | "FAILED" | "REFUNDED";

interface OrderItem {
  id: string;
  productName: string;
  productSku: string | null;
  // Phase D #72: variant snapshot (null for simple products + legacy items).
  variantDisplayName: string | null;
  variantAttributes: Record<string, string> | null;
  unitLabel: string;
  unitPriceCents: number;
  qty: number;
  lineTotalCents: number;
  notes: string | null;
}

interface Order {
  id: string;
  poNumber: string;
  status: Status;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  shippingAddress: {
    name?: string;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
    phone?: string | null;
  };
  notesToSupplier: string | null;
  notesFromSupplier: string | null;
  shipmentCarrier: string | null;
  shipmentTrackingRef: string | null;
  expectedDeliveryAt: string | null;
  cancellationReason: string | null;
  submittedAt: string;
  acknowledgedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  merchantTenant: { id: string; name: string };
  items: OrderItem[];
  // Phase C #67 (2026-07-30): payment status (read-only from supplier side)
  paymentStatus: PaymentStatus;
  paidAt: string | null;
  paidAmountCents: number | null;
  paidMethod: string | null;
  // Phase D #76 (2026-07-31): fulfillment warehouse
  warehouse: {
    id: string;
    name: string;
    city: string | null;
    province: string | null;
    country: string;
  } | null;
}

interface Warehouse {
  id: string;
  name: string;
  city: string | null;
  province: string | null;
  country: string;
  isDefault: boolean;
  isActive: boolean;
}

const PAYMENT_STATUS_STYLES: Record<PaymentStatus, { bg: string; text: string; label: string }> = {
  UNPAID:   { bg: "bg-slate-100",   text: "text-slate-700",   label: "Unpaid" },
  PENDING:  { bg: "bg-blue-100",    text: "text-blue-800",    label: "Payment pending" },
  PAID:     { bg: "bg-emerald-100", text: "text-emerald-800", label: "Paid" },
  FAILED:   { bg: "bg-red-100",     text: "text-red-800",     label: "Payment failed" },
  REFUNDED: { bg: "bg-amber-100",   text: "text-amber-900",   label: "Refunded" },
};

const STATUS_STYLES: Record<Status, { bg: string; text: string; label: string }> = {
  SUBMITTED:    { bg: "bg-blue-100",    text: "text-blue-800",    label: "New" },
  ACKNOWLEDGED: { bg: "bg-indigo-100",  text: "text-indigo-800",  label: "Acknowledged" },
  SHIPPED:      { bg: "bg-amber-100",   text: "text-amber-800",   label: "Shipped" },
  DELIVERED:    { bg: "bg-emerald-100", text: "text-emerald-800", label: "Delivered" },
  CANCELLED:    { bg: "bg-gray-200",    text: "text-gray-700",    label: "Cancelled" },
};

export default function SupplierOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  // Ship + cancel modals — inline lightweight state, no extra components
  const [shipOpen, setShipOpen] = useState(false);
  const [shipCarrier, setShipCarrier] = useState("");
  const [shipTracking, setShipTracking] = useState("");
  const [shipEta, setShipEta] = useState("");
  const [shipNotes, setShipNotes] = useState("");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Phase D #76: warehouse picker at ack + reassign
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [ackOpen, setAckOpen] = useState(false);
  const [pickedWarehouseId, setPickedWarehouseId] = useState<string>("");
  const [reassignOpen, setReassignOpen] = useState(false);

  const [running, setRunning] = useState<null | "acknowledge" | "ship" | "deliver" | "cancel" | "reassignWarehouse">(null);

  const load = () => {
    fetch(`/api/supplier/orders/${orderId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setOrder(data.order);
        else {
          toast.error(data.error || "Order not found");
          router.replace("/supplier/orders");
        }
      })
      .catch(() => toast.error("Failed to load order"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Phase D #76: load available warehouses ONCE so both ack + reassign
  // pickers have them ready. Cheap query (usually 1-3 rows).
  useEffect(() => {
    fetch("/api/supplier/warehouses")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          const active = (data.warehouses || []).filter((w: Warehouse) => w.isActive);
          setWarehouses(active);
          const def = active.find((w: Warehouse) => w.isDefault);
          if (def) setPickedWarehouseId(def.id);
        }
      })
      .catch(() => {
        // Non-fatal — pickers just show an empty dropdown with a
        // "configure warehouses first" nudge.
      });
  }, []);

  const runAction = async (
    action: "acknowledge" | "ship" | "deliver" | "cancel" | "reassignWarehouse",
    extra: Record<string, unknown> = {}
  ) => {
    setRunning(action);
    try {
      const res = await fetch(`/api/supplier/orders/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Update failed");
        return;
      }
      setOrder(data.order);
      const successLabel = {
        acknowledge: "Order acknowledged",
        ship: "Marked as shipped",
        deliver: "Marked as delivered",
        cancel: "Order cancelled",
        reassignWarehouse: "Warehouse updated",
      }[action];
      toast.success(successLabel);
      setShipOpen(false);
      setCancelOpen(false);
      setAckOpen(false);
      setReassignOpen(false);
    } catch {
      toast.error("Update failed");
    } finally {
      setRunning(null);
    }
  };

  const money = useMemo(() => {
    return (cents: number) => {
      if (!order) return "";
      return `${order.currency} ${(cents / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    };
  }, [order]);

  if (loading) {
    return (
      <div className="p-6 lg:p-10 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-1/3" />
          <div className="h-40 bg-gray-100 rounded-2xl" />
          <div className="h-64 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!order) return null;

  const s = STATUS_STYLES[order.status];
  const addr = order.shippingAddress;
  const addrLines = [addr.address, [addr.city, addr.province, addr.postalCode].filter(Boolean).join(", "), addr.country]
    .filter(Boolean);

  // Timeline: only show states that have a timestamp (or the "current" one).
  const timeline = [
    { label: "Submitted", at: order.submittedAt, icon: "solar:mailbox-linear" },
    order.acknowledgedAt && { label: "Acknowledged", at: order.acknowledgedAt, icon: "solar:check-circle-linear" },
    order.shippedAt && { label: "Shipped", at: order.shippedAt, icon: "solar:box-linear" },
    order.deliveredAt && { label: "Delivered", at: order.deliveredAt, icon: "solar:archive-check-linear" },
    order.cancelledAt && { label: "Cancelled", at: order.cancelledAt, icon: "solar:close-circle-linear" },
  ].filter(Boolean) as { label: string; at: string; icon: string }[];

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto pb-24">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href="/supplier/orders" className="text-indigo-600 hover:underline">
            Purchase Orders
          </Link>
          <Icon icon="solar:alt-arrow-right-linear" className="w-3.5 h-3.5" />
          <span>{order.poNumber}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 font-mono">
            {order.poNumber}
          </h1>
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-semibold ${s.bg} ${s.text}`}
          >
            {s.label}
          </span>
        </div>
        <p className="text-gray-600 mt-1">
          From <strong>{order.merchantTenant.name}</strong>
        </p>
      </div>

      {/* Two-column layout: main + side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* MAIN — timeline, line items, notes */}
        <div className="lg:col-span-2 space-y-6">
          {/* Timeline */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Timeline</h2>
            <div className="space-y-3">
              {timeline.map((step) => (
                <div key={step.label} className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                    <Icon icon={step.icon} className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{step.label}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(step.at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
              {order.status === "SHIPPED" && order.expectedDeliveryAt && (
                <div className="flex items-center gap-3 text-sm opacity-60">
                  <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
                    <Icon icon="solar:calendar-linear" className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">Expected delivery</p>
                    <p className="text-xs text-gray-500">
                      {new Date(order.expectedDeliveryAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              )}
              {order.cancellationReason && (
                <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-900">
                  <p className="font-semibold mb-1">Cancellation reason</p>
                  <p>{order.cancellationReason}</p>
                </div>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                {order.items.length} item{order.items.length !== 1 ? "s" : ""}
              </h2>
            </div>
            <div className="divide-y divide-gray-100">
              {order.items.map((item) => (
                <div key={item.id} className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center flex-shrink-0">
                    <Icon icon="solar:box-linear" className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{item.productName}</p>
                    {item.variantDisplayName && (
                      <p className="text-xs text-indigo-700 font-medium truncate">
                        {item.variantDisplayName}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 truncate">
                      {item.productSku ? `${item.productSku} · ` : ""}
                      {item.qty} × {money(item.unitPriceCents)} per {item.unitLabel}
                    </p>
                    {item.notes && (
                      <p className="text-xs text-gray-500 italic mt-1">"{item.notes}"</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold text-gray-900">{money(item.lineTotalCents)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-gray-100 space-y-1.5 text-sm">
              <div className="flex items-center justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{money(order.subtotalCents)}</span>
              </div>
              {order.taxCents > 0 && (
                <div className="flex items-center justify-between text-gray-600">
                  <span>Tax</span>
                  <span>{money(order.taxCents)}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-gray-900 font-semibold text-base">
                <span>Total</span>
                <span>{money(order.totalCents)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {(order.notesToSupplier || order.notesFromSupplier) && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
              {order.notesToSupplier && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    From merchant
                  </h3>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">
                    {order.notesToSupplier}
                  </p>
                </div>
              )}
              {order.notesFromSupplier && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Your notes
                  </h3>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">
                    {order.notesFromSupplier}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Phase D #74: in-app messaging with the merchant */}
          <PoMessageThread
            viewerSide="SUPPLIER"
            threadUrl={`/api/supplier/orders/${orderId}/messages`}
            readUrl={`/api/supplier/orders/${orderId}/messages/read`}
          />
        </div>

        {/* SIDE — shipping, shipment info */}
        <div className="space-y-6">
          {/* Phase C #67 (2026-07-30): payment status — read-only from the
              supplier side. Prominent because "did I get paid" is the first
              thing a supplier wants to know when opening a PO. */}
          <div
            className={`rounded-2xl border p-5 ${
              order.paymentStatus === "PAID"
                ? "bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200"
                : "bg-white border-gray-200"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Payment
              </h3>
              {(() => {
                const s = PAYMENT_STATUS_STYLES[order.paymentStatus];
                return (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}>
                    {s.label}
                  </span>
                );
              })()}
            </div>
            {order.paymentStatus === "PAID" && order.paidAt ? (
              <>
                <p className="text-sm text-emerald-900 mb-2">
                  Received {new Date(order.paidAt).toLocaleString()}
                </p>
                {order.paidAmountCents != null && (
                  <p className="text-lg font-bold text-emerald-900">
                    {money(order.paidAmountCents)}
                  </p>
                )}
                {order.paidMethod && (
                  <p className="text-xs text-emerald-700 mt-1">via {order.paidMethod}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-600">
                {order.paymentStatus === "UNPAID"
                  ? "Awaiting payment from the merchant. They'll see a payment link on their PO if you have an active gateway."
                  : order.paymentStatus === "PENDING"
                  ? "Payment is being processed by the card network."
                  : order.paymentStatus === "FAILED"
                  ? "The last payment attempt failed. Merchant may retry."
                  : "This payment has been refunded."}
              </p>
            )}
          </div>

          {/* Phase D #76: fulfillment warehouse. Shown from ACK onward.
              Supplier can reassign while the PO is still on their side
              (not yet delivered / cancelled). */}
          {(order.status === "ACKNOWLEDGED" ||
            order.status === "SHIPPED" ||
            order.status === "DELIVERED") && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Ships from
                </h3>
                {order.status !== "DELIVERED" && warehouses.length > 1 && (
                  <button
                    onClick={() => {
                      setPickedWarehouseId(order.warehouse?.id || "");
                      setReassignOpen(true);
                    }}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Change
                  </button>
                )}
              </div>
              {order.warehouse ? (
                <>
                  <p className="text-sm font-semibold text-gray-900">
                    {order.warehouse.name}
                  </p>
                  {(order.warehouse.city || order.warehouse.province) && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {[order.warehouse.city, order.warehouse.province, order.warehouse.country]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500 italic">
                  No warehouse assigned.{" "}
                  {warehouses.length > 0 && (
                    <button
                      onClick={() => {
                        setPickedWarehouseId("");
                        setReassignOpen(true);
                      }}
                      className="text-indigo-600 hover:underline"
                    >
                      Assign one
                    </button>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Shipping address */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Ship to
            </h3>
            <p className="font-semibold text-gray-900">{addr.name || "—"}</p>
            {addrLines.map((line, i) => (
              <p key={i} className="text-sm text-gray-600">
                {line}
              </p>
            ))}
            {addr.phone && (
              <p className="text-sm text-gray-600 mt-2">
                <Icon icon="solar:phone-linear" className="w-3.5 h-3.5 inline mr-1" />
                {addr.phone}
              </p>
            )}
          </div>

          {/* Shipment info (only after shipping) */}
          {order.status === "SHIPPED" || order.status === "DELIVERED" ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Shipment
              </h3>
              {order.shipmentCarrier ? (
                <p className="text-sm text-gray-800">
                  <strong>{order.shipmentCarrier}</strong>
                </p>
              ) : (
                <p className="text-sm text-gray-500 italic">No carrier recorded</p>
              )}
              {order.shipmentTrackingRef && (
                <p className="text-sm text-gray-600 mt-1 font-mono">{order.shipmentTrackingRef}</p>
              )}
              {order.expectedDeliveryAt && (
                <p className="text-xs text-gray-500 mt-2">
                  Expected {new Date(order.expectedDeliveryAt).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Sticky action bar — one row of contextual buttons per status */}
      {order.status !== "DELIVERED" && order.status !== "CANCELLED" && (
        <div className="fixed bottom-0 left-0 lg:left-64 right-0 bg-white border-t border-gray-200 px-6 py-3 flex justify-end gap-3 z-30">
          {order.status === "SUBMITTED" && (
            <>
              <Button
                variant="secondary"
                onClick={() => setCancelOpen(true)}
                disabled={!!running}
              >
                Cancel Order
              </Button>
              <Button
                icon="solar:check-circle-bold"
                onClick={() => {
                  // Only prompt for warehouse when the supplier has >1 to
                  // pick from — single-warehouse case auto-uses the default.
                  if (warehouses.length > 1) {
                    setAckOpen(true);
                  } else {
                    runAction("acknowledge");
                  }
                }}
                disabled={!!running}
              >
                {running === "acknowledge" ? "Acknowledging…" : "Acknowledge Order"}
              </Button>
            </>
          )}
          {order.status === "ACKNOWLEDGED" && (
            <>
              <Button
                variant="secondary"
                onClick={() => setCancelOpen(true)}
                disabled={!!running}
              >
                Cancel Order
              </Button>
              <Button
                icon="solar:box-bold"
                onClick={() => setShipOpen(true)}
                disabled={!!running}
              >
                Mark as Shipped
              </Button>
            </>
          )}
          {order.status === "SHIPPED" && (
            <Button
              icon="solar:archive-check-bold"
              onClick={() => runAction("deliver")}
              disabled={!!running}
            >
              {running === "deliver" ? "Updating…" : "Mark as Delivered"}
            </Button>
          )}
        </div>
      )}

      {/* Ship modal */}
      <Modal isOpen={shipOpen} onClose={() => setShipOpen(false)} title="Mark as Shipped" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Carrier (optional)
            </label>
            <input
              type="text"
              value={shipCarrier}
              onChange={(e) => setShipCarrier(e.target.value)}
              placeholder="e.g. FedEx, UPS, own driver"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Tracking number (optional)
            </label>
            <input
              type="text"
              value={shipTracking}
              onChange={(e) => setShipTracking(e.target.value)}
              placeholder="Merchant sees this to track their delivery"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Expected delivery (optional)
            </label>
            <input
              type="date"
              value={shipEta}
              onChange={(e) => setShipEta(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Note to merchant (optional)
            </label>
            <textarea
              rows={3}
              value={shipNotes}
              onChange={(e) => setShipNotes(e.target.value)}
              placeholder="Anything the merchant should know?"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setShipOpen(false)}>
              Cancel
            </Button>
            <Button
              icon="solar:box-bold"
              disabled={running === "ship"}
              onClick={() =>
                runAction("ship", {
                  shipmentCarrier: shipCarrier.trim() || undefined,
                  shipmentTrackingRef: shipTracking.trim() || undefined,
                  expectedDeliveryAt: shipEta || undefined,
                  notes: shipNotes.trim() || undefined,
                })
              }
            >
              {running === "ship" ? "Updating…" : "Confirm Shipped"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cancel modal */}
      <Modal isOpen={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel Order" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Cancelling will notify the merchant. Please share a reason so they know what to expect.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Reason
            </label>
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Out of stock, unable to fulfill by requested date, invalid PO"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Keep Order
            </Button>
            <Button
              icon="solar:close-circle-bold"
              disabled={running === "cancel" || !cancelReason.trim()}
              onClick={() =>
                runAction("cancel", { cancellationReason: cancelReason.trim() })
              }
            >
              {running === "cancel" ? "Cancelling…" : "Confirm Cancellation"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Phase D #76: Acknowledge with warehouse picker (multi-warehouse
          suppliers only — single-warehouse case skips the modal). */}
      <Modal
        isOpen={ackOpen}
        onClose={() => setAckOpen(false)}
        title="Acknowledge Order"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Pick the warehouse that will fulfill this order. The merchant will
            see where their shipment is coming from.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Fulfillment warehouse
            </label>
            <select
              value={pickedWarehouseId}
              onChange={(e) => setPickedWarehouseId(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            >
              <option value="">Use default</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.isDefault ? " (default)" : ""}
                  {w.city ? ` — ${w.city}${w.province ? `, ${w.province}` : ""}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setAckOpen(false)}>
              Cancel
            </Button>
            <Button
              icon="solar:check-circle-bold"
              disabled={running === "acknowledge"}
              onClick={() =>
                runAction("acknowledge", {
                  warehouseId: pickedWarehouseId || undefined,
                })
              }
            >
              {running === "acknowledge" ? "Acknowledging…" : "Acknowledge"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Phase D #76: Reassign warehouse (post-ack, pre-delivered). */}
      <Modal
        isOpen={reassignOpen}
        onClose={() => setReassignOpen(false)}
        title="Change Fulfillment Warehouse"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Reassign this order to a different warehouse. The merchant sees the
            change immediately.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Warehouse
            </label>
            <select
              value={pickedWarehouseId}
              onChange={(e) => setPickedWarehouseId(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            >
              <option value="">Select warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.isDefault ? " (default)" : ""}
                  {w.city ? ` — ${w.city}${w.province ? `, ${w.province}` : ""}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setReassignOpen(false)}>
              Cancel
            </Button>
            <Button
              icon="solar:box-linear"
              disabled={running === "reassignWarehouse" || !pickedWarehouseId}
              onClick={() =>
                runAction("reassignWarehouse", { warehouseId: pickedWarehouseId })
              }
            >
              {running === "reassignWarehouse" ? "Updating…" : "Update Warehouse"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
