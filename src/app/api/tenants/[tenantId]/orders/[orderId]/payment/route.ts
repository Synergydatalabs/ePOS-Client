// POST /api/tenants/[tenantId]/orders/[orderId]/payment
// Record a payment against an order. Supports split payments — the same
// endpoint is called once per tender (card + cash + gift card etc.), and
// the order is only marked COMPLETED when the cumulative COMPLETED
// payments cover order.total.
//
// Body: { method, amount?, status? }
//   method: 'CASH' | 'CARD' | 'INTERAC' | 'ONLINE' | 'TERMINAL_INTENT'
//   amount: cents applied for THIS tender. Defaults to the outstanding
//           balance (the classic single-payment case).
//           For CASH: tendered cents. Change = max(0, tendered - outstanding).
//           For CARD/INTERAC: the amount actually charged.
//
// Response:
//   { success, order, applied, change, remaining, paymentId }
//     applied   = cents credited to this Payment row
//     remaining = order.total - all completed payments (0 = fully paid)

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { deductInventoryForOrder } from "@/lib/recipe-deducter";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { method, amount } = body as {
      method?: string;
      amount?: number;
      status?: string;
    };

    if (!method) {
      return NextResponse.json(
        { error: "Payment method is required" },
        { status: 400 }
      );
    }

    // Load order + prior COMPLETED payments so we know what's outstanding
    // and can decide whether this tender fully closes the order.
    const order = await prisma.order.findFirst({
      where: { id: orderId, location: { tenantId } },
      select: {
        id: true,
        orderNumber: true,
        displayNumber: true,
        total: true,
        currency: true,
        status: true,
        paymentStatus: true,
        locationId: true,
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
    const outstanding = Math.max(0, order.total - alreadyPaid);

    // ONLINE = generate a QR/link for the customer to pay on their phone.
    // Nothing is written server-side yet — the /pay/[id] flow (or the
    // "Mark as Paid" fallback) writes the Payment row later.
    if (method === "ONLINE") {
      const origin =
        request.headers.get("origin") ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "";
      const paymentUrl = `${origin}/pay/${order.id}`;
      return NextResponse.json({
        success: true,
        paymentUrl,
        qrPayload: paymentUrl,
        orderId: order.id,
        remaining: outstanding,
      });
    }

    if (outstanding <= 0) {
      return NextResponse.json(
        { error: "Order is already fully paid" },
        { status: 400 }
      );
    }

    // Figure out how much of THIS tender applies to the order.
    // - CASH: caller sends tendered cents. Applied = min(tendered, outstanding).
    //         Change = tendered - applied (given back to customer, not stored
    //         against the order).
    // - CARD / INTERAC / other: caller sends the amount charged. Applied =
    //         min(that, outstanding). Charging more than outstanding is a
    //         no-op safeguard; typically the terminal was told exactly the
    //         outstanding amount.
    const tenderedCents =
      typeof amount === "number" && amount > 0 ? amount : outstanding;
    const applied = Math.min(tenderedCents, outstanding);
    const change =
      method === "CASH" && tenderedCents > outstanding
        ? tenderedCents - outstanding
        : 0;

    const cumulativeAfter = alreadyPaid + applied;
    const fullyCovers = cumulativeAfter >= order.total;

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          provider: method.toLowerCase(),
          amount: applied, // per-tender, not order.total
          currency: order.currency,
          status: "COMPLETED",
          method: method.toLowerCase(),
          completedAt: new Date(),
          metadata: { tenderedCents, change },
        },
      });

      // If this was a cash tender and there's an OPEN drawer session at
      // this location, log a PAYMENT movement so the drawer reconciles
      // at close. Look up by location only (register-agnostic) — we can
      // refine to specific terminals later once POS surfaces the choice.
      if (method.toUpperCase() === "CASH") {
        const openDrawer = await tx.cashDrawerSession.findFirst({
          where: { tenantId, locationId: order.locationId, status: "OPEN" },
          select: { id: true },
        });
        if (openDrawer) {
          await tx.cashMovement.create({
            data: {
              sessionId: openDrawer.id,
              type: "PAYMENT",
              amount: applied, // + into drawer
              orderId: order.id,
              paymentId: payment.id,
              performedById: validation.context.membership.id,
              reason: `Order ${order.displayNumber || order.orderNumber}`,
            },
          });
        }
      }

      const updatedOrder = fullyCovers
        ? await tx.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: "COMPLETED",
              paymentMethod: method,
              // Don't regress a kitchen-in-progress order back to CONFIRMED
              ...((order.status === "NEW" || order.status === "PENDING_PAYMENT") && {
                status: "CONFIRMED",
              }),
            },
            select: {
              id: true,
              orderNumber: true,
              displayNumber: true,
              status: true,
              paymentStatus: true,
              total: true,
            },
          })
        : // Partial — leave paymentStatus at whatever it was (PENDING
          // from order creation) so it doesn't get misread as fully paid
          // or as refunded. The `remaining` field in the response tells
          // the client exactly what's left to collect.
          {
            id: order.id,
            orderNumber: order.orderNumber,
            displayNumber: order.displayNumber,
            status: order.status,
            paymentStatus: order.paymentStatus,
            total: order.total,
          };

      return { payment, updatedOrder };
    });

    // If the order is now fully paid, decrement ingredient stock per
    // recipe. Fire-and-forget: never blocks the response and never fails
    // the payment — merchant can reconcile manually if something's off.
    if (fullyCovers) {
      deductInventoryForOrder(
        prisma,
        order.id,
        validation.context.membership.id
      ).catch((err) =>
        console.error(
          `[POS payment] recipe deduct failed for ${order.id}:`,
          err?.message || err
        )
      );
    }

    return NextResponse.json({
      success: true,
      order: result.updatedOrder,
      applied,
      change,
      remaining: Math.max(0, order.total - cumulativeAfter),
      paymentId: result.payment.id,
    });
  } catch (error: any) {
    console.error("[POS payment] error:", error);
    return NextResponse.json(
      { error: error?.message || "Payment failed" },
      { status: 500 }
    );
  }
}
