// POST /api/tenants/[tenantId]/kitchen/recall - Recall a bumped order back to queue

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Recall order back to kitchen queue
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
    const { orderId, itemId } = body; // itemId optional - recall specific item or whole order

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

    const where: any = {
      orderId,
      status: "READY", // Can only recall ready items
    };

    if (itemId) {
      where.orderItemId = itemId;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Update kitchen queue items back to pending
      const queueUpdate = await tx.kitchenQueue.updateMany({
        where,
        data: {
          status: "PENDING",
          completedAt: null,
          startedAt: null,
          updatedById: validation.context.membership.id,
        },
      });

      // Update order items
      const itemWhere: any = { orderId, status: "READY" };
      if (itemId) itemWhere.id = itemId;

      await tx.orderItem.updateMany({
        where: itemWhere,
        data: { status: "PENDING" },
      });

      // Update order status if recalling whole order
      if (!itemId) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "PREPARING" },
        });
      }

      return queueUpdate;
    });

    console.log(`[TAP API] Recalled order ${order.orderNumber}${itemId ? ` item ${itemId}` : ""}`);

    return NextResponse.json({
      success: true,
      message: itemId ? "Item recalled" : "Order recalled",
      orderNumber: order.orderNumber,
      itemsRecalled: result.count,
    });
  } catch (error: any) {
    console.error("[TAP API] Recall order error:", error);
    return NextResponse.json(
      { error: "Failed to recall order" },
      { status: 500 }
    );
  }
}
