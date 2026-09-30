// GET /api/table/[qrCode]/order - Get session orders
// POST /api/table/[qrCode]/order - Submit cart as order
// Supports two payment modes:
// - UPFRONT: Customer pays before order is sent to kitchen (like fast food)
// - PAY_AT_END: Order goes to kitchen immediately, customer pays at end (traditional restaurant)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Helper to validate guest token
async function validateGuest(request: NextRequest, qrCode: string) {
  const guestToken = request.headers.get("x-guest-token");

  if (!guestToken) {
    return { success: false, error: "Guest token required", status: 401 };
  }

  const table = await prisma.table.findUnique({
    where: { qrCode },
    include: {
      location: {
        include: {
          tenant: {
            include: { settings: true },
          },
        },
      },
    },
  });

  if (!table || !table.isActive) {
    return { success: false, error: "Table not found", status: 404 };
  }

  const guest = await prisma.tableGuest.findUnique({
    where: { guestToken },
    include: {
      session: true,
      cartItems: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!guest || guest.session.tableId !== table.id) {
    return { success: false, error: "Invalid guest token", status: 401 };
  }

  return { success: true, guest, table };
}

// GET - Get all orders for this session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;
    const validation = await validateGuest(request, qrCode);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const orders = await prisma.order.findMany({
      where: { sessionId: validation.guest!.session.id },
      include: {
        items: {
          include: {
            modifiers: true,
            guest: {
              select: { id: true, guestName: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate session total
    const sessionTotal = orders.reduce((sum, order) => sum + order.total, 0);

    return NextResponse.json({
      success: true,
      orders,
      sessionTotal,
    });
  } catch (error: any) {
    console.error("[TAP API] Get orders error:", error);
    return NextResponse.json(
      { error: "Failed to get orders" },
      { status: 500 }
    );
  }
}

// POST - Submit cart as order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;
    const validation = await validateGuest(request, qrCode);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const { guest, table } = validation;

    if (!["ACTIVE", "ORDERING", "DINING"].includes(guest!.session.status)) {
      return NextResponse.json(
        { error: "Session is not accepting orders" },
        { status: 400 }
      );
    }

    if (guest!.cartItems.length === 0) {
      return NextResponse.json(
        { error: "Cart is empty" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { specialInstructions } = body;

    const settings = table!.location.tenant.settings;
    const currency = table!.location.tenant.currency;
    const paymentType = settings?.tablePaymentType || "UPFRONT";

    // Calculate totals
    let subtotal = 0;
    const orderItems: any[] = [];

    for (const cartItem of guest!.cartItems) {
      const modifiersTotal = cartItem.modifiers
        ? (cartItem.modifiers as any[]).reduce((m, mod) => m + (mod.price * (mod.quantity || 1)), 0)
        : 0;

      const itemTotal = (cartItem.unitPrice + modifiersTotal) * cartItem.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: cartItem.productId,
        variantId: cartItem.variantId,
        productName: cartItem.product.name,
        variantName: null, // TODO: Include variant name
        quantity: cartItem.quantity,
        unitPrice: cartItem.unitPrice,
        modifiersTotal,
        itemTotal,
        unitCost: cartItem.product.costPrice,
        specialInstructions: cartItem.specialInstructions,
        guestId: guest!.id,
        modifiers: cartItem.modifiers ? (cartItem.modifiers as any[]).map(mod => ({
          modifierId: mod.modifierId,
          modifierName: mod.name,
          price: mod.price,
        })) : [],
      });
    }

    // Calculate tax
    const taxRate = settings?.taxEnabled ? Number(settings.taxRate) : 0;
    const tax2Rate = settings?.tax2Enabled ? Number(settings.tax2Rate) : 0;
    const taxAmount = Math.round((subtotal * taxRate) / 100);
    const tax2Amount = Math.round((subtotal * tax2Rate) / 100);
    const total = subtotal + taxAmount + tax2Amount;

    // Generate order number
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const orderCount = await prisma.order.count({
      where: {
        locationId: table!.location.id,
        createdAt: { gte: today },
      },
    });

    const orderNumber = `DW-${(orderCount + 1).toString().padStart(4, "0")}`;
    const displayNumber = ((orderCount + 1) % 100) || 100;

    // For UPFRONT payment: Create order with PENDING_PAYMENT status, don't send to kitchen yet
    // For PAY_AT_END: Create order with NEW status and send to kitchen immediately
    const isUpfrontPayment = paymentType === "UPFRONT";
    const orderStatus = isUpfrontPayment ? "PENDING_PAYMENT" : "NEW";
    const paymentStatus = isUpfrontPayment ? "PENDING" : "PENDING";

    // Create order with items in a transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          locationId: table!.location.id,
          tableId: table!.id,
          sessionId: guest!.session.id,
          orderNumber,
          displayNumber,
          orderType: "DINE_IN",
          status: orderStatus,
          subtotal,
          taxAmount,
          tax2Amount,
          total,
          currency,
          notes: specialInstructions,
          paymentStatus,
          items: {
            create: orderItems.map(item => ({
              productId: item.productId,
              variantId: item.variantId,
              productName: item.productName,
              variantName: item.variantName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              modifiersTotal: item.modifiersTotal,
              itemTotal: item.itemTotal,
              unitCost: item.unitCost,
              specialInstructions: item.specialInstructions,
              guestId: item.guestId,
              modifiers: {
                create: item.modifiers,
              },
            })),
          },
        },
        include: {
          items: {
            include: {
              modifiers: true,
            },
          },
        },
      });

      // Clear cart items
      await tx.guestCartItem.deleteMany({
        where: { guestId: guest!.id },
      });

      // Update session
      await tx.tableSession.update({
        where: { id: guest!.session.id },
        data: {
          status: isUpfrontPayment ? "ORDERING" : "DINING",
          lastActivityAt: new Date(),
          // Only increment totalSpent for PAY_AT_END (UPFRONT will increment after payment)
          ...(isUpfrontPayment ? {} : { totalSpent: { increment: total } }),
        },
      });

      // For PAY_AT_END: Create kitchen queue items immediately
      // For UPFRONT: Kitchen items will be created after payment is confirmed
      if (!isUpfrontPayment) {
        for (const item of newOrder.items) {
          await tx.kitchenQueue.create({
            data: {
              orderId: newOrder.id,
              orderItemId: item.id,
              status: "PENDING",
            },
          });
        }
      }

      return newOrder;
    });

    console.log(`[TAP API] Order created from table ${table!.tableNumber}: ${order.orderNumber} (${paymentType})`);

    // Response includes payment info for UPFRONT orders
    const response: any = {
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        displayNumber: order.displayNumber,
        status: order.status,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        total: order.total,
        items: order.items,
      },
      paymentType,
    };

    // For UPFRONT payment, include payment URL
    if (isUpfrontPayment) {
      response.requiresPayment = true;
      response.paymentUrl = `/table/${qrCode}/pay/${order.id}`;
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[TAP API] Create order error:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}
