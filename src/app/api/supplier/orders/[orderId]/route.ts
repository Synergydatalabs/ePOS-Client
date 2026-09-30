// GET  /api/supplier/orders/[orderId] — full PO detail
// POST /api/supplier/orders/[orderId] — state transitions
//
// The POST body's `action` drives which transition to run. One endpoint
// instead of four sub-routes (/acknowledge, /ship, /deliver, /cancel) —
// the state machine is small enough that consolidating keeps the auth /
// ownership / validation logic in one place.
//
// Body: {
//   action: "acknowledge" | "ship" | "deliver" | "cancel",
//   notes?: string,                       // any action → notes_from_supplier
//   shipmentCarrier?: string,             // ship
//   shipmentTrackingRef?: string,         // ship
//   expectedDeliveryAt?: string (ISO),    // ship
//   cancellationReason?: string,          // cancel (required)
// }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { PurchaseOrderStatus } from "@prisma/client";
import {
  syncPurchaseOrderInventory,
  type SyncResult,
} from "@/lib/marketplace-inventory-sync";
import {
  notifyPoAcknowledged,
  notifyPoShipped,
  notifyPoDelivered,
  notifyPoCancelled,
} from "@/lib/marketplace-notify";

// Legal transitions FROM current status. Merchant-side transitions live in
// task #61 (SHIPPED → DELIVERED confirmation); supplier-side is everything
// below.
//
// Phase D #76: `reassignWarehouse` is a NON-transitional action — status
// doesn't move, only the warehouse assignment changes. Allowed while the
// PO is still on the supplier's side (SUBMITTED / ACKNOWLEDGED / SHIPPED).
const ALLOWED_FROM: Record<
  string,
  ("acknowledge" | "ship" | "deliver" | "cancel" | "reassignWarehouse")[]
> = {
  SUBMITTED:    ["acknowledge", "cancel", "reassignWarehouse"],
  ACKNOWLEDGED: ["ship", "cancel", "reassignWarehouse"],
  SHIPPED:      ["deliver", "reassignWarehouse"],
  DELIVERED:    [],
  CANCELLED:    [],
};

// --- helpers ---------------------------------------------------------------

async function loadOwnedOrder(supplierTenantId: string, orderId: string) {
  return prisma.purchaseOrder.findFirst({
    where: { id: orderId, supplierTenantId },
  });
}

// --- GET -------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { orderId } = await params;

    const order = await prisma.purchaseOrder.findFirst({
      where: { id: orderId, supplierTenantId: auth.tenant.id },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        merchantTenant: { select: { id: true, name: true } },
        // Phase D #76: expose the assigned warehouse.
        warehouse: {
          select: {
            id: true,
            name: true,
            city: true,
            province: true,
            country: true,
          },
        },
        // We don't join Location — the shipping snapshot on the PO row is
        // the source of truth (frozen at submit). Live location data isn't
        // relevant to a supplier fulfilling this specific order.
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error("[SUPPLIER-ORDER] GET error:", error);
    return NextResponse.json({ error: "Failed to load order" }, { status: 500 });
  }
}

