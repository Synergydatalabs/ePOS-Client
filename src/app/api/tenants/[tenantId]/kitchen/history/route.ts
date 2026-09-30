// GET /api/tenants/[tenantId]/kitchen/history - Get completed orders history

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { startOfDay, endOfDay, subHours } from "date-fns";

// GET - Get kitchen history (completed/served orders)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");
    const hours = parseInt(searchParams.get("hours") || "4"); // Default last 4 hours
    const limit = parseInt(searchParams.get("limit") || "50");

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required" },
        { status: 400 }
      );
    }

    // Get completed orders from the last N hours
    const since = subHours(new Date(), hours);

    // Order doesn't have tenantId directly, filter through location
    const orders = await prisma.order.findMany({
      where: {
        locationId,
        location: { tenantId },
        status: { in: ["READY", "SERVED", "PICKED_UP", "DELIVERED", "COMPLETED"] },
        updatedAt: { gte: since },
      },
      include: {
        items: {
          include: {
            modifiers: true,
            allergenNotes: { include: { allergen: true } },
          },
        },
        table: { select: { tableNumber: true, name: true } },
        kitchenQueue: {
          include: { station: { select: { name: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    // Calculate stats
    const stats = {
      totalOrders: orders.length,
      totalItems: orders.reduce((sum, o) => sum + o.items.length, 0),
      avgCompletionTime: 0,
      ordersByType: {
        DINE_IN: 0,
        TAKEAWAY: 0,
        DELIVERY: 0,
      },
    };

    let totalCompletionTime = 0;
    let completedWithTime = 0;

    for (const order of orders) {
      // Count by type
      if (order.orderType in stats.ordersByType) {
        stats.ordersByType[order.orderType as keyof typeof stats.ordersByType]++;
      }

      // Calculate completion time from kitchen queue
      for (const qi of order.kitchenQueue) {
        if (qi.createdAt && qi.completedAt) {
          totalCompletionTime += qi.completedAt.getTime() - qi.createdAt.getTime();
          completedWithTime++;
        }
      }
    }

    if (completedWithTime > 0) {
      stats.avgCompletionTime = Math.round(totalCompletionTime / completedWithTime / 60000); // minutes
    }

    // Format orders for display
    const history = orders.map((order) => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      displayNumber: order.displayNumber,
      orderType: order.orderType,
      table: order.table,
      status: order.status,
      customerName: order.customerName,
      itemCount: order.items.length,
      items: order.items.map((item) => ({
        productName: item.productName,
        variantName: item.variantName,
        quantity: item.quantity,
        modifiers: item.modifiers.map((m) => m.modifierName),
        hadAllergy: item.allergenNotes.some((an) => an.isAllergy),
      })),
      createdAt: order.createdAt,
      completedAt: order.completedAt || order.updatedAt,
    }));

    return NextResponse.json({
      success: true,
      history,
      stats,
      period: {
        since,
        hours,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get kitchen history error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
