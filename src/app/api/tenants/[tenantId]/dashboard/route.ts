// GET /api/tenants/[tenantId]/dashboard?locationId=<id>&mine=1
//
// Role-aware dashboard payload. The client passes:
//   - locationId (optional): scope to a single location — the active one
//     from the LocationPicker. Omitted → all locations the caller has
//     access to.
//   - mine=1 (optional): staff-view flag → only orders CREATED BY the
//     caller. Auto-applied for POS_STAFF / KITCHEN_STAFF regardless of
//     query param, so a staff cookie can't inflate the query.
//
// Returns:
//   {
//     scope: { role, locationId, mine },
//     todayOrders, todayRevenueCents, currency,
//     pendingPaymentOrders,
//     inProgress: { NEW, CONFIRMED, PREPARING, READY, PENDING_PAYMENT, total },
//     recentOrders: [...],
//     topItems: [{ productName, qty, revenueCents }, ...],   // owner+ only
//   }
//
// One combined endpoint so the dashboard is a single request. Both
// staff and owner views share this shape; the client renders different
// sections based on `scope.role`.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";

// Statuses considered "in progress" for the kitchen/fulfillment board.
// COMPLETED / CANCELLED / VOIDED land in history — not on the dashboard.
const IN_PROGRESS_STATUSES = [
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "PENDING_PAYMENT",
] as const;

