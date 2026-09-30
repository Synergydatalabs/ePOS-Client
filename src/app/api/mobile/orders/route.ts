// /api/mobile/orders
//
// POST — create a NEW draft order (empty, items added via the subroute)
// GET  — list orders for the current location, optionally filtered
//
// Design note: unlike the web POS create endpoint which optionally accepts
// items in the body, we keep mobile creation deliberately empty. The
// order-type modal → cart → add-item UX benefits from an explicit two-step
// pattern (open order first, then add items as the operator taps tiles).
// It also means the "open orders" list picks up in-progress orders
// naturally as soon as they're created, which powers the "resume" flow.

import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

// -- helpers -----------------------------------------------------------------

async function nextOrderNumber(
  tenantId: string,
  locationId: string
): Promise<{ orderNumber: string; displayNumber: number }> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { orderNumberReset: true },
  });
  const today = format(new Date(), "yyyyMMdd");

  if (settings?.orderNumberReset === "DAILY") {
    const count = await prisma.order.count({
      where: {
        locationId,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    });
    const displayNumber = count + 1;
    return {
      orderNumber: `ORD-${today}-${String(displayNumber).padStart(4, "0")}`,
      displayNumber,
    };
  }
  const last = await prisma.order.findFirst({
    where: { locationId },
    orderBy: { displayNumber: "desc" },
    select: { displayNumber: true },
  });
  const displayNumber = (last?.displayNumber || 0) + 1;
  return {
    orderNumber: `ORD-${today}-${String(displayNumber).padStart(6, "0")}`,
    displayNumber,
  };
}

function serializeOrder(order: any) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    displayNumber: order.displayNumber,
    orderType: order.orderType,
    status: order.status,
    paymentStatus: order.paymentStatus,
    tableId: order.tableId,
    // A6 (2026-08-18): mobile cart chip shows "Table 5" so include the
    // human-readable number/name on the order response.
    tableNumber: order.table?.tableNumber ?? null,
    tableName: order.table?.name ?? null,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    taxAmount: order.taxAmount,
    tax2Amount: order.tax2Amount,
    tipAmount: order.tipAmount,
    surchargeAmount: order.surchargeAmount,
    total: order.total,
    currency: order.currency,
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    completedAt: order.completedAt,
    items:
      order.items?.map((i: any) => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        variantId: i.variantId ?? null,
        variantName: i.variantName ?? null,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        modifiersTotal: i.modifiersTotal,
        itemTotal: i.itemTotal,
        specialInstructions: i.specialInstructions,
        modifiers: Array.isArray(i.modifiers)
          ? i.modifiers.map((m: any) => ({
              id: m.id,
              modifierId: m.modifierId,
              modifierName: m.modifierName,
              price: m.price,
            }))
          : [],
      })) ?? [],
    payments:
      order.payments?.map((p: any) => ({
        id: p.id,
        provider: p.provider,
        method: p.method,
        amount: p.amount,
        status: p.status,
        completedAt: p.completedAt,
      })) ?? [],
  };
}

// -- POST /api/mobile/orders -------------------------------------------------

const VALID_ORDER_TYPES = new Set(["DINE_IN", "TAKEAWAY", "DELIVERY", "APPOINTMENT"]);

