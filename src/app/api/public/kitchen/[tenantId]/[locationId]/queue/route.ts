// Public kitchen display queue — for iPad/TV kitchen screens
// Locked to tenantId + locationId in URL. Read-only for display.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const { searchParams } = new URL(request.url);
    const stationId = searchParams.get("stationId");

    // Validate location belongs to tenant
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true, name: true },
    });

    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const where: any = {
      order: { locationId, location: { tenantId } },
      status: { in: ["PENDING", "IN_PROGRESS"] },
    };

    if (stationId) {
      where.stationId = stationId;
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
            table: { select: { tableNumber: true, name: true } },
            customerName: true,
            createdAt: true,
          },
        },
        orderItem: {
          include: {
            modifiers: true,
            allergenNotes: { include: { allergen: true } },
          },
        },
        station: { select: { id: true, name: true } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });

    // Group by order
    const orderMap = new Map<string, any>();

    for (const item of queueItems) {
      const oid = item.orderId;

      if (!orderMap.has(oid)) {
        orderMap.set(oid, {
          orderId: oid,
          orderNumber: item.order.orderNumber,
          displayNumber: item.order.displayNumber,
          orderType: item.order.orderType,
          table: item.order.table,
          customerName: item.order.customerName,
          createdAt: item.order.createdAt,
          items: [],
          hasAllergyAlert: false,
          oldestItemTime: item.createdAt,
        });
      }

      const orderData = orderMap.get(oid);
      const hasAllergy = item.orderItem.allergenNotes.some((an) => an.isAllergy);
      if (hasAllergy) orderData.hasAllergyAlert = true;

      orderData.items.push({
        queueId: item.id,
        productName: item.orderItem.productName,
        variantName: item.orderItem.variantName,
        quantity: item.orderItem.quantity,
        modifiers: item.orderItem.modifiers.map((m) => ({ name: m.modifierName, price: m.price })),
        specialInstructions: item.orderItem.specialInstructions,
        allergenNotes: item.orderItem.allergenNotes.map((an) => ({
          allergen: an.allergen?.name,
          isAllergy: an.isAllergy,
          note: an.note,
        })),
        status: item.status,
        station: item.station,
      });

      if (item.createdAt < orderData.oldestItemTime) {
        orderData.oldestItemTime = item.createdAt;
      }
    }

    const orders = Array.from(orderMap.values()).sort(
      (a, b) => a.oldestItemTime.getTime() - b.oldestItemTime.getTime()
    );

    const now = new Date();
    for (const order of orders) {
      order.waitMinutes = Math.floor((now.getTime() - order.oldestItemTime.getTime()) / 60000);
    }

    // Station summary
    const stations = await prisma.kitchenStation.findMany({
      where: { locationId },
      include: {
        _count: {
          select: {
            kitchenQueue: { where: { status: { in: ["PENDING", "IN_PROGRESS"] } } },
          },
        },
      },
      orderBy: { displayOrder: "asc" },
    });

    const stationSummary = stations.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      activeCount: s._count.kitchenQueue,
    }));

    return NextResponse.json({
      success: true,
      location,
      orders,
      totalOrders: orders.length,
      stationSummary,
    });
  } catch (error) {
    console.error("[PUBLIC KITCHEN] Queue error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