// --- POST (transitions) ----------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { orderId } = await params;

    const order = await loadOwnedOrder(auth.tenant.id, orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const body = await request.json();
    const action: string = body.action;

    if (!["acknowledge", "ship", "deliver", "cancel", "reassignWarehouse"].includes(action)) {
      return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
    }

    // Guard the state machine — any transition not in ALLOWED_FROM for the
    // current status gets a clean 409 rather than silently no-op'ing.
    const allowed = ALLOWED_FROM[order.status] || [];
    if (!allowed.includes(action as any)) {
      return NextResponse.json(
        {
          error: `Cannot ${action} an order that is ${order.status}`,
          currentStatus: order.status,
          allowedActions: allowed,
        },
        { status: 409 }
      );
    }

    const notes = typeof body.notes === "string" ? body.notes.trim() || null : undefined;

    let data: any = {};
    let newStatus: PurchaseOrderStatus;

    switch (action) {
      case "acknowledge": {
        newStatus = "ACKNOWLEDGED";
        data = {
          status: newStatus,
          acknowledgedAt: new Date(),
        };
        // Phase D #76: optionally assign a warehouse at ack. If missing,
        // fall back to the supplier's default warehouse (if one exists).
        // Validated against ownership + isActive.
        const rawWhId = typeof body.warehouseId === "string" ? body.warehouseId : null;
        if (rawWhId) {
          const wh = await prisma.supplierWarehouse.findFirst({
            where: { id: rawWhId, supplierTenantId: auth.tenant.id, isActive: true },
            select: { id: true },
          });
          if (!wh) {
            return NextResponse.json(
              { error: "Selected warehouse not found or inactive" },
              { status: 400 }
            );
          }
          data.warehouseId = wh.id;
        } else {
          const defaultWh = await prisma.supplierWarehouse.findFirst({
            where: { supplierTenantId: auth.tenant.id, isDefault: true, isActive: true },
            select: { id: true },
          });
          if (defaultWh) data.warehouseId = defaultWh.id;
        }
        break;
      }

      case "ship": {
        newStatus = "SHIPPED";
        const carrier = body.shipmentCarrier?.trim() || null;
        const trackingRef = body.shipmentTrackingRef?.trim() || null;
        // Carrier + tracking are optional — some suppliers use their own
        // delivery van and neither field applies. Validating a light touch:
        // if tracking is set, carrier is strongly recommended but not
        // required (the row can still show useful info).
        let expectedDeliveryAt: Date | null = null;
        if (body.expectedDeliveryAt) {
          const parsed = new Date(body.expectedDeliveryAt);
          if (!isFinite(parsed.getTime())) {
            return NextResponse.json(
              { error: "expectedDeliveryAt must be a valid ISO date" },
              { status: 400 }
            );
          }
          expectedDeliveryAt = parsed;
        }
        data = {
          status: newStatus,
          shippedAt: new Date(),
          shipmentCarrier: carrier,
          shipmentTrackingRef: trackingRef,
          expectedDeliveryAt,
        };
        break;
      }

      case "deliver": {
        // Supplier-side "deliver" is for hand-delivery scenarios (the
        // supplier just handed goods to the merchant in person). The
        // merchant-side confirm-receipt in task #61 will hit the same
        // transition — we accept both sides.
        newStatus = "DELIVERED";
        data = {
          status: newStatus,
          deliveredAt: new Date(),
        };
        break;
      }

      case "reassignWarehouse": {
        // Non-transitional: only warehouseId changes. Status stays put.
        const rawWhId = typeof body.warehouseId === "string" ? body.warehouseId : null;
        if (!rawWhId) {
          return NextResponse.json(
            { error: "warehouseId is required" },
            { status: 400 }
          );
        }
        const wh = await prisma.supplierWarehouse.findFirst({
          where: { id: rawWhId, supplierTenantId: auth.tenant.id, isActive: true },
          select: { id: true },
        });
        if (!wh) {
          return NextResponse.json(
            { error: "Selected warehouse not found or inactive" },
            { status: 400 }
          );
        }
        newStatus = order.status as PurchaseOrderStatus;
        data = { warehouseId: wh.id };
        break;
      }

      case "cancel": {
        // Requiring a reason is a small UX ask that pays off in support
        // conversations later — every cancelled PO has a paper trail of why.
        const reason = body.cancellationReason?.trim();
        if (!reason) {
          return NextResponse.json(
            { error: "Please provide a cancellation reason" },
            { status: 400 }
          );
        }
        newStatus = "CANCELLED";
        data = {
          status: newStatus,
          cancelledAt: new Date(),
          cancellationReason: reason,
          cancelledByMembershipId: auth.session.memberId,
        };
        break;
      }

      default:
        // Unreachable — action was validated above.
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Notes from supplier — apply on ANY transition if provided. Appended
    // when there's already text so a supplier can add context across
    // multiple state changes without overwriting earlier notes.
    if (notes !== undefined && notes !== null) {
      const prior = order.notesFromSupplier?.trim();
      data.notesFromSupplier = prior ? `${prior}\n\n${notes}` : notes;
    }

    // On DELIVERED (supplier-side hand-delivery path) we run the SAME
    // side effects as the merchant confirm-receipt path — relationship
    // counters + inventory sync. Otherwise both sides of the transition
    // would produce different final state, which would be confusing.
    let syncResult: SyncResult | null = null;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.purchaseOrder.update({
        where: { id: orderId },
        data,
        include: {
          items: { orderBy: { createdAt: "asc" } },
          merchantTenant: { select: { id: true, name: true } },
          warehouse: {
            select: {
              id: true,
              name: true,
              city: true,
              province: true,
              country: true,
            },
          },
        },
      });

      if (newStatus === "DELIVERED") {
        const now = new Date();
        await tx.supplierMerchantRelationship.updateMany({
          where: {
            supplierTenantId: order.supplierTenantId,
            merchantTenantId: order.merchantTenantId,
          },
          data: {
            totalOrders: { increment: 1 },
            totalSpentCents: { increment: order.totalCents },
            lastOrderAt: now,
          },
        });
        await tx.supplierMerchantRelationship.updateMany({
          where: {
            supplierTenantId: order.supplierTenantId,
            merchantTenantId: order.merchantTenantId,
            firstOrderAt: null,
          },
          data: { firstOrderAt: now },
        });

        syncResult = await syncPurchaseOrderInventory(
          tx,
          {
            id: u.id,
            poNumber: u.poNumber,
            merchantTenantId: u.merchantTenantId,
            merchantLocationId: u.merchantLocationId,
            items: u.items.map((it) => ({
              id: it.id,
              productSku: it.productSku,
              productName: it.productName,
              qty: it.qty,
            })),
          },
          // performed_by attribution — the supplier's membership id, not the
          // merchant's, because a supplier triggered this transition.
          auth.session.memberId
        );
      }

      return u;
    });

    console.log(
      `[SUPPLIER-ORDER] ${order.poNumber}: ${order.status} → ${newStatus} (by supplier ${auth.tenant.id})`
    );

    // Fire-and-forget notification to the merchant (or supplier on cancel).
    // Uses names we already have in scope — supplier tenant comes from auth,
    // merchant name from the include on `updated`. All safeSend'd inside the
    // notify helpers so failures don't affect the response.
    const supplierName = auth.tenant.name;
    const merchantName = updated.merchantTenant.name;
    const poCtx = {
      id: updated.id,
      poNumber: updated.poNumber,
      supplierTenantId: updated.supplierTenantId,
      merchantTenantId: updated.merchantTenantId,
    };
    if (action === "acknowledge") {
      notifyPoAcknowledged({
        ...poCtx,
        supplierTenantName: supplierName,
      });
    } else if (action === "ship") {
      notifyPoShipped({
        ...poCtx,
        supplierTenantName: supplierName,
        shipmentCarrier: updated.shipmentCarrier,
        shipmentTrackingRef: updated.shipmentTrackingRef,
        expectedDeliveryAt: updated.expectedDeliveryAt,
      });
    } else if (action === "deliver") {
      notifyPoDelivered({
        ...poCtx,
        merchantTenantName: merchantName,
      });
    } else if (action === "cancel") {
      notifyPoCancelled({
        ...poCtx,
        cancelledBy: "supplier",
        merchantTenantName: merchantName,
        supplierTenantName: supplierName,
        cancellationReason: updated.cancellationReason || "No reason provided",
      });
    }

    return NextResponse.json({
      success: true,
      order: updated,
      // syncResult is null unless the transition was DELIVERED — matches
      // the merchant-side endpoint's response shape.
      inventorySync: syncResult,
    });
  } catch (error: any) {
    console.error("[SUPPLIER-ORDER] POST error:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}
