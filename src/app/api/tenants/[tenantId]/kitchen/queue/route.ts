// GET /api/tenants/[tenantId]/kitchen/queue - Get kitchen queue for all/specific station

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get kitchen queue
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
    const stationId = searchParams.get("stationId");
    const status = searchParams.get("status"); // PENDING, IN_PROGRESS, READY

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required" },
        { status: 400 }
      );
    }

    // Validate location
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
    });

    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    // Order doesn't have tenantId directly, filter through location relation
    const where: any = {
      order: { locationId, location: { tenantId } },
    };

    if (stationId) {
      where.stationId = stationId;
    }

    if (status) {
      where.status = status;
    } else {
      // Default to active items
      where.status = { in: ["PENDING", "IN_PROGRESS"] };
    }

    const queueItems = await prisma.kitchenQueue.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            displayNumber: true,
            orderType: true,
            tableId: true,
            table: { select: { tableNumber: true, name: true } },
            customerName: true,
            createdAt: true,
            status: true,
          },
        },
        orderItem: {
          include: {
            product: { select: { name: true, imageUrl: true, prepTimeMinutes: true } },
            modifiers: true,
            allergenNotes: {
              include: { allergen: true },
            },
          },
        },
        station: { select: { id: true, name: true } },
      },
      orderBy: [
        { priority: "desc" },
        { createdAt: "asc" },
      ],
    });

    // Group by order for easier display
    const orderMap = new Map<string, any>();

    for (const item of queueItems) {
      const orderId = item.orderId;

      if (!orderMap.has(orderId)) {
        orderMap.set(orderId, {
          orderId,
          orderNumber: item.order.orderNumber,
          displayNumber: item.order.displayNumber,
          orderType: item.order.orderType,
          table: item.order.table,
          customerName: item.order.customerName,
          createdAt: item.order.createdAt,
          orderStatus: item.order.status,
          items: [],
          hasAllergyAlert: false,
          oldestItemTime: item.createdAt,
        });
      }

      const orderData = orderMap.get(orderId);

      // Check for allergy alerts
      const hasAllergy = item.orderItem.allergenNotes.some((an) => an.isAllergy);
      if (hasAllergy) {
        orderData.hasAllergyAlert = true;
      }

      orderData.items.push({
        queueId: item.id,
        itemId: item.orderItemId,
        productName: item.orderItem.productName,
        variantName: item.orderItem.variantName,
        quantity: item.orderItem.quantity,
        modifiers: item.orderItem.modifiers,
        specialInstructions: item.orderItem.specialInstructions,
        allergenNotes: item.orderItem.allergenNotes,
        status: item.status,
        priority: item.priority,
        station: item.station,
        prepTimeMinutes: item.orderItem.product?.prepTimeMinutes,
        startedAt: item.startedAt,
        createdAt: item.createdAt,
      });

      // Track oldest item time
      if (item.createdAt < orderData.oldestItemTime) {
        orderData.oldestItemTime = item.createdAt;
      }
    }

    // Convert to array and sort by oldest item
    const orders = Array.from(orderMap.values()).sort(
      (a, b) => a.oldestItemTime.getTime() - b.oldestItemTime.getTime()
    );

    // Calculate wait time for each order
    const now = new Date();
    for (const order of orders) {
      const waitMs = now.getTime() - order.oldestItemTime.getTime();
      order.waitMinutes = Math.floor(waitMs / 60000);
    }

    // Get station summary counts
    const stations = await prisma.kitchenStation.findMany({
      where: { locationId },
      include: {
        _count: {
          select: {
            kitchenQueue: {
              where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
            },
          },
        },
      },
      orderBy: { displayOrder: "asc" },
    });

    const stationSummary = stations.map((s) => ({
      id: s.id,
      name: s.name,
      activeCount: s._count.kitchenQueue,
    }));

    return NextResponse.json({
      success: true,
      location: { id: location.id, name: location.name },
      orders,
      totalOrders: orders.length,
      totalItems: queueItems.length,
      stationSummary,
    });
  } catch (error: any) {
    console.error("[TAP API] Get kitchen queue error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
