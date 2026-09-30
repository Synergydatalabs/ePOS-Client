// PATCH /api/mobile/orders/[orderId]/tip
//
// Set the tip amount on a draft order. Called before checkout when the
// operator (or customer) picks a tip via the tip-chips UI on mobile
// (15% / 18% / 20% / No tip / Custom).
//
// Body: { tipCents } — absolute tip amount in cents. Not a percentage —
// the client already resolved the picked percentage against the pre-tip
// subtotal. 0 is valid (clears the tip).
//
// Same mutability guard as items: order must still be open (status
// NEW/CONFIRMED/PREPARING and paymentStatus != COMPLETED).
//
// Recomputes totals so response carries fresh totals for immediate UI
// update — client doesn't need a follow-up GET.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";
import { recomputeOrderTotals } from "@/lib/mobile-order-totals";

export const dynamic = "force-dynamic";

const MUTABLE_STATUSES = new Set(["NEW", "CONFIRMED", "PREPARING"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => ({}));
  const raw = Number(body.tipCents);
  if (!Number.isFinite(raw) || raw < 0) {
    return NextResponse.json(
      { error: "tipCents must be a non-negative integer" },
      { status: 400 }
    );
  }
  const tip = Math.floor(raw);

  const order = await prisma.order.findFirst({
    where: { id: orderId, locationId: ctx.ctx.locationId },
    select: { id: true, status: true, paymentStatus: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.paymentStatus === "COMPLETED") {
    return NextResponse.json(
      { error: "Cannot modify a paid order" },
      { status: 400 }
    );
  }
  if (!MUTABLE_STATUSES.has(order.status)) {
    return NextResponse.json(
      { error: `Cannot modify a ${order.status.toLowerCase()} order` },
      { status: 400 }
    );
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { tipAmount: tip },
  });

  const totals = await recomputeOrderTotals(orderId);
  return NextResponse.json({ ok: true, tipAmount: tip, totals });
}
