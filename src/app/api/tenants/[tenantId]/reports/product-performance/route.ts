// GET /api/tenants/[tenantId]/reports/product-performance
//   Query: ?days=30&categoryId=<uuid>
//   Aggregates OrderItems over the given window and returns per-product
//   performance metrics + convenience buckets (top sellers, slow movers,
//   dead stock).
//
// Money is in cents throughout. Velocity is "units per day" over the
// window. Days-of-stock is (currentStock / velocity) for products that
// have track_inventory enabled; null otherwise.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

// A product is "slow moving" when velocity drops below this share of the
// window's average velocity. E.g. avg 5 units/day * 0.15 = < 0.75/day.
const SLOW_MOVER_RATIO = 0.15;

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const daysParam = parseInt(searchParams.get("days") || "30", 10);
    const days = Math.max(1, Math.min(365, isNaN(daysParam) ? 30 : daysParam));
    const categoryId = searchParams.get("categoryId") || undefined;

    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    // ── All active products for this tenant (so we can identify dead stock) ──
    const products = await prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(categoryId ? { categoryId } : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        basePrice: true,
        costPrice: true,
        imageUrl: true,
        trackInventory: true,
        category: { select: { id: true, name: true } },
      },
    });
    const productIds = products.map((p) => p.id);

    // ── Aggregate order-item rows in the window ──
    // Grouping runs in the DB; we join names/costs back in JS since Prisma's
    // groupBy doesn't return related fields.
    const [itemAgg, lastSoldRaw, currentStockRaw] = await Promise.all([
      prisma.orderItem.groupBy({
        by: ["productId"],
        where: {
          productId: { in: productIds },
          order: {
            location: { tenantId },
            createdAt: { gte: start, lt: now },
            status: { not: "CANCELLED" },
          },
        },
        _sum: {
          quantity: true,
          itemTotal: true,
          unitCost: true,
        },
        _count: { _all: true },
      }),
      // Most recent sale per product — used for "last sold" and dead-stock
      // detection outside the window
      prisma.$queryRawUnsafe<Array<{ product_id: string; last_sold_at: Date }>>(`
        SELECT oi.product_id, MAX(o.created_at) AS last_sold_at
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN locations l ON l.id = o.location_id
         WHERE l.tenant_id = $1::uuid
           AND o.status <> 'CANCELLED'
         GROUP BY oi.product_id
      `,
        tenantId
      ),
      // Sum on-hand quantity across all locations for track-inventory items.
      // location_inventory has one row per ingredient per location — for
      // simplicity we treat the product's primary ingredient (recipe) as
      // the stock signal. Products without a recipe get null and skip
      // days-of-stock calculation.
      prisma.$queryRawUnsafe<Array<{ product_id: string; stock: bigint }>>(`
        SELECT r.product_id, SUM(li.quantity_on_hand)::bigint AS stock
          FROM recipes r
          JOIN location_inventory li ON li.ingredient_id = r.ingredient_id
          JOIN ingredients ing ON ing.id = r.ingredient_id
         WHERE ing.tenant_id = $1::uuid
         GROUP BY r.product_id
      `,
        tenantId
      ),
    ]);

    const soldById = new Map(itemAgg.map((r) => [r.productId, r]));
    const lastSoldById = new Map(
      lastSoldRaw.map((r) => [r.product_id, r.last_sold_at])
    );
    const stockById = new Map(
      currentStockRaw.map((r) => [r.product_id, Number(r.stock)])
    );

    // ── Per-product metrics ──
    const rows = products.map((p) => {
      const agg = soldById.get(p.id);
      const unitsSold = agg?._sum.quantity || 0;
      const revenue = agg?._sum.itemTotal || 0;
      // unitCost is per-item at time of sale — Sum aggregates across all
      // OrderItems, but to get total cost we need quantity * unitCost per
      // row. groupBy can't SUM(quantity * unitCost) directly, so we
      // approximate with the product's current costPrice * unitsSold for
      // dead-simple accuracy. If the merchant hasn't set costPrice, cost
      // is 0 (which yields profit = revenue — flagged in the UI).
      const cost = p.costPrice * unitsSold;
      const profit = revenue - cost;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const velocity = unitsSold / days;
      const avgPrice = unitsSold > 0 ? Math.round(revenue / unitsSold) : p.basePrice;
      const lastSoldAt = lastSoldById.get(p.id) || null;
      const currentStock = stockById.get(p.id) ?? null;
      const daysOfStock =
        p.trackInventory && currentStock !== null && velocity > 0
          ? Math.round(currentStock / velocity)
          : null;

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        imageUrl: p.imageUrl,
        category: p.category,
        basePrice: p.basePrice,
        costPrice: p.costPrice,
        trackInventory: p.trackInventory,
        unitsSold,
        orderCount: agg?._count._all || 0,
        revenue,
        cost,
        profit,
        margin,
        avgPrice,
        velocity, // units per day
        lastSoldAt,
        currentStock,
        daysOfStock,
      };
    });

    // ── Derived buckets ──
    const withSales = rows.filter((r) => r.unitsSold > 0);
    const withoutSales = rows.filter((r) => r.unitsSold === 0);

    const totalUnits = withSales.reduce((s, r) => s + r.unitsSold, 0);
    const totalRevenue = withSales.reduce((s, r) => s + r.revenue, 0);
    const totalProfit = withSales.reduce((s, r) => s + r.profit, 0);
    const avgVelocity =
      withSales.length > 0
        ? withSales.reduce((s, r) => s + r.velocity, 0) / withSales.length
        : 0;
    const slowThreshold = avgVelocity * SLOW_MOVER_RATIO;

    const byRevenue = [...withSales].sort((a, b) => b.revenue - a.revenue);
    const byUnits = [...withSales].sort((a, b) => b.unitsSold - a.unitsSold);
    // Slow movers: sold something, but at less than SLOW_MOVER_RATIO of the
    // average velocity. Only meaningful when there's activity at all.
    const slowMovers =
      avgVelocity > 0
        ? [...withSales]
            .filter((r) => r.velocity < slowThreshold)
            .sort((a, b) => a.velocity - b.velocity)
        : [];
    const deadStock = withoutSales;

    return NextResponse.json({
      success: true,
      windowDays: days,
      generatedAt: now.toISOString(),
      summary: {
        totalProducts: products.length,
        activeProducts: withSales.length,
        deadCount: deadStock.length,
        slowCount: slowMovers.length,
        totalUnits,
        totalRevenue,
        totalProfit,
        avgVelocity,
        topSellerName: byRevenue[0]?.name || null,
        topSellerRevenue: byRevenue[0]?.revenue || 0,
      },
      products: rows,
      topByRevenue: byRevenue.slice(0, 10),
      topByUnits: byUnits.slice(0, 10),
      slowMovers: slowMovers.slice(0, 20),
      deadStock: deadStock.slice(0, 50),
    });
  } catch (error: any) {
    console.error("[reports/product-performance] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load product performance" },
      { status: 500 }
    );
  }
}
