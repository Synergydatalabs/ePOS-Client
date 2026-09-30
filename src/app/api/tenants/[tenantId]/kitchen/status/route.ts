// GET /api/tenants/[tenantId]/kitchen/status - Get current kitchen load status

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get current kitchen load status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");

    if (!locationId) {
      return NextResponse.json(
        { error: "Location ID is required" },
        { status: 400 }
      );
    }

    // Get load rule
    const loadRule = await prisma.kitchenLoadRule.findFirst({
      where: { tenantId, locationId, isActive: true },
    });

    // Get current kitchen metrics
    const [activeOrders, queueItems, avgPrepTime] = await Promise.all([
      // Active orders count
      prisma.order.count({
        where: {
          locationId,
          status: { in: ["CONFIRMED", "PREPARING"] },
        },
      }),
      // Items in queue
      prisma.kitchenQueue.count({
        where: {
          order: { locationId },
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
      }),
      // Average prep time from completed items in last hour
      prisma.kitchenQueue.aggregate({
        where: {
          order: { locationId },
          status: "READY",
          completedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          startedAt: { not: null },
        },
        _avg: {
          // Calculate average time in minutes (completedAt - startedAt)
        },
      }),
    ]);

    // Get delayed orders (orders taking longer than expected)
    const delayedOrders = await prisma.order.findMany({
      where: {
        locationId,
        status: { in: ["CONFIRMED", "PREPARING"] },
        createdAt: { lt: new Date(Date.now() - 20 * 60 * 1000) }, // Older than 20 min
      },
      select: {
        id: true,
        orderNumber: true,
        displayNumber: true,
        createdAt: true,
        table: { select: { tableNumber: true } },
      },
    });

    // Calculate load percentage
    const maxOrders = loadRule?.maxActiveOrders || 20;
    const maxItems = loadRule?.maxItemsInQueue || 50;
    const orderLoad = Math.min((activeOrders / maxOrders) * 100, 100);
    const itemLoad = Math.min((queueItems / maxItems) * 100, 100);
    const overallLoad = Math.max(orderLoad, itemLoad);

    // Determine status
    let status: "normal" | "busy" | "overloaded" = "normal";
    if (overallLoad >= 100) {
      status = "overloaded";
    } else if (overallLoad >= 75) {
      status = "busy";
    }

    // Estimate wait time based on current load
    const baseWaitTime = 15; // Base 15 minutes
    const estimatedWaitTime = Math.round(
      baseWaitTime * (1 + overallLoad / 100)
    );

    return NextResponse.json({
      success: true,
      status: {
        current: status,
        activeOrders,
        maxActiveOrders: maxOrders,
        queueItems,
        maxItemsInQueue: maxItems,
        orderLoadPercent: Math.round(orderLoad),
        itemLoadPercent: Math.round(itemLoad),
        overallLoadPercent: Math.round(overallLoad),
        estimatedWaitMinutes: estimatedWaitTime,
        delayedOrders: delayedOrders.map((o) => ({
          ...o,
          waitMinutes: Math.round(
            (Date.now() - new Date(o.createdAt).getTime()) / 60000
          ),
        })),
        delayedOrderCount: delayedOrders.length,
      },
      actions: loadRule
        ? {
            pausePromotions: status !== "normal" && loadRule.pausePromotions,
            hideSlowItems: status === "overloaded" && loadRule.hideSlowItems,
            showWaitTime: loadRule.showWaitTime,
            customMessage:
              status !== "normal" ? loadRule.customMessage : null,
          }
        : null,
    });
  } catch (error: any) {
    console.error("[TAP API] Get kitchen status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
