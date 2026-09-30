// /api/mobile/orders/[orderId]/items/[itemId]
//
// PATCH  { quantity } — update quantity (quantity=0 removes the line)
// DELETE               — remove the line
//
// Same mutability guardrail as add-item (status must be NEW/CONFIRMED/
// PREPARING and paymentStatus != COMPLETED). Both operations recompute
// order totals so the client stays in sync.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";
import { recomputeOrderTotals } from "@/lib/mobile-order-totals";

export const dynamic = "force-dynamic";

const MUTABLE_STATUSES = new Set(["NEW", "CONFIRMED", "PREPARING"]);

async function guardMutable(orderId: string, locationId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, locationId },
    select: { id: true, status: true, paymentStatus: true },
  });
  if (!order) return { error: "Order not found", status: 404 as const };
  if (order.paymentStatus === "COMPLETED") {
    return { error: "Cannot modify a paid order", status: 400 as const };
  }
  if (!MUTABLE_STATUSES.has(order.status)) {
    return {
      error: `Cannot modify a ${order.status.toLowerCase()} order`,
      status: 400 as const,
    };
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string; itemId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId, itemId } = await params;
  const guardErr = await guardMutable(orderId, ctx.ctx.locationId);
  if (guardErr) {
    return NextResponse.json({ error: guardErr.error }, { status: guardErr.status });
  }

  const body = await request.json().catch(() => ({}));
  const rawQty = Number(body.quantity);
  if (!Number.isFinite(rawQty) || rawQty < 0) {
    return NextResponse.json(
      { error: "quantity must be a non-negative integer" },
      { status: 400 }
    );
  }
  const quantity = Math.floor(rawQty);

  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, orderId },
    select: { id: true, unitPrice: true, modifiersTotal: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Item not found on this order" }, { status: 404 });
  }

  if (quantity === 0) {
    await prisma.orderItem.delete({ where: { id: itemId } });
  } else {
    await prisma.orderItem.update({
      where: { id: itemId },
      data: {
        quantity,
        itemTotal: item.unitPrice * quantity + (item.modifiersTotal || 0),
      },
    });
  }

  const totals = await recomputeOrderTotals(orderId);
  return NextResponse.json({ ok: true, totals });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string; itemId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId, itemId } = await params;
  const guardErr = await guardMutable(orderId, ctx.ctx.locationId);
  if (guardErr) {
    return NextResponse.json({ error: guardErr.error }, { status: guardErr.status });
  }

  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, orderId },
    select: { id: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Item not found on this order" }, { status: 404 });
  }

  await prisma.orderItem.delete({ where: { id: itemId } });
  const totals = await recomputeOrderTotals(orderId);
  return NextResponse.json({ ok: true, totals });
}
