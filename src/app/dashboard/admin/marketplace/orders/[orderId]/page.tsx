"use client";

// Merchant's view of one PO they placed. Mirror of the supplier-side detail
// page — same layout, same timeline, but with merchant-side actions:
//   SUBMITTED / ACKNOWLEDGED  → Cancel Order
//   SHIPPED                    → Confirm Receipt (SHIPPED → DELIVERED)
//   DELIVERED / CANCELLED     → terminal, no actions

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Modal } from "@/components/ui";
import PoMessageThread from "@/components/marketplace/PoMessageThread";

type Status = "SUBMITTED" | "ACKNOWLEDGED" | "SHIPPED" | "DELIVERED" | "CANCELLED";
type PaymentStatus = "UNPAID" | "PENDING" | "PAID" | "FAILED" | "REFUNDED";

interface OrderItem {
  id: string;
  productName: string;
  productSku: string | null;
  // Phase D #72: variant snapshot on the line item. Both null for
  // simple-product orders + legacy PO items pre-Phase D.
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
  supplierTenant: { id: string; name: string };
  supplierName: string;
  supplierContact: { email: string | null; phone: string | null };
  merchantLocation: { id: string; name: string } | null;
  // Phase D #76 (2026-07-31): fulfillment warehouse. Null pre-Phase-D or
  // when the supplier hasn't set one.
  warehouse: {
    id: string;
    name: string;
    city: string | null;
    province: string | null;
    country: string;
  } | null;
  items: OrderItem[];
  // Phase C #67 (2026-07-30): payment link + status
  paymentStatus: PaymentStatus;
  paymentLinkUrl: string | null;
  paymentLinkReference: string | null;
  paymentLinkExpiresAt: string | null;
  paymentLinkFailureNote: string | null;
  paidAt: string | null;
  paidAmountCents: number | null;
  paidMethod: string | null;
}

const PAYMENT_STATUS_STYLES: Record<PaymentStatus, { bg: string; text: string; label: string }> = {
  UNPAID:   { bg: "bg-slate-100",   text: "text-slate-700",   label: "Unpaid" },
  PENDING:  { bg: "bg-blue-100",    text: "text-blue-800",    label: "Payment pending" },
  PAID:     { bg: "bg-emerald-100", text: "text-emerald-800", label: "Paid" },
  FAILED:   { bg: "bg-red-100",     text: "text-red-800",     label: "Payment failed" },
  REFUNDED: { bg: "bg-amber-100",   text: "text-amber-900",   label: "Refunded" },
};

const STATUS_STYLES: Record<Status, { bg: string; text: string; label: string }> = {
  SUBMITTED:    { bg: "bg-blue-100",    text: "text-blue-800",    label: "Awaiting supplier" },
  ACKNOWLEDGED: { bg: "bg-indigo-100",  text: "text-indigo-800",  label: "Acknowledged" },
  SHIPPED:      { bg: "bg-amber-100",   text: "text-amber-800",   label: "In transit" },
  DELIVERED:    { bg: "bg-emerald-100", text: "text-emerald-800", label: "Delivered" },
  CANCELLED:    { bg: "bg-gray-200",    text: "text-gray-700",    label: "Cancelled" },
};

