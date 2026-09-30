// GET  /api/tenants/[tenantId]/marketplace/orders/[orderId] — full PO detail
// POST /api/tenants/[tenantId]/marketplace/orders/[orderId] — merchant-side
// state transitions (cancel, confirm receipt)
//
// Mirror of the supplier-side detail+transitions endpoint, but with the
// merchant's allowed action set. Two side effects on transition to
// DELIVERED (whether triggered here or from the supplier side later —
// this file only handles this side):
//   1. SupplierMerchantRelationship counters incremented (total_orders,
//      total_spent_cents, first_order_at, last_order_at)
//   2. Inventory sync (#62) will hook the same point in a follow-up task

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { PurchaseOrderStatus } from "@prisma/client";
import {
  syncPurchaseOrderInventory,
  type SyncResult,
} from "@/lib/marketplace-inventory-sync";
import {
  notifyPoDelivered,
  notifyPoCancelled,
} from "@/lib/marketplace-notify";

// Legal merchant-side transitions from each status. Supplier-side has
// its own table in the supplier route — the two together fully describe
// the state machine.
const ALLOWED_FROM: Record<string, ("cancel" | "confirmReceipt")[]> = {
  SUBMITTED:    ["cancel"],
  ACKNOWLEDGED: ["cancel"],   // can still cancel while supplier hasn't shipped
  SHIPPED:      ["confirmReceipt"],
  DELIVERED:    [],
  CANCELLED:    [],
};

async function loadOwnedOrder(merchantTenantId: string, orderId: string) {
  return prisma.purchaseOrder.findFirst({
    where: { id: orderId, merchantTenantId },
  });
}

// --- GET -------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const order = await prisma.purchaseOrder.findFirst({
      where: { id: orderId, merchantTenantId: tenantId },
      include: {
        items: { orderBy: { createdAt: "asc" } },
        supplierTenant: {
          select: {
            id: true,
            name: true,
            supplierProfile: {
              select: {
                displayName: true,
                contactEmail: true,
                contactPhone: true,
              },
            },
          },
        },
        merchantLocation: {
          select: { id: true, name: true },
        },
        // Phase D #76: fulfillment warehouse (null for pre-multi-wh POs).
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

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      order: {
        ...order,
        supplierName:
          order.supplierTenant.supplierProfile?.displayName ||
          order.supplierTenant.name,
        supplierContact: {
          email: order.supplierTenant.supplierProfile?.contactEmail || null,
          phone: order.supplierTenant.supplierProfile?.contactPhone || null,
        },
      },
    });
  } catch (error: any) {
    console.error("[MERCHANT-ORDER] GET error:", error);
    return NextResponse.json({ error: "Failed to load order" }, { status: 500 });
  }
}

// --- POST (transitions) ----------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const order = await loadOwnedOrder(tenantId, orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const body = await request.json();
    const action: string = body.action;

    if (!["cancel", "confirmReceipt"].includes(action)) {
      return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
    }

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

    let newStatus: PurchaseOrderStatus;
    let data: any = {};

    if (action === "cancel") {
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
        cancelledByMembershipId: auth.context.membership.id,
      };
    } else {
      // confirmReceipt: SHIPPED → DELIVERED
      newStatus = "DELIVERED";
      data = {
        status: newStatus,
        deliveredAt: new Date(),
      };
    }

    // Merchant-side notes append to notesToSupplier so the supplier sees
    // context on a cancel or a receipt confirmation. Keeps the original
    // note intact rather than overwriting it.
    if (notes !== undefined && notes !== null) {
      const prior = order.notesToSupplier?.trim();
      data.notesToSupplier = prior ? `${prior}\n\n${notes}` : notes;
    }

    // Transaction because on DELIVERED we run three side-effects together:
    // status change + relationship counter bump + inventory sync. All-or-
    // nothing — if the sync errors, we don't leave a "delivered" PO with
    // no stock movement.
    let syncResult: SyncResult | null = null;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.purchaseOrder.update({
        where: { id: orderId },
        data,
        include: {
          items: { orderBy: { createdAt: "asc" } },
          supplierTenant: {
            select: {
              id: true,
              name: true,
              supplierProfile: {
                select: {
                  displayName: true,
                  contactEmail: true,
                  contactPhone: true,
                },
              },
            },
          },
          merchantLocation: { select: { id: true, name: true } },
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
        // Find or create the relationship — normally exists (a PO can't
        // be placed without one) but we double-check. All counters live
        // on this row; the marketplace supplier cards read them for
        // "N past orders" / "$X spent".
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

        // firstOrderAt is nullable + set only once. Setting it separately
        // so we don't blindly overwrite an existing value on re-transitions
        // (belt-and-braces: the state guard above already prevents that).
        await tx.supplierMerchantRelationship.updateMany({
          where: {
            supplierTenantId: order.supplierTenantId,
            merchantTenantId: order.merchantTenantId,
            firstOrderAt: null,
          },
          data: { firstOrderAt: now },
        });

        // Phase B #62: auto-add received stock to the merchant's
        // ingredient inventory. Matches PO line items to Ingredients by
        // supplierSku; unmatched items are surfaced in syncResult.
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
          auth.context.membership.id
        );
      }

      return u;
    });

    console.log(
      `[MERCHANT-ORDER] ${order.poNumber}: ${order.status} → ${newStatus} (by merchant ${tenantId})`
    );

    // Fire-and-forget notification to the supplier. Merchant name comes
    // from the current tenant lookup (we already have merchantTenantId);
    // supplier display name comes from the updated PO's include.
    const merchantTenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const supplierName =
      updated.supplierTenant.supplierProfile?.displayName ||
      updated.supplierTenant.name;
    const merchantName = merchantTenant?.name || "The merchant";
    const poCtx = {
      id: updated.id,
      poNumber: updated.poNumber,
      supplierTenantId: updated.supplierTenantId,
      merchantTenantId: updated.merchantTenantId,
    };
    if (action === "confirmReceipt") {
      notifyPoDelivered({
        ...poCtx,
        merchantTenantName: merchantName,
      });
    } else if (action === "cancel") {
      notifyPoCancelled({
        ...poCtx,
        cancelledBy: "merchant",
        merchantTenantName: merchantName,
        supplierTenantName: supplierName,
        cancellationReason: updated.cancellationReason || "No reason provided",
      });
    }

    return NextResponse.json({
      success: true,
      order: {
        ...updated,
        supplierName:
          updated.supplierTenant.supplierProfile?.displayName ||
          updated.supplierTenant.name,
        supplierContact: {
          email: updated.supplierTenant.supplierProfile?.contactEmail || null,
          phone: updated.supplierTenant.supplierProfile?.contactPhone || null,
        },
      },
      // Only present on DELIVERED transitions — surfaces which line items
      // auto-linked to ingredients and which were skipped so the merchant
      // can fix their inventory links.
      inventorySync: syncResult,
    });
  } catch (error: any) {
    console.error("[MERCHANT-ORDER] POST error:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}
