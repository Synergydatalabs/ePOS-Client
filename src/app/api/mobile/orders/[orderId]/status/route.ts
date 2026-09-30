// PATCH /api/mobile/orders/[orderId]/status
//
// Advance an order's lifecycle status. Used by the mobile "Order detail /
// KDS-lite" screen so waiters + counter staff can walk around and update
// where an order is at without needing a full kitchen display.
//
// Body: { status: OrderStatus }
//
// Allowed transitions — kept permissive so the mobile UI doesn't need to
// re-encode business rules, but explicit enough to block nonsense like
// COMPLETED → NEW or CANCELLED → PREPARING. Full rules in ALLOWED below.
//
// Side effects:
//   • Moving to COMPLETED sets order.completedAt if not already set.
//   • Moving to CANCELLED sets order.cancelledAt.
//   • Cancelling a dine-in order releases the table.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

// Forward-only transitions. Each status maps to the set it may move to.
// Terminal states (COMPLETED, CANCELLED) map to empty sets → no way out.
const ALLOWED: Record<string, Set<string>> = {
  PENDING_PAYMENT: new Set(["NEW", "CANCELLED"]),
  NEW: new Set(["CONFIRMED", "PREPARING", "CANCELLED"]),
  CONFIRMED: new Set(["PREPARING", "READY", "CANCELLED"]),
  PREPARING: new Set(["READY", "CANCELLED"]),
  READY: new Set(["SERVED", "PICKED_UP", "DELIVERED", "COMPLETED"]),
  SERVED: new Set(["COMPLETED"]),
  PICKED_UP: new Set(["COMPLETED"]),
  DELIVERED: new Set(["COMPLETED"]),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => ({}));
  const target = typeof body.status === "string" ? body.status.toUpperCase() : "";

  if (!target || !(target in ALLOWED)) {
    return NextResponse.json(
      { error: "Invalid target status" },
      { status: 400 }
    );
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, locationId: ctx.ctx.locationId },
    select: {
      id: true,
      status: true,
      orderType: true,
      tableId: true,
      completedAt: true,
      cancelledAt: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // No-op — treat as success so retries / duplicate taps don't 400.
  if (order.status === target) {
    return NextResponse.json({ ok: true, status: order.status, noop: true });
  }

  const allowed = ALLOWED[order.status];
  if (!allowed?.has(target)) {
    return NextResponse.json(
      {
        error: `Cannot move from ${order.status} to ${target}. Allowed: ${
          Array.from(allowed ?? []).join(", ") || "(none — terminal state)"
        }`,
      },
      { status: 409 }
    );
  }

  const now = new Date();
  const data: Record<string, unknown> = { status: target };
  if (target === "COMPLETED" && !order.completedAt) data.completedAt = now;
  if (target === "CANCELLED" && !order.cancelledAt) data.cancelledAt = now;

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data });

    // Cancelling a dine-in order — free the table so another party can
    // seat. Only flip OCCUPIED → AVAILABLE; leave RESERVED/CLEANING/BLOCKED
    // alone (someone explicitly set those).
    if (target === "CANCELLED" && order.orderType === "DINE_IN" && order.tableId) {
      const otherOpen = await tx.order.count({
        where: {
          tableId: order.tableId,
          id: { not: order.id },
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
      });
      if (otherOpen === 0) {
        await tx.table.updateMany({
          where: { id: order.tableId, status: "OCCUPIED" },
          data: { status: "AVAILABLE" },
        });
      }
    }
  });

  return NextResponse.json({ ok: true, status: target });
}
