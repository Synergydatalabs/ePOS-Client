// /api/mobile/orders/[orderId]
//
// GET    — full order detail (items + payments)
// DELETE — cancel this order. Only permitted while unpaid + not yet
//          COMPLETED. Does NOT (yet) restore inventory — recipe deducter
//          only fires on payment completion, so cancelling before payment
//          is a no-op on stock.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

async function loadOrder(orderId: string, locationId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, locationId },
    include: {
      table: { select: { tableNumber: true, name: true } },
      items: {
        orderBy: { createdAt: "asc" },
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
          specialInstructions: true,
          // A5 (2026-08-18): included so the cart screen can render
          // "extra shot, oat milk" under each line.
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
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          provider: true,
          method: true,
          amount: true,
          status: true,
          completedAt: true,
          metadata: true,
        },
      },
    },
  });
}

function serialize(order: NonNullable<Awaited<ReturnType<typeof loadOrder>>>) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    displayNumber: order.displayNumber,
    orderType: order.orderType,
    status: order.status,
    paymentStatus: order.paymentStatus,
    tableId: order.tableId,
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
    items: order.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productName: it.productName,
      variantId: it.variantId,
      variantName: it.variantName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      modifiersTotal: it.modifiersTotal,
      itemTotal: it.itemTotal,
      specialInstructions: it.specialInstructions,
      modifiers: it.modifiers.map((m) => ({
        id: m.id,
        modifierId: m.modifierId,
        modifierName: m.modifierName,
        price: m.price,
      })),
    })),
    payments: order.payments,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;
  const order = await loadOrder(orderId, ctx.ctx.locationId);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  return NextResponse.json({ order: serialize(order) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;
  const existing = await prisma.order.findFirst({
    where: { id: orderId, locationId: ctx.ctx.locationId },
    select: { id: true, status: true, paymentStatus: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (existing.paymentStatus === "COMPLETED") {
    return NextResponse.json(
      { error: "Cannot cancel a paid order. Use refund instead." },
      { status: 400 }
    );
  }
  if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
    return NextResponse.json(
      { error: `Order is already ${existing.status.toLowerCase()}.` },
      { status: 400 }
    );
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
