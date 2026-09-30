// POST /api/tenants/[tenantId]/orders/[orderId]/split/[splitItemId]/pay
//   Pay ONE bill-split item. Creates a Payment row (like the normal
//   /payment endpoint), marks the splitItem COMPLETED + links the
//   payment_id. When ALL splitItems for an order are COMPLETED, the
//   order flips to paymentStatus = COMPLETED and status = CONFIRMED,
//   matching the Task #31 fully-paid transition.
//
// Body: { method, amount?, tipAmount?, code? }
//   method   'CASH' | 'CARD' | 'INTERAC' | 'ONLINE' | 'GIFT_CARD'
//   amount   optional override; defaults to splitItem.amount + tipAmount
//   code     gift-card code (when method = 'GIFT_CARD')
//
// Intentionally does NOT delegate to /orders/[orderId]/payment because
// the split flow needs to (a) match the payment row 1:1 to a splitItem
// and (b) only close the order when the LAST splitItem is paid — not
// the first cumulative amount to hit order.total.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = {
  params: Promise<{
    tenantId: string;
    orderId: string;
    splitItemId: string;
  }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, orderId, splitItemId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json().catch(() => ({}));
    const method = String(body.method || "");
    if (!method) {
      return NextResponse.json(
        { error: "method is required" },
        { status: 400 }
      );
    }

    const splitItem = await prisma.billSplitItem.findFirst({
      where: {
        id: splitItemId,
        billSplit: { orderId, order: { location: { tenantId } } },
      },
      include: {
        billSplit: {
          include: {
            order: {
              select: {
                id: true,
                status: true,
                paymentStatus: true,
                currency: true,
              },
            },
            items: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!splitItem) {
      return NextResponse.json(
        { error: "Split item not found" },
        { status: 404 }
      );
    }
    if (splitItem.status === "COMPLETED") {
      return NextResponse.json(
        { error: "This split has already been paid" },
        { status: 409 }
      );
    }

    // Cash accepts a tendered override amount (customer hands over more
    // than owed → change). Everything else uses the split's face value.
    const owed = splitItem.amount + (splitItem.tipAmount || 0);
    const tenderedCents =
      typeof body.amount === "number" && body.amount > 0
        ? body.amount
        : owed;
    const change =
      method.toUpperCase() === "CASH" && tenderedCents > owed
        ? tenderedCents - owed
        : 0;

    const order = splitItem.billSplit.order;

    // How many items will still be unpaid AFTER this one? If zero, we
    // close the order.
    const remainingUnpaid =
      splitItem.billSplit.items.filter(
        (i) => i.status !== "COMPLETED" && i.id !== splitItemId
      ).length;

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId,
          provider: method.toLowerCase(),
          amount: owed, // per-split, matches the splitItem face value
          currency: order.currency,
          status: "COMPLETED",
          method: method.toLowerCase(),
          completedAt: new Date(),
          metadata: {
            billSplitItemId: splitItemId,
            guestName: splitItem.guestName,
            tenderedCents,
            change,
          },
        },
      });

      await tx.billSplitItem.update({
        where: { id: splitItemId },
        data: {
          status: "COMPLETED",
          paymentId: payment.id,
          paidAt: new Date(),
        },
      });

      const orderClosed = remainingUnpaid === 0;
      const updatedOrder = orderClosed
        ? await tx.order.update({
            where: { id: orderId },
            data: {
              paymentStatus: "COMPLETED",
              paymentMethod: method,
              ...((order.status === "NEW" || order.status === "PENDING_PAYMENT") && {
                status: "CONFIRMED",
              }),
            },
            select: {
              id: true,
              status: true,
              paymentStatus: true,
              displayNumber: true,
              total: true,
            },
          })
        : {
            id: orderId,
            status: order.status,
            paymentStatus: order.paymentStatus,
            displayNumber: null as unknown as number,
            total: 0,
          };

      return { payment, orderClosed, updatedOrder };
    });

    return NextResponse.json({
      success: true,
      applied: owed,
      change,
      remainingUnpaid,
      orderClosed: result.orderClosed,
      order: result.updatedOrder,
      paymentId: result.payment.id,
    });
  } catch (error: any) {
    console.error("[split pay] error:", error);
    return NextResponse.json(
      { error: error?.message || "Payment failed" },
      { status: 500 }
    );
  }
}
