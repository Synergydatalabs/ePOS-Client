// GET /api/tenants/[tenantId]/reports/dashboard
//   Returns everything the admin dashboard needs in one round-trip:
//     - Today's KPIs (orders, revenue, profit, AOV, active orders)
//     - Yesterday's KPIs for % change deltas
//     - 7-day revenue trend (for sparkline)
//     - Sales-by-channel breakdown (orderType groupings)
//     - Peak-trading heatmap (day-of-week × hour, last 30 days)
//     - Top-selling products (last 30 days)
//     - Low-stock item count

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

// Percent change between two numbers, safely handling divide-by-zero.
function pctChange(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - prior) / prior) * 100);
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    // Date windows — all in server timezone (tenant timezone would be a
    // nicer refinement but the schema stores UTC, so use UTC boundaries).
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // Include today = 7 days total
    const thirtyDaysAgo = new Date(todayStart);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

    // Restrict to this tenant's orders through the location relation
    const tenantOrderFilter = { location: { tenantId } };

    // ── Parallel data fetches ─────────────────────────────────────
    const [
      todayAgg,
      yesterdayAgg,
      activeOrders,
      last7DaysRaw,
      channelBreakdown,
      last30DaysRaw,
      topProducts,
      lowStockAgg,
    ] = await Promise.all([
      // Today
      prisma.order.aggregate({
        where: {
          ...tenantOrderFilter,
          createdAt: { gte: todayStart, lt: now },
          status: { not: "CANCELLED" },
        },
        _sum: { total: true, totalCost: true },
        _count: { _all: true },
      }),
      // Yesterday (for deltas)
      prisma.order.aggregate({
        where: {
          ...tenantOrderFilter,
          createdAt: { gte: yesterdayStart, lt: todayStart },
          status: { not: "CANCELLED" },
        },
        _sum: { total: true, totalCost: true },
        _count: { _all: true },
      }),
      // Currently-active orders (any not-yet-completed non-cancelled)
      prisma.order.count({
        where: {
          ...tenantOrderFilter,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
      }),
      // Last 7 days of orders — grouped by day in JS since Prisma doesn't
      // do DATE_TRUNC portably. Slim select for speed.
      prisma.order.findMany({
        where: {
          ...tenantOrderFilter,
          createdAt: { gte: sevenDaysAgo, lt: now },
          status: { not: "CANCELLED" },
        },
        select: { createdAt: true, total: true },
      }),
      // Sales by channel (last 30 days for a meaningful distribution)
      prisma.order.groupBy({
        by: ["orderType"],
        where: {
          ...tenantOrderFilter,
          createdAt: { gte: thirtyDaysAgo, lt: now },
          status: { not: "CANCELLED" },
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
      // Last 30 days of orders for the heatmap — day/hour grouping in JS
      prisma.order.findMany({
        where: {
          ...tenantOrderFilter,
          createdAt: { gte: thirtyDaysAgo, lt: now },
          status: { not: "CANCELLED" },
        },
        select: { createdAt: true },
      }),
      // Top selling products (last 30 days)
      prisma.orderItem.groupBy({
        by: ["productId"],
        where: {
          order: {
            ...tenantOrderFilter,
            createdAt: { gte: thirtyDaysAgo, lt: now },
            status: { not: "CANCELLED" },
          },
        },
        _sum: { quantity: true, itemTotal: true },
        orderBy: { _sum: { itemTotal: "desc" } },
        take: 5,
      }),
      // Low stock — anything with quantity <= reorderPoint
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
        SELECT COUNT(*)::bigint AS count
          FROM location_inventory li
          JOIN ingredients i ON i.id = li.ingredient_id
         WHERE i.tenant_id = $1::uuid
           AND li.quantity_on_hand <= COALESCE(li.reorder_point, 0)
      `,
        tenantId
      ),
    ]);

    // ── Derive KPIs ──────────────────────────────────────────────
    const todayRevenue = todayAgg._sum.total || 0;
    const todayCost = todayAgg._sum.totalCost || 0;
    const todayOrders = todayAgg._count._all;
    const todayProfit = todayRevenue - todayCost;
    const todayAOV = todayOrders > 0 ? Math.round(todayRevenue / todayOrders) : 0;

    const yestRevenue = yesterdayAgg._sum.total || 0;
    const yestOrders = yesterdayAgg._count._all;
    const yestProfit = yestRevenue - (yesterdayAgg._sum.totalCost || 0);
    const yestAOV = yestOrders > 0 ? Math.round(yestRevenue / yestOrders) : 0;

    // ── Last 7 days revenue trend ────────────────────────────────
    // Bucket each order into a YYYY-MM-DD bucket in local time.
    const dayBuckets = new Map<string, number>();
    for (let d = 0; d < 7; d++) {
      const day = new Date(sevenDaysAgo);
      day.setDate(day.getDate() + d);
      const key = day.toISOString().slice(0, 10);
      dayBuckets.set(key, 0);
    }
    for (const o of last7DaysRaw) {
      const key = new Date(o.createdAt).toISOString().slice(0, 10);
      if (dayBuckets.has(key)) {
        dayBuckets.set(key, (dayBuckets.get(key) || 0) + o.total);
      }
    }
    const revenueTrend = Array.from(dayBuckets, ([date, revenue]) => ({
      date,
      revenue,
      label: new Date(date).toLocaleDateString("en-CA", {
        weekday: "short",
      }),
    }));

    // ── Sales by channel ─────────────────────────────────────────
    // Normalize to the 4 canonical types + include an "OTHER" bucket
    // for any historical order types that don't fit.
    const channelTotals = {
      DINE_IN: { revenue: 0, count: 0 },
      TAKEAWAY: { revenue: 0, count: 0 },
      DELIVERY: { revenue: 0, count: 0 },
      APPOINTMENT: { revenue: 0, count: 0 },
    } as Record<string, { revenue: number; count: number }>;
    for (const c of channelBreakdown) {
      const key = c.orderType || "TAKEAWAY";
      if (!channelTotals[key]) channelTotals[key] = { revenue: 0, count: 0 };
      channelTotals[key].revenue += c._sum.total || 0;
      channelTotals[key].count += c._count._all;
    }
    const channels = Object.entries(channelTotals)
      .filter(([, v]) => v.revenue > 0 || v.count > 0)
      .map(([type, v]) => ({ type, ...v }));

    // ── Peak trading heatmap (7 days × 24 hours) ─────────────────
    // Rows = day-of-week (0=Sun..6=Sat), Cols = hour-of-day (0..23)
    const heatmap: number[][] = Array.from({ length: 7 }, () =>
      Array(24).fill(0)
    );
    for (const o of last30DaysRaw) {
      const d = new Date(o.createdAt);
      const dow = d.getDay(); // 0-6
      const hour = d.getHours(); // 0-23
      heatmap[dow][hour]++;
    }

    // ── Top selling products ─────────────────────────────────────
    const productIds = topProducts.map((p) => p.productId);
    const productNames = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(productNames.map((p) => [p.id, p.name]));
    const topSelling = topProducts.map((p) => ({
      productId: p.productId,
      name: nameById.get(p.productId) || "Unknown",
      quantity: p._sum.quantity || 0,
      revenue: p._sum.itemTotal || 0,
    }));

    return NextResponse.json({
      success: true,
      today: {
        orders: todayOrders,
        revenue: todayRevenue,
        profit: todayProfit,
        aov: todayAOV,
        active: activeOrders,
      },
      changes: {
        orders: pctChange(todayOrders, yestOrders),
        revenue: pctChange(todayRevenue, yestRevenue),
        profit: pctChange(todayProfit, yestProfit),
        aov: pctChange(todayAOV, yestAOV),
      },
      revenueTrend,
      channels,
      heatmap,
      heatmapDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      topSelling,
      lowStockCount: Number(lowStockAgg?.[0]?.count || 0),
      windowDays: 30,
      generatedAt: now.toISOString(),
    });
  } catch (error: any) {
    console.error("[reports/dashboard] error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to load dashboard data",
        code: error?.code || null,
      },
      { status: 500 }
    );
  }
}
