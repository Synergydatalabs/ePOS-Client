// POST /api/tenants/[tenantId]/kitchen/bump - Bump order (mark all items as ready/served)

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Bump entire order (all items ready)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { orderId, action = "READY" } = body; // READY or SERVED

    if (!orderId) {
      return NextResponse.json(
        { error: "orderId is required" },
        { status: 400 }
      );
    }

    // Get order (Order doesn't have tenantId directly, filter through location)
    const order = await prisma.order.findFirst({
      where: { id: orderId, location: { tenantId } },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    const targetStatus = action === "SERVED" ? "SERVED" : "READY";
    const orderItemStatus = action === "SERVED" ? "SERVED" : "READY";

    const result = await prisma.$transaction(async (tx) => {
      // Update all kitchen queue items
      const queueUpdate = await tx.kitchenQueue.updateMany({
        where: {
          orderId,
          status: { notIn: ["SERVED", "CANCELLED"] },
        },
        data: {
          status: targetStatus,
          completedAt: new Date(),
          updatedById: validation.context.membership.id,
        },
      });

      // Update all order items
      await tx.orderItem.updateMany({
        where: {
          orderId,
          status: { notIn: ["SERVED", "CANCELLED"] },
        },
        data: { status: orderItemStatus },
      });

      // Update order status
      let newOrderStatus: any = "READY";
      if (action === "SERVED") {
        if (order.orderType === "DINE_IN") {
          newOrderStatus = "SERVED";
        } else if (order.orderType === "TAKEAWAY") {
          newOrderStatus = "PICKED_UP";
        } else if (order.orderType === "DELIVERY") {
          newOrderStatus = "DELIVERED";
        }
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: newOrderStatus },
      });

      return queueUpdate;
    });

    console.log(`[TAP API] Bumped order ${order.orderNumber} to ${targetStatus}`);

    return NextResponse.json({
      success: true,
      message: `Order bumped to ${targetStatus}`,
      orderNumber: order.orderNumber,
      itemsUpdated: result.count,
    });
  } catch (error: any) {
    console.error("[TAP API] Bump order error:", error);
    return NextResponse.json(
      { error: "Failed to bump order" },
      { status: 500 }
    );
  }
}
