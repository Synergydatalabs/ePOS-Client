// GET /api/tenants/[tenantId]/reports/sales - Get sales report

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { startOfDay, endOfDay, subDays, format, getHours } from "date-fns";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const locationId = searchParams.get("locationId");
    const groupBy = searchParams.get("groupBy") || "day"; // day, week, month

    // Default to last 30 days
    const start = startDate ? new Date(startDate) : subDays(new Date(), 30);
    const end = endDate ? new Date(endDate) : new Date();

    // Order doesn't have tenantId directly, filter through location relation
    const where: any = {
      location: { tenantId },
      paymentStatus: "COMPLETED",
      createdAt: {
        gte: startOfDay(start),
        lte: endOfDay(end),
      },
    };

    if (locationId) {
      where.locationId = locationId;
    }

    // Get orders with items
    const orders = await prisma.order.findMany({
      where,
      include: {
        items: {
          select: {
            productId: true,
            productName: true,
            quantity: true,
            itemTotal: true,
            unitCost: true,
          },
        },
        location: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // Calculate summary
    let totalRevenue = 0;
    let totalCost = 0;
    let totalOrders = orders.length;
    let totalItems = 0;
    let totalTax = 0;
    let totalTips = 0;
    let totalRefunds = 0;

    const productSales: Record<string, {
      productId: string;
      productName: string;
      quantity: number;
      revenue: number;
      cost: number;
    }> = {};

    const dailySales: Record<string, {
      date: string;
      orders: number;
      revenue: number;
      cost: number;
      profit: number;
    }> = {};

    const locationSales: Record<string, {
      locationId: string;
      locationName: string;
      orders: number;
      revenue: number;
    }> = {};

    // Order type aggregation
    const orderTypeSales: Record<string, {
      orderType: string;
      count: number;
      total: number;
    }> = {};

    // Payment method aggregation
    const paymentMethodSales: Record<string, {
      method: string;
      count: number;
      total: number;
    }> = {};

    // Hourly breakdown (0-23)
    const hourlySales: Record<number, {
      hour: number;
      orders: number;
      revenue: number;
    }> = {};

    // Initialize hourly breakdown
    for (let i = 0; i < 24; i++) {
      hourlySales[i] = { hour: i, orders: 0, revenue: 0 };
    }

    for (const order of orders) {
      totalRevenue += order.total;
      totalCost += order.totalCost;
      totalTax += order.taxAmount + order.tax2Amount;
      totalTips += order.tipAmount;

      // Daily aggregation
      const dayKey = format(order.createdAt, "yyyy-MM-dd");
      if (!dailySales[dayKey]) {
        dailySales[dayKey] = {
          date: dayKey,
          orders: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        };
      }
      dailySales[dayKey].orders++;
      dailySales[dayKey].revenue += order.total;
      dailySales[dayKey].cost += order.totalCost;
      dailySales[dayKey].profit += order.total - order.totalCost;

      // Location aggregation
      if (order.location) {
        if (!locationSales[order.locationId]) {
          locationSales[order.locationId] = {
            locationId: order.locationId,
            locationName: order.location.name,
            orders: 0,
            revenue: 0,
          };
        }
        locationSales[order.locationId].orders++;
        locationSales[order.locationId].revenue += order.total;
      }

      // Order type aggregation
      const orderType = order.orderType || "TAKEAWAY";
      if (!orderTypeSales[orderType]) {
        orderTypeSales[orderType] = {
          orderType,
          count: 0,
          total: 0,
        };
      }
      orderTypeSales[orderType].count++;
      orderTypeSales[orderType].total += order.total;

      // Payment method aggregation
      const paymentMethod = order.paymentMethod || "CASH";
      if (!paymentMethodSales[paymentMethod]) {
        paymentMethodSales[paymentMethod] = {
          method: paymentMethod,
          count: 0,
          total: 0,
        };
      }
      paymentMethodSales[paymentMethod].count++;
      paymentMethodSales[paymentMethod].total += order.total;

      // Hourly aggregation
      const hour = getHours(order.createdAt);
      hourlySales[hour].orders++;
      hourlySales[hour].revenue += order.total;

      // Product aggregation
      for (const item of order.items) {
        totalItems += item.quantity;
        const key = item.productId || item.productName;
        if (!productSales[key]) {
          productSales[key] = {
            productId: item.productId || "",
            productName: item.productName,
            quantity: 0,
            revenue: 0,
            cost: 0,
          };
        }
        productSales[key].quantity += item.quantity;
        productSales[key].revenue += item.itemTotal;
        productSales[key].cost += item.unitCost * item.quantity;
      }
    }

    const totalProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const netSales = totalRevenue - totalTax - totalRefunds;

    // Sort products by revenue
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);

    return NextResponse.json({
      success: true,
      report: {
        period: {
          start: startOfDay(start).toISOString(),
          end: endOfDay(end).toISOString(),
        },
        summary: {
          totalOrders,
          totalItems,
          totalSales: totalRevenue, // Frontend expects totalSales
          totalRevenue, // Keep for backwards compatibility
          totalCost, // in cents
          totalProfit, // in cents
          profitMargin: Math.round(profitMargin * 100) / 100, // percentage
          totalTax, // in cents
          totalTips, // in cents
          totalRefunds, // in cents
          netSales, // totalRevenue - tax - refunds
          averageOrderValue: Math.round(avgOrderValue), // Frontend expects this name
          avgOrderValue: Math.round(avgOrderValue), // Keep for backwards compatibility
        },
        dailySales: Object.values(dailySales).sort(
          (a, b) => a.date.localeCompare(b.date)
        ),
        locationSales: Object.values(locationSales).sort(
          (a, b) => b.revenue - a.revenue
        ),
        topProducts,
        byOrderType: Object.values(orderTypeSales).sort(
          (a, b) => b.total - a.total
        ),
        byPaymentMethod: Object.values(paymentMethodSales).sort(
          (a, b) => b.total - a.total
        ),
        hourlyBreakdown: Object.values(hourlySales).sort(
          (a, b) => a.hour - b.hour
        ),
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Sales report error:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}
