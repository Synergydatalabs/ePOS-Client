// GET /api/mobile/tables
//
// Returns all tables for the caller's active location (single-location
// tenants auto-pick via mobile-order-context) with occupancy info so the
// TablePickerSheet can render a green/red/grey grid.
//
// Response shape:
//   {
//     tables: [{
//       id, tableNumber, name?, capacity, status,
//       currentOrder: { id, displayNumber, orderNumber, total, itemCount } | null,
//     }]
//   }
//
// Occupancy: we prefer showing the actual open Order tied to the table
// over trusting Table.status alone — web POS keeps three sources but the
// currentOrder link is the one operators actually care about ("who owns
// table 5?"). Table.status is still returned so the picker can grey out
// CLEANING / BLOCKED tables even without an active order.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

// Order states that count as "occupying" a table. Matches web POS's
// list-tables endpoint filter (COMPLETED + CANCELLED are done, everything
// else keeps the table tied up).
const OCCUPYING_ORDER_STATES = [
  "PENDING_PAYMENT",
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "SERVED",
  "PICKED_UP",
  "DELIVERED",
];

export async function GET(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const tables = await prisma.table.findMany({
    where: { locationId: ctx.ctx.locationId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { tableNumber: "asc" }],
    select: {
      id: true,
      tableNumber: true,
      name: true,
      capacity: true,
      status: true,
      orders: {
        where: { status: { in: OCCUPYING_ORDER_STATES } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          orderNumber: true,
          displayNumber: true,
          total: true,
          createdAt: true,
          items: { select: { quantity: true } },
        },
      },
    },
  });

  return NextResponse.json({
    tables: tables.map((t) => {
      const current = t.orders[0];
      return {
        id: t.id,
        tableNumber: t.tableNumber,
        name: t.name,
        capacity: t.capacity,
        status: t.status,
        currentOrder: current
          ? {
              id: current.id,
              orderNumber: current.orderNumber,
              displayNumber: current.displayNumber,
              total: current.total,
              itemCount: current.items.reduce((sum, it) => sum + it.quantity, 0),
              // A6.5-b (2026-08-20): expose the order start time so the
              // tables overview can show "sitting for 12m" on each card.
              createdAt: current.createdAt.toISOString(),
            }
          : null,
      };
    }),
  });
}
