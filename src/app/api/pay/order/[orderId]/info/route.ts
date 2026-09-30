// GET /api/pay/order/[orderId]/info
//
// Public — no auth. Feeds the /pay/order/[orderId] page a minimal
// summary (tenant name, order number, remaining amount, status). Kept
// deliberately narrow — this endpoint is customer-facing and must not
// leak anything beyond what a receipt would already show.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      displayNumber: true,
      total: true,
      currency: true,
      status: true,
      paymentStatus: true,
      location: {
        select: {
          tenant: { select: { name: true } },
        },
      },
      payments: {
        where: { status: "COMPLETED" },
        select: { amount: true },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const alreadyPaid = order.payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, order.total - alreadyPaid);

  return NextResponse.json({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      displayNumber: order.displayNumber,
      currency: order.currency,
      amountCents: remaining,
      paymentStatus: order.paymentStatus,
      status: order.status,
      tenantName: order.location.tenant.name,
    },
  });
}
