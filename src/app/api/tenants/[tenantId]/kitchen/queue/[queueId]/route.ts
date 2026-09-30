// PUT /api/tenants/[tenantId]/kitchen/queue/[queueId] - Update queue item status

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// PUT - Update kitchen queue item (start cooking, mark ready, etc.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; queueId: string }> }
) {
  try {
    const { tenantId, queueId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { status, priority } = body;

    // Get queue item (Order doesn't have tenantId directly, get it through location)
    const queueItem = await prisma.kitchenQueue.findUnique({
      where: { id: queueId },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            location: { select: { tenantId: true } },
          }
        },
        orderItem: true,
        station: true,
      },
    });

    if (!queueItem || queueItem.order.location.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Queue item not found" },
        { status: 404 }
      );
    }

    // Validate status
    const validStatuses = ["PENDING", "IN_PROGRESS", "READY", "SERVED", "CANCELLED"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Update queue item
    const updateData: any = {};

    if (status !== undefined) {
      updateData.status = status;
      updateData.updatedById = validation.context.membership.id;

      // Set timestamps based on status
      if (status === "IN_PROGRESS" && !queueItem.startedAt) {
        updateData.startedAt = new Date();
      }
      if (status === "READY" || status === "SERVED" || status === "CANCELLED") {
        updateData.completedAt = new Date();
      }
    }

    if (priority !== undefined) {
      updateData.priority = priority;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.kitchenQueue.update({
        where: { id: queueId },
        data: updateData,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              displayNumber: true,
              orderType: true,
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
      });

      // Update order item status to match
      if (status) {
        let orderItemStatus = "PENDING";
        if (status === "IN_PROGRESS") orderItemStatus = "COOKING";
        else if (status === "READY") orderItemStatus = "READY";
        else if (status === "SERVED") orderItemStatus = "SERVED";
        else if (status === "CANCELLED") orderItemStatus = "CANCELLED";

        await tx.orderItem.update({
          where: { id: queueItem.orderItemId },
          data: { status: orderItemStatus as any },
        });
      }

      // Check if all items for this order are ready
      if (status === "READY") {
        const pendingItems = await tx.kitchenQueue.count({
          where: {
            orderId: queueItem.orderId,
            status: { in: ["PENDING", "IN_PROGRESS"] },
          },
        });

        if (pendingItems === 0) {
          // All items ready - update order status
          await tx.order.update({
            where: { id: queueItem.orderId },
            data: { status: "READY" },
          });
        }
      }

      return item;
    });

    console.log(
      `[TAP API] Kitchen queue item ${queueId} updated to ${status || "priority " + priority}`
    );

    return NextResponse.json({
      success: true,
      queueItem: updated,
    });
  } catch (error: any) {
    console.error("[TAP API] Update kitchen queue error:", error);
    return NextResponse.json(
      { error: "Failed to update queue item" },
      { status: 500 }
    );
  }
}
