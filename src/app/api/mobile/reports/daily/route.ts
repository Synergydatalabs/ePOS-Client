// GET /api/mobile/reports/daily
//
// Aggregated day-of-business summary for the caller's location. Powers
// the mobile "Today's sales" screen so operators can eyeball EOD numbers
// from their phone without switching to web POS.
//
// Query params:
//   date=YYYY-MM-DD   (optional — defaults to today in tenant timezone)
//
// Day window: uses the tenant's timezone (from TenantSettings) so a
// "Monday" report doesn't span two calendar days for a merchant in
// Vancouver. Falls back to America/Toronto when unset (matches tap-app's
// Tenant.timezone default).
//
// Numbers included:
//   sales:               grossSales, refunds, netSales, orderCount, tips, tax
//   paymentBreakdown[]:  by Payment.method — cash/card/etc split
//   orderTypeBreakdown[]:by Order.orderType — dine-in/takeaway/etc split
//   topItems[]:          top 10 products by revenue

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

// Build a UTC Date pair [start, end) that covers ONE calendar day in the
// requested timezone. Cheap alternative to Intl.DateTimeFormat gymnastics:
// use Intl to extract Y/M/D parts, then convert back to a UTC instant that
// represents midnight LOCAL time. Off-by-one on DST is possible in theory
// but acceptable for a report the operator eyeballs — precise financial
// reporting stays on web POS.
function dayWindow(dateISO: string, timezone: string): { start: Date; end: Date } {
  const anchor = new Date(dateISO + "T12:00:00Z"); // midday utc, safe from DST edges
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(anchor);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  // Approximate offset in ms between UTC and tenant tz at that instant.
  const asIfLocal = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMs = anchor.getTime() - asIfLocal - 12 * 3600 * 1000;
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + offsetMs);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000);
  return { start: startUtc, end: endUtc };
}

export async function GET(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const dateISO = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : `${yyyy}-${mm}-${dd}`;

  const [tenant, settings] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: ctx.ctx.tenantId },
      select: { currency: true, timezone: true },
    }),
    prisma.tenantSettings.findUnique({
      where: { tenantId: ctx.ctx.tenantId },
      select: { taxLabel: true },
    }),
  ]);

  const timezone = tenant?.timezone || "America/Toronto";
  const currency = tenant?.currency || "CAD";
  const { start, end } = dayWindow(dateISO, timezone);

  // Paid orders for the day window.
  const orders = await prisma.order.findMany({
    where: {
      locationId: ctx.ctx.locationId,
      paidAt: { gte: start, lt: end },
      paymentStatus: { in: ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"] },
    },
    select: {
      id: true,
      orderType: true,
      total: true,
      subtotal: true,
      tipAmount: true,
      taxAmount: true,
      tax2Amount: true,
      paymentStatus: true,
      items: {
        select: { productId: true, productName: true, quantity: true, itemTotal: true },
      },
      payments: {
        where: { status: "COMPLETED" },
        select: { amount: true, provider: true, method: true },
      },
    },
  });

  // Refunds initiated in the day window (may be for orders paid earlier).
  const refunds = await prisma.refund.findMany({
    where: {
      status: "COMPLETED",
      completedAt: { gte: start, lt: end },
      payment: {
        order: { locationId: ctx.ctx.locationId },
      },
    },
    select: { amount: true },
  });

  // Aggregate.
  let grossSales = 0;
  let tipsTotal = 0;
  let taxTotal = 0;
  const paymentByMethod = new Map<string, { count: number; amount: number }>();
  const orderTypeMap = new Map<string, { count: number; amount: number }>();
  const itemMap = new Map<string, { name: string; quantity: number; revenue: number }>();

  for (const o of orders) {
    grossSales += o.total;
    tipsTotal += o.tipAmount;
    taxTotal += o.taxAmount + o.tax2Amount;

    const typeKey = o.orderType || "UNKNOWN";
    const typeBucket = orderTypeMap.get(typeKey) || { count: 0, amount: 0 };
    typeBucket.count += 1;
    typeBucket.amount += o.total;
    orderTypeMap.set(typeKey, typeBucket);

    for (const p of o.payments) {
      const methodKey = (p.provider || p.method || "unknown").toLowerCase();
      const pb = paymentByMethod.get(methodKey) || { count: 0, amount: 0 };
      pb.count += 1;
      pb.amount += p.amount;
      paymentByMethod.set(methodKey, pb);
    }

    for (const it of o.items) {
      const rec = itemMap.get(it.productId) || { name: it.productName, quantity: 0, revenue: 0 };
      rec.quantity += it.quantity;
      rec.revenue += it.itemTotal;
      itemMap.set(it.productId, rec);
    }
  }

  const refundsTotal = refunds.reduce((s, r) => s + r.amount, 0);
  const netSales = grossSales - refundsTotal;

  const topItems = Array.from(itemMap.entries())
    .map(([productId, rec]) => ({
      productId,
      name: rec.name,
      quantity: rec.quantity,
      revenue: rec.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return NextResponse.json({
    date: dateISO,
    timezone,
    currency,
    taxLabel: settings?.taxLabel ?? "Tax",
    sales: {
      grossSales,
      refunds: refundsTotal,
      netSales,
      orderCount: orders.length,
      tips: tipsTotal,
      tax: taxTotal,
    },
    paymentBreakdown: Array.from(paymentByMethod.entries())
      .map(([method, v]) => ({ method, count: v.count, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount),
    orderTypeBreakdown: Array.from(orderTypeMap.entries())
      .map(([orderType, v]) => ({ orderType, count: v.count, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount),
    topItems,
  });
}
