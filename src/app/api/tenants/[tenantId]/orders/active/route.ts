// GET /api/tenants/[tenantId]/orders/active - Get active orders (for counter display)

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get active orders
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
        { error: "locationId is required" },
        { status: 400 }
      );
    }

    // Get active orders (not completed or cancelled)
    // Note: Order doesn't have tenantId directly, filter through location
    const orders = await prisma.order.findMany({
      where: {
        locationId,
        location: { tenantId },
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      include: {
        items: {
          include: {
            modifiers: true,
            allergenNotes: { include: { allergen: true } },
          },
        },
        table: { select: { id: true, tableNumber: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Group by status for display
    const byStatus: Record<string, any[]> = {
      NEW: [],
      CONFIRMED: [],
      PREPARING: [],
      READY: [],
      SERVED: [],
      PICKED_UP: [],
      DELIVERED: [],
    };

    const now = new Date();

    for (const order of orders) {
      const waitMs = now.getTime() - order.createdAt.getTime();
      const waitMinutes = Math.floor(waitMs / 60000);

      const hasAllergyAlert = order.items.some((item) =>
        item.allergenNotes.some((an) => an.isAllergy)
      );

      const orderData = {
        id: order.id,
        orderNumber: order.orderNumber,
        displayNumber: order.displayNumber,
        orderType: order.orderType,
        table: order.table,
        customerName: order.customerName,
        status: order.status,
        paymentStatus: order.paymentStatus,
        total: order.total,
        itemCount: order.items.length,
        waitMinutes,
        hasAllergyAlert,
        createdAt: order.createdAt,
        createdBy: order.createdBy,
      };

      if (byStatus[order.status]) {
        byStatus[order.status].push(orderData);
      }
    }

    // Summary counts
    const summary = {
      total: orders.length,
      new: byStatus.NEW.length,
      preparing: byStatus.PREPARING.length,
      ready: byStatus.READY.length,
      awaitingPayment: orders.filter((o) => o.paymentStatus === "PENDING").length,
    };

    return NextResponse.json({
      success: true,
      orders,
      byStatus,
      summary,
    });
  } catch (error: any) {
    console.error("[TAP API] Get active orders error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
