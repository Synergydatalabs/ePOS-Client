// Public kitchen bump — mark order item ready or bump whole order
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// PUT - update queue item status
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const { queueId, status } = await request.json();

    if (!queueId || !status) {
      return NextResponse.json({ error: "queueId and status required" }, { status: 400 });
    }

    // Verify queue item belongs to tenant+location
    const queueItem = await prisma.kitchenQueue.findFirst({
      where: {
        id: queueId,
        order: { locationId, location: { tenantId } },
      },
    });

    if (!queueItem) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }

    const updateData: any = { status };
    if (status === "IN_PROGRESS") updateData.startedAt = new Date();
    if (status === "READY" || status === "SERVED") updateData.completedAt = new Date();

    await prisma.kitchenQueue.update({
      where: { id: queueId },
      data: updateData,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PUBLIC KITCHEN] Bump error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST - bump entire order (mark all items as SERVED)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const { orderId } = await request.json();

    if (!orderId) {
      return NextResponse.json({ error: "orderId required" }, { status: 400 });
    }

    // Verify order belongs to tenant+location
    const order = await prisma.order.findFirst({
      where: { id: orderId, locationId, location: { tenantId } },
      select: { id: true, orderNumber: true },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    await prisma.kitchenQueue.updateMany({
      where: { orderId, status: { in: ["PENDING", "IN_PROGRESS"] } },
      data: { status: "SERVED", completedAt: new Date() },
    });

    // Advance order status to READY
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "READY" },
    });

    return NextResponse.json({ success: true, orderNumber: order.orderNumber });
  } catch (error) {
    console.error("[PUBLIC KITCHEN] Bump order error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