export default function MerchantOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const router = useRouter();

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmNotes, setConfirmNotes] = useState("");

  const [running, setRunning] = useState<null | "cancel" | "confirmReceipt">(null);

  // After a successful confirm-receipt we show a modal that summarizes what
  // was auto-added to inventory (and which line items were skipped because
  // no matching Ingredient supplier SKU existed). Merchant can fix links
  // right after — most-relevant moment for that nudge.
  const [syncResultModal, setSyncResultModal] = useState<{
    synced: { ingredientName: string; qtyAdded: number; newStock: number }[];
    skipped: { productName: string; productSku: string | null; reason: string }[];
  } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const load = () => {
    if (!tenantId) return;
    fetch(`/api/tenants/${tenantId}/marketplace/orders/${orderId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setOrder(data.order);
        else {
          toast.error(data.error || "Order not found");
          router.replace("/dashboard/admin/marketplace/orders");
        }
      })
      .catch(() => toast.error("Failed to load order"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, orderId]);

  const runAction = async (
    action: "cancel" | "confirmReceipt",
    extra: Record<string, unknown> = {}
  ) => {
    if (!tenantId) return;
    setRunning(action);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/marketplace/orders/${orderId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Update failed");
        return;
      }
      setOrder(data.order);
      toast.success(
        action === "cancel" ? "Order cancelled" : "Delivery confirmed — thanks!"
      );
      setCancelOpen(false);
      setConfirmOpen(false);

      // Only show the inventory-sync summary when there was one (i.e.
      // this was a confirmReceipt) — a bare "0 synced, 0 skipped" would
      // be noise on a cancel.
      if (action === "confirmReceipt" && data.inventorySync) {
        setSyncResultModal({
          synced: data.inventorySync.syncedItems.map((s: any) => ({
            ingredientName: s.ingredientName,
            qtyAdded: s.qtyAdded,
            newStock: s.newStock,
          })),
          skipped: data.inventorySync.skippedItems.map((s: any) => ({
            productName: s.productName,
            productSku: s.productSku,
            reason: s.reason,
          })),
        });
      }
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

  if (loading || !tenantId) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
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
  const addrLines = [
    addr.address,
    [addr.city, addr.province, addr.postalCode].filter(Boolean).join(", "),
    addr.country,
  ].filter(Boolean);

  const timeline = [
    { label: "Submitted", at: order.submittedAt, icon: "solar:mailbox-linear" },
    order.acknowledgedAt && { label: "Acknowledged", at: order.acknowledgedAt, icon: "solar:check-circle-linear" },
    order.shippedAt && { label: "Shipped", at: order.shippedAt, icon: "solar:box-linear" },
    order.deliveredAt && { label: "Delivered", at: order.deliveredAt, icon: "solar:archive-check-linear" },
    order.cancelledAt && { label: "Cancelled", at: order.cancelledAt, icon: "solar:close-circle-linear" },
  ].filter(Boolean) as { label: string; at: string; icon: string }[];

  return (
    <div>
      <AdminHeader
        title={order.poNumber}
        subtitle={
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/dashboard/admin/marketplace" className="text-indigo-600 hover:underline">
              Marketplace
            </Link>
            <Icon icon="solar:alt-arrow-right-linear" className="w-3.5 h-3.5" />
            <Link href="/dashboard/admin/marketplace/orders" className="text-indigo-600 hover:underline">
              Orders
            </Link>
            <Icon icon="solar:alt-arrow-right-linear" className="w-3.5 h-3.5" />
            <span>{order.poNumber}</span>
          </div>
        }
      />

      <div className="p-6 max-w-4xl mx-auto pb-24">
        {/* Status chip + supplier line */}
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-semibold ${s.bg} ${s.text}`}
          >
            {s.label}
          </span>
          <span className="text-sm text-gray-600">
            To{" "}
            <Link
              href={`/dashboard/admin/marketplace/${order.supplierTenant.id}`}
              className="font-medium text-indigo-600 hover:underline"
            >
              {order.supplierName}
            </Link>
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* MAIN — timeline, items, notes */}
          <div className="lg:col-span-2 space-y-6">
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
              <div className="p-4 border-b border-gray-100">
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

            {(order.notesToSupplier || order.notesFromSupplier) && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                {order.notesToSupplier && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Your notes
                    </h3>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {order.notesToSupplier}
                    </p>
                  </div>
                )}
                {order.notesFromSupplier && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      From supplier
                    </h3>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {order.notesFromSupplier}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Phase D #74: in-app messaging with the supplier */}
            {tenantId && (
              <PoMessageThread
                viewerSide="MERCHANT"
                threadUrl={`/api/tenants/${tenantId}/marketplace/orders/${orderId}/messages`}
                readUrl={`/api/tenants/${tenantId}/marketplace/orders/${orderId}/messages/read`}
              />
            )}
          </div>

          {/* SIDE */}
          <div className="space-y-6">
            {/* Phase C #67 (2026-07-30): Pay with card — most prominent when
                a payment link exists and PO isn't yet paid. Shows QR + copy
                link + open button. Merchants can share the same link/QR to
                whoever pays on their side (AP, owner, etc.). */}
            <PaymentCard order={order} money={money} />

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

            {/* Phase D #76: fulfillment warehouse. Shown as soon as
                the supplier acknowledges (they pick one at ack), so the
                merchant knows where the goods are coming from and can
                estimate transit. Independent from the Shipment card
                below which is set at the SHIPPED transition. */}
            {order.warehouse && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Ships from
                </h3>
                <p className="text-sm text-gray-900 font-semibold">
                  {order.warehouse.name}
                </p>
                {(order.warehouse.city || order.warehouse.province) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[order.warehouse.city, order.warehouse.province, order.warehouse.country]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
              </div>
            )}

            {(order.status === "SHIPPED" || order.status === "DELIVERED") && (
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
            )}

            {(order.supplierContact.email || order.supplierContact.phone) && (
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Supplier contact
                </h3>
                {order.supplierContact.email && (
                  <a
                    href={`mailto:${order.supplierContact.email}`}
                    className="flex items-center gap-2 text-sm text-gray-700 hover:text-indigo-600 py-1"
                  >
                    <Icon icon="solar:letter-linear" className="w-4 h-4" />
                    {order.supplierContact.email}
                  </a>
                )}
                {order.supplierContact.phone && (
                  <a
                    href={`tel:${order.supplierContact.phone}`}
                    className="flex items-center gap-2 text-sm text-gray-700 hover:text-indigo-600 py-1"
                  >
                    <Icon icon="solar:phone-linear" className="w-4 h-4" />
                    {order.supplierContact.phone}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky action bar */}
      {(order.status === "SUBMITTED" ||
        order.status === "ACKNOWLEDGED" ||
        order.status === "SHIPPED") && (
        <div className="fixed bottom-0 left-0 lg:left-64 right-0 bg-white border-t border-gray-200 px-6 py-3 flex justify-end gap-3 z-30">
          {(order.status === "SUBMITTED" || order.status === "ACKNOWLEDGED") && (
            <Button
              variant="secondary"
              onClick={() => setCancelOpen(true)}
              disabled={!!running}
            >
              Cancel Order
            </Button>
          )}
          {order.status === "SHIPPED" && (
            <Button
              icon="solar:archive-check-bold"
              onClick={() => setConfirmOpen(true)}
              disabled={!!running}
            >
              Confirm Receipt
            </Button>
          )}
        </div>
      )}

      {/* Cancel modal */}
      <Modal isOpen={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel Order" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Cancelling notifies the supplier immediately. Share a reason so they understand
            what happened.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Wrong location, changed our minds, duplicate order"
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

      {/* Inventory sync results — shown after a successful confirm-receipt.
          Green tick section for auto-linked ingredients, amber warning list
          for anything the sync couldn't match. Links merchant back to the
          Ingredients page to fix any missing supplier-SKU links. */}
      <Modal
        isOpen={!!syncResultModal}
        onClose={() => setSyncResultModal(null)}
        title="Inventory Updated"
        size="md"
      >
        {syncResultModal && (
          <div className="space-y-4">
            {syncResultModal.synced.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-semibold text-gray-900">
                    Added to your inventory ({syncResultModal.synced.length})
                  </h3>
                </div>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  {syncResultModal.synced.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-4 py-2.5 text-sm border-b border-gray-100 last:border-b-0"
                    >
                      <span className="text-gray-900 truncate">{s.ingredientName}</span>
                      <div className="text-right flex-shrink-0 ml-3">
                        <span className="text-emerald-700 font-semibold">
                          +{s.qtyAdded}
                        </span>
                        <span className="text-xs text-gray-500 ml-2">
                          (now {s.newStock})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {syncResultModal.skipped.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-amber-500" />
                  <h3 className="font-semibold text-gray-900">
                    Not linked ({syncResultModal.skipped.length})
                  </h3>
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  These items came in but couldn't be auto-added because no
                  Ingredient in your inventory has a matching supplier SKU.
                  Add them manually or set the supplier SKU on the matching
                  Ingredient — future deliveries will then auto-sync.
                </p>
                <div className="border border-amber-100 bg-amber-50/40 rounded-xl overflow-hidden">
                  {syncResultModal.skipped.map((s, i) => (
                    <div
                      key={i}
                      className="px-4 py-2.5 text-sm border-b border-amber-100 last:border-b-0"
                    >
                      <p className="font-medium text-gray-900 truncate">{s.productName}</p>
                      <p className="text-xs text-gray-600">
                        {s.productSku ? `SKU: ${s.productSku}` : "No SKU on this item"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {syncResultModal.synced.length === 0 &&
              syncResultModal.skipped.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No line items to sync.
                </p>
              )}

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              {syncResultModal.skipped.length > 0 && (
                <Link
                  href="/dashboard/admin/inventory/ingredients"
                  className="px-4 py-2 rounded-xl text-indigo-700 border border-indigo-200 hover:bg-indigo-50 text-sm font-medium inline-flex items-center gap-1.5"
                >
                  <Icon icon="solar:box-linear" className="w-4 h-4" />
                  Go to Ingredients
                </Link>
              )}
              <Button onClick={() => setSyncResultModal(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm receipt modal */}
      <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm Receipt" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Confirming that the shipment arrived — this marks the order as{" "}
            <strong>Delivered</strong> and closes the loop with the supplier.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Note to supplier (optional)
            </label>
            <textarea
              rows={3}
              value={confirmNotes}
              onChange={(e) => setConfirmNotes(e.target.value)}
              placeholder="e.g. Arrived on time, great condition. Thanks!"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              icon="solar:archive-check-bold"
              disabled={running === "confirmReceipt"}
              onClick={() =>
                runAction("confirmReceipt", {
                  notes: confirmNotes.trim() || undefined,
                })
              }
            >
              {running === "confirmReceipt" ? "Confirming…" : "Confirm Delivered"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------- Payment card (merchant side) ----------
// Separate component to keep the main page focused. Renders based on the
// combination of payment_status + payment_link_url presence:
//   - PAID → success card with receipt info
//   - Link present, unpaid, not expired → QR + link + Open Payment button
//   - Link generation failed → banner showing the reason + "off-platform" hint
//   - No link at all → gentle "off-platform payment" card

function PaymentCard({
  order,
  money,
}: {
  order: Order;
  money: (cents: number) => string;
}) {
  const style = PAYMENT_STATUS_STYLES[order.paymentStatus];
  const linkExpired =
    order.paymentLinkExpiresAt != null &&
    new Date(order.paymentLinkExpiresAt) < new Date();

  const copyLink = async () => {
    if (!order.paymentLinkUrl) return;
    try {
      await navigator.clipboard.writeText(order.paymentLinkUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy — copy from the field manually");
    }
  };

  // ----- PAID -----
  if (order.paymentStatus === "PAID") {
    return (
      <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-2xl border border-emerald-200 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-emerald-600" />
          <h3 className="font-bold text-emerald-900">Paid</h3>
        </div>
        {order.paidAt && (
          <p className="text-xs text-emerald-800 mb-3">
            {new Date(order.paidAt).toLocaleString()}
          </p>
        )}
        <div className="space-y-1 text-sm">
          {order.paidAmountCents != null && (
            <div className="flex justify-between">
              <span className="text-emerald-800">Amount</span>
              <span className="font-semibold text-emerald-900">
                {money(order.paidAmountCents)}
              </span>
            </div>
          )}
          {order.paidMethod && (
            <div className="flex justify-between">
              <span className="text-emerald-800">Method</span>
              <span className="text-emerald-900">{order.paidMethod}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----- Link generation failed -----
  if (!order.paymentLinkUrl && order.paymentLinkFailureNote) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Icon icon="solar:danger-triangle-linear" className="w-5 h-5 text-amber-600" />
          <h3 className="font-semibold text-gray-900">Payment link unavailable</h3>
        </div>
        <p className="text-sm text-gray-600 mb-3">
          We couldn't generate a payment link for this PO. Contact the supplier
          to arrange payment off-platform (bank transfer, cheque, etc.).
        </p>
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 font-mono whitespace-pre-wrap">{order.paymentLinkFailureNote}</p>
        </details>
      </div>
    );
  }

  // ----- No link + no failure = supplier has no active gateway -----
  if (!order.paymentLinkUrl) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Icon icon="solar:wallet-linear" className="w-5 h-5 text-gray-500" />
          <h3 className="font-semibold text-gray-900">Off-platform payment</h3>
        </div>
        <p className="text-sm text-gray-600">
          This supplier hasn't set up card payments through iTap yet. Pay them
          directly via bank transfer, cheque, or your usual channel.
        </p>
      </div>
    );
  }

  // ----- Link expired -----
  if (linkExpired) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Icon icon="solar:clock-circle-linear" className="w-5 h-5 text-amber-600" />
          <h3 className="font-semibold text-gray-900">Payment link expired</h3>
        </div>
        <p className="text-sm text-gray-600">
          Ask the supplier to regenerate the payment link, or pay off-platform.
        </p>
      </div>
    );
  }

  // ----- Active link — show QR + link + open button -----
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-900">Pay with card</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.bg} ${style.text}`}>
          {style.label}
        </span>
      </div>

      {/* QR — client-side SVG generation, no external calls */}
      <div className="flex justify-center mb-4">
        <div className="p-3 rounded-xl bg-white border border-gray-200">
          <QRCodeSVG
            value={order.paymentLinkUrl}
            size={160}
            level="M"
            includeMargin={false}
          />
        </div>
      </div>

      <p className="text-xs text-gray-500 text-center mb-4">
        Scan to pay, or share the link below.
      </p>

      {/* Link + copy */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          readOnly
          value={order.paymentLinkUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono bg-gray-50 text-gray-700 truncate"
        />
        <button
          onClick={copyLink}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 flex-shrink-0"
          title="Copy link"
        >
          <Icon icon="solar:copy-linear" className="w-4 h-4" />
        </button>
      </div>

      <a
        href={order.paymentLinkUrl}
        target="_blank"
        rel="noreferrer"
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
      >
        <Icon icon="solar:arrow-right-up-linear" className="w-4 h-4" />
        Open Payment Page
      </a>

      {order.paymentLinkExpiresAt && (
        <p className="text-xs text-gray-400 text-center mt-3">
          Link expires {new Date(order.paymentLinkExpiresAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
