// GET /api/tenants/[tenantId]/orders/[orderId] - Get order details
// PUT /api/tenants/[tenantId]/orders/[orderId] - Update order status
// DELETE /api/tenants/[tenantId]/orders/[orderId] - Cancel order

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get order details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, location: { tenantId } },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, imageUrl: true } },
            modifiers: true,
            allergenNotes: { include: { allergen: true } },
            kitchenQueue: {
              include: { station: true },
            },
          },
        },
        table: true,
        location: { select: { id: true, name: true, tenantId: true } },
        createdBy: { select: { firstName: true, lastName: true, email: true } },
        // Include per-payment refunds so the admin order page can show the
        // refund ledger + compute per-payment refundable headroom for the
        // refund modal.
        payments: {
          include: {
            refunds: {
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                amount: true,
                reason: true,
                status: true,
                providerRef: true,
                createdAt: true,
                completedAt: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    // Calculate profit
    const profit = order.total - order.totalCost;
    const profitMargin = order.total > 0 ? (profit / order.total) * 100 : 0;

    return NextResponse.json({
      success: true,
      order: {
        ...order,
        profit,
        profitMargin: Math.round(profitMargin * 100) / 100,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get order error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update order (status, add items, etc.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const {
      status,
      paymentStatus,
      paymentMethod,
      tipAmount,
      discountAmount,
      customerName,
      customerPhone,
      customerEmail,
      deliveryAddress,
      deliveryNotes,
      notes,
    } = body;

    const existing = await prisma.order.findFirst({
      where: { id: orderId, location: { tenantId } },
      include: { table: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    // Validate status transitions
    const validStatuses = [
      "NEW", "CONFIRMED", "PREPARING", "READY", "SERVED",
      "PICKED_UP", "DELIVERED", "COMPLETED", "CANCELLED",
    ];

    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Prevent updating cancelled orders
    if (existing.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Cannot update cancelled order" },
        { status: 400 }
      );
    }

    // Recalculate total if tip or discount changed
    let newTotal = existing.total;
    if (tipAmount !== undefined || discountAmount !== undefined) {
      const newTip = tipAmount ?? existing.tipAmount;
      const newDiscount = discountAmount ?? existing.discountAmount;
      newTotal = existing.subtotal + existing.taxAmount + existing.tax2Amount - newDiscount + newTip;
    }

    const order = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          ...(status !== undefined && { status: status as any }),
          ...(paymentStatus !== undefined && { paymentStatus: paymentStatus as any }),
          ...(paymentMethod !== undefined && { paymentMethod }),
          ...(tipAmount !== undefined && { tipAmount, total: newTotal }),
          ...(discountAmount !== undefined && { discountAmount, total: newTotal }),
          ...(customerName !== undefined && { customerName }),
          ...(customerPhone !== undefined && { customerPhone }),
          ...(customerEmail !== undefined && { customerEmail }),
          ...(deliveryAddress !== undefined && { deliveryAddress }),
          ...(deliveryNotes !== undefined && { deliveryNotes }),
          ...(notes !== undefined && { notes }),
          ...(status === "COMPLETED" && { completedAt: new Date() }),
        },
        include: {
          items: {
            include: {
              modifiers: true,
              allergenNotes: { include: { allergen: true } },
            },
          },
          table: true,
          location: { select: { id: true, name: true } },
        },
      });

      // Update table status based on order status
      if (updated.tableId && updated.table) {
        if (status === "COMPLETED" || status === "CANCELLED") {
          // Check if table has other active orders
          const activeOrders = await tx.order.count({
            where: {
              tableId: updated.tableId,
              id: { not: orderId },
              status: { notIn: ["COMPLETED", "CANCELLED"] },
            },
          });

          if (activeOrders === 0) {
            await tx.table.update({
              where: { id: updated.tableId },
              data: { status: "CLEANING" },
            });
          }
        }
      }

      // Update kitchen queue if order completed/cancelled
      if (status === "COMPLETED" || status === "CANCELLED") {
        await tx.kitchenQueue.updateMany({
          where: {
            orderId,
            status: { notIn: ["SERVED", "CANCELLED"] },
          },
          data: {
            status: status === "COMPLETED" ? "SERVED" : "CANCELLED",
            completedAt: new Date(),
          },
        });
      }

      return updated;
    });

    console.log(`[TAP API] Updated order: ${order.orderNumber} status: ${order.status}`);

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (error: any) {
    console.error("[TAP API] Update order error:", error);
    return NextResponse.json(
      { error: "Failed to update order" },
      { status: 500 }
    );
  }
}

// DELETE - Cancel order
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const reason = searchParams.get("reason") || "Cancelled by staff";

    const order = await prisma.order.findFirst({
      where: { id: orderId, location: { tenantId } },
      include: {
        items: { include: { product: { include: { recipes: true } } } },
        table: true,
      },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    if (order.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Order already cancelled" },
        { status: 400 }
      );
    }

    if (order.status === "COMPLETED") {
      return NextResponse.json(
        { error: "Cannot cancel completed order" },
        { status: 400 }
      );
    }

    // Get settings for inventory
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    await prisma.$transaction(async (tx) => {
      // Cancel order
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "CANCELLED",
          notes: order.notes
            ? `${order.notes}\n[CANCELLED] ${reason}`
            : `[CANCELLED] ${reason}`,
        },
      });

      // Cancel all items
      await tx.orderItem.updateMany({
        where: { orderId },
        data: { status: "CANCELLED" },
      });

      // Cancel kitchen queue items
      await tx.kitchenQueue.updateMany({
        where: { orderId },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
        },
      });

      // Restore inventory if it was deducted
      if (settings?.autoDeductInventory) {
        for (const item of order.items) {
          if (item.product?.trackInventory) {
            for (const recipe of item.product.recipes) {
              const qty = recipe.quantity * item.quantity;

              const inv = await tx.locationInventory.findUnique({
                where: {
                  locationId_ingredientId: {
                    locationId: order.locationId,
                    ingredientId: recipe.ingredientId,
                  },
                },
              });

              if (inv) {
                await tx.locationInventory.update({
                  where: { id: inv.id },
                  data: { currentStock: inv.currentStock + qty },
                });

                await tx.stockMovement.create({
                  data: {
                    locationId: order.locationId,
                    ingredientId: recipe.ingredientId,
                    type: "RETURN",
                    quantity: qty,
                    previousStock: inv.currentStock,
                    newStock: inv.currentStock + qty,
                    reason: `Order cancelled: ${order.orderNumber}`,
                    orderId: order.id,
                    createdById: validation.context.membership.id,
                  },
                });
              }
            }
          }
        }
      }

      // Update table status
      if (order.tableId) {
        const activeOrders = await tx.order.count({
          where: {
            tableId: order.tableId,
            id: { not: orderId },
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
        });

        if (activeOrders === 0) {
          await tx.table.update({
            where: { id: order.tableId },
            data: { status: "AVAILABLE" },
          });
        }
      }
    });

    console.log(`[TAP API] Cancelled order: ${order.orderNumber}`);

    return NextResponse.json({
      success: true,
      message: "Order cancelled",
      orderNumber: order.orderNumber,
    });
  } catch (error: any) {
    console.error("[TAP API] Cancel order error:", error);
    return NextResponse.json(
      { error: "Failed to cancel order" },
      { status: 500 }
    );
  }
}