export async function POST(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const body = await request.json().catch(() => ({}));
  const orderType = (body.orderType as string) || "TAKEAWAY";
  if (!VALID_ORDER_TYPES.has(orderType)) {
    return NextResponse.json(
      { error: `Invalid orderType. Must be one of: ${Array.from(VALID_ORDER_TYPES).join(", ")}` },
      { status: 400 }
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.ctx.tenantId },
    select: { currency: true },
  });

  const { orderNumber, displayNumber } = await nextOrderNumber(
    ctx.ctx.tenantId,
    ctx.ctx.locationId
  );

  const rawTableId = typeof body.tableId === "string" && body.tableId ? body.tableId : null;

  // Table validation — if a tableId is supplied it must exist AND belong to
  // this location. Prevents cross-location tampering via crafted request.
  // Only enforced for DINE_IN — other order types with a tableId is a UX
  // slip we tolerate (nulls the tableId).
  let tableId: string | null = null;
  if (rawTableId && orderType === "DINE_IN") {
    const table = await prisma.table.findFirst({
      where: { id: rawTableId, locationId: ctx.ctx.locationId, isActive: true },
      select: { id: true, status: true },
    });
    if (!table) {
      return NextResponse.json(
        { error: "Table not found for this location" },
        { status: 400 }
      );
    }
    tableId = table.id;
  }

  // Create + auto-occupy in one transaction so a failed occupy rolls back
  // the order (avoids orphan orders pointing at an AVAILABLE table).
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        locationId: ctx.ctx.locationId,
        createdById: ctx.ctx.session.memberId,
        orderNumber,
        displayNumber,
        orderType: orderType as any,
        status: "NEW",
        paymentStatus: "PENDING",
        tableId,
        customerName: typeof body.customerName === "string" ? body.customerName : null,
        customerPhone: typeof body.customerPhone === "string" ? body.customerPhone : null,
        customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : null,
        deliveryAddress: typeof body.deliveryAddress === "string" ? body.deliveryAddress : null,
        deliveryNotes: typeof body.deliveryNotes === "string" ? body.deliveryNotes : null,
        appointmentDate: body.appointmentDate ? new Date(body.appointmentDate) : null,
        appointmentTime: typeof body.appointmentTime === "string" ? body.appointmentTime : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        subtotal: 0,
        taxAmount: 0,
        tax2Amount: 0,
        discountAmount: 0,
        tipAmount: 0,
        surchargeAmount: 0,
        total: 0,
        currency: tenant?.currency || "CAD",
      },
      include: {
        items: true,
        payments: true,
        table: { select: { tableNumber: true, name: true } },
      },
    });

    // Auto-occupy — matches web POS's orders/route.ts:452-458. Only flip
    // AVAILABLE → OCCUPIED; leave RESERVED/CLEANING/BLOCKED alone so the
    // operator sees the real state.
    if (orderType === "DINE_IN" && tableId) {
      await tx.table.updateMany({
        where: { id: tableId, status: "AVAILABLE" },
        data: { status: "OCCUPIED" },
      });
    }

    return created;
  });

  return NextResponse.json({ order: serializeOrder(order) }, { status: 201 });
}

// -- GET /api/mobile/orders --------------------------------------------------
//
// Filters (all optional):
//   ?status=open|paid|all   (default: open)
//     - open: paymentStatus != COMPLETED AND status != CANCELLED
//     - paid: paymentStatus == COMPLETED
//     - all:  everything (bounded by limit)
//   ?limit=50               (default 50, max 200)

export async function GET(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  const statusFilter = (url.searchParams.get("status") || "open").toLowerCase();
  const rawLimit = Number(url.searchParams.get("limit") || "50");
  const limit = Math.min(200, Math.max(1, isFinite(rawLimit) ? rawLimit : 50));

  const where: any = { locationId: ctx.ctx.locationId };
  if (statusFilter === "open") {
    where.paymentStatus = { not: "COMPLETED" };
    where.status = { not: "CANCELLED" };
  } else if (statusFilter === "paid") {
    where.paymentStatus = "COMPLETED";
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      table: { select: { tableNumber: true, name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          productName: true,
          variantId: true,
          variantName: true,
          quantity: true,
          unitPrice: true,
          modifiersTotal: true,
          itemTotal: true,
          modifiers: {
            select: {
              id: true,
              modifierId: true,
              modifierName: true,
              price: true,
            },
          },
        },
      },
      payments: {
        select: {
          id: true,
          provider: true,
          method: true,
          amount: true,
          status: true,
          completedAt: true,
        },
      },
    },
  });

  return NextResponse.json({
    orders: orders.map(serializeOrder),
    count: orders.length,
  });
}