// Roles that always get a staff-scoped view even if `mine=0` is passed.
// Anything at MANAGER or above sees the full location's orders.
const STAFF_ONLY_ROLES = new Set(["POS_STAFF", "KITCHEN_STAFF"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    // POS_STAFF is the lowest role we care about — anyone with an active
    // membership can see SOMETHING (their own view). Endpoints deeper
    // than this enforce their own tighter role gates.
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || undefined;
    const clientMine = searchParams.get("mine") === "1";

    const role = auth.context.membership.role;
    const forceMine = STAFF_ONLY_ROLES.has(role);
    const mine = forceMine || clientMine;

    // Base filter — tenant-scoped via location.tenantId to avoid a join
    // gymnastic. locationId narrows further when provided.
    const baseWhere: any = { location: { tenantId } };
    if (locationId) baseWhere.locationId = locationId;
    if (mine) baseWhere.createdById = auth.context.membership.id;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Kick off the queries we always need in parallel — one round-trip.
    const [
      todayCount,
      todayRevenueAgg,
      pendingCount,
      inProgressGroups,
      recentOrders,
    ] = await Promise.all([
      // Today's orders count (all statuses except cancelled/voided).
      prisma.order.count({
        where: {
          ...baseWhere,
          createdAt: { gte: startOfToday },
          status: { notIn: ["CANCELLED"] },
        },
      }),
      // Today's revenue — only paid orders count toward revenue.
      prisma.order.aggregate({
        where: {
          ...baseWhere,
          paidAt: { gte: startOfToday },
          paymentStatus: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
        },
        _sum: { total: true },
      }),
      // Pending-payment count — orders sitting on the payment step.
      prisma.order.count({
        where: {
          ...baseWhere,
          paymentStatus: { in: ["PENDING", "PROCESSING"] },
          status: { notIn: ["CANCELLED"] },
        },
      }),
      // In-progress board — one grouped query, five buckets in one shot.
      prisma.order.groupBy({
        by: ["status"],
        where: {
          ...baseWhere,
          status: { in: IN_PROGRESS_STATUSES as unknown as string[] as any },
        },
        _count: true,
      }),
      // Recent orders — the "what's happening right now" list. 10 rows,
      // richest-info side (customer, table, total, status, age).
      prisma.order.findMany({
        where: {
          ...baseWhere,
          status: { notIn: ["CANCELLED"] },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          displayNumber: true,
          orderType: true,
          status: true,
          paymentStatus: true,
          total: true,
          currency: true,
          customerName: true,
          createdAt: true,
          table: { select: { tableNumber: true } },
          createdBy: {
            select: { id: true, firstName: true, lastName: true },
          },
          location: { select: { id: true, name: true } },
        },
      }),
    ]);

    // Currency + businessType. businessType drives whether the client
    // renders the kitchen board or the appointments panel.
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true, businessType: true },
    });
    const currency = recentOrders[0]?.currency || tenant?.currency || "CAD";
    const businessType = tenant?.businessType || "restaurant";

    // Upcoming appointments — salons only. Today + next 2 days,
    // non-terminal statuses only. Includes service snapshots + tech
    // name so the dashboard can render a walk-in-ready list without
    // extra round-trips.
    let upcomingAppointments: any[] = [];
    if (businessType === "salon") {
      const dayAfterTomorrow = new Date(startOfToday);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 3);
      const rows = await prisma.order.findMany({
        where: {
          ...baseWhere,
          orderType: "APPOINTMENT",
          appointmentDate: { gte: startOfToday, lt: dayAfterTomorrow },
          status: { notIn: ["CANCELLED", "COMPLETED"] },
        },
        orderBy: [{ appointmentDate: "asc" }, { appointmentTime: "asc" }],
        take: 25,
        select: {
          id: true,
          orderNumber: true,
          displayNumber: true,
          status: true,
          paymentStatus: true,
          customerName: true,
          customerPhone: true,
          appointmentDate: true,
          appointmentTime: true,
          total: true,
          currency: true,
          items: {
            select: {
              productName: true,
              technician: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
      });
      upcomingAppointments = rows.map((r) => {
        // Aggregate distinct technicians across line items — usually one
        // per appointment but data model allows per-item.
        const techNames = Array.from(
          new Set(
            r.items
              .map((i) => {
                const t = i.technician;
                if (!t) return null;
                return (
                  [t.firstName, t.lastName].filter(Boolean).join(" ").trim() ||
                  null
                );
              })
              .filter(Boolean) as string[]
          )
        );
        return {
          id: r.id,
          orderNumber: r.orderNumber,
          displayNumber: r.displayNumber,
          status: r.status,
          paymentStatus: r.paymentStatus,
          customerName: r.customerName,
          customerPhone: r.customerPhone,
          appointmentDate: r.appointmentDate,
          appointmentTime: r.appointmentTime,
          serviceNames: r.items.map((i) => i.productName),
          technicianNames: techNames,
          total: r.total,
          currency: r.currency,
        };
      });
    }

    // Fill the in-progress bucket map with zeros for any statuses the
    // groupBy didn't return (client wants a stable shape).
    const inProgress: Record<string, number> = {
      NEW: 0,
      CONFIRMED: 0,
      PREPARING: 0,
      READY: 0,
      PENDING_PAYMENT: 0,
      total: 0,
    };
    for (const g of inProgressGroups) {
      const key = g.status as keyof typeof inProgress;
      inProgress[key] = g._count;
      inProgress.total += g._count;
    }

    // Top items — MANAGER and above only. Skips the query entirely for
    // staff so their dashboard load stays snappy.
    let topItems: { productName: string; qty: number; revenueCents: number }[] = [];
    if (!mine) {
      const itemRows = await prisma.orderItem.groupBy({
        by: ["productName"],
        where: {
          order: {
            ...baseWhere,
            createdAt: { gte: startOfToday },
            status: { notIn: ["CANCELLED"] },
          },
        },
        _sum: { quantity: true, itemTotal: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      });
      topItems = itemRows.map((r) => ({
        productName: r.productName,
        qty: Number(r._sum.quantity ?? 0),
        revenueCents: Number(r._sum.itemTotal ?? 0),
      }));
    }

    return NextResponse.json({
      success: true,
      scope: { role, locationId: locationId || null, mine },
      businessType,
      todayOrders: todayCount,
      todayRevenueCents: Number(todayRevenueAgg._sum.total ?? 0),
      currency,
      pendingPaymentOrders: pendingCount,
      inProgress,
      upcomingAppointments,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        displayNumber: o.displayNumber,
        orderType: o.orderType,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        currency: o.currency,
        customerName: o.customerName,
        tableNumber: o.table?.tableNumber ?? null,
        createdAt: o.createdAt,
        locationName: o.location?.name ?? null,
        createdByName:
          [o.createdBy?.firstName, o.createdBy?.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() || null,
      })),
      topItems,
    });
  } catch (error: any) {
    console.error("[DASHBOARD] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
