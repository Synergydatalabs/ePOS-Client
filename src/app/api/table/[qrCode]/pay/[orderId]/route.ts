// GET /api/table/[qrCode]/pay/[orderId] - Get payment details for table order
// POST /api/table/[qrCode]/pay/[orderId] - Process payment for table order (UPFRONT)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import QRCode from "qrcode";

// Helper to validate guest token and order
async function validateGuestPayment(request: NextRequest, qrCode: string, orderId: string) {
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
    },
  });

  if (!guest || guest.session.tableId !== table.id) {
    return { success: false, error: "Invalid guest token", status: 401 };
  }

  // Get the order
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      sessionId: guest.session.id,
    },
    include: {
      items: {
        include: {
          modifiers: true,
          guest: { select: { id: true, guestName: true } },
        },
      },
    },
  });

  if (!order) {
    return { success: false, error: "Order not found", status: 404 };
  }

  return { success: true, guest, table, order };
}

// GET - Get payment details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string; orderId: string }> }
) {
  try {
    const { qrCode, orderId } = await params;
    const validation = await validateGuestPayment(request, qrCode, orderId);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const { order, table } = validation;
    const settings = table!.location.tenant.settings;

    return NextResponse.json({
      success: true,
      order: {
        id: order!.id,
        orderNumber: order!.orderNumber,
        displayNumber: order!.displayNumber,
        status: order!.status,
        paymentStatus: order!.paymentStatus,
        subtotal: order!.subtotal,
        taxAmount: order!.taxAmount,
        tax2Amount: order!.tax2Amount,
        tipAmount: order!.tipAmount,
        total: order!.total,
        currency: order!.currency,
        items: order!.items,
      },
      settings: {
        tipEnabled: settings?.tipEnabled ?? true,
        tipPresets: settings?.tipPresets ?? [15, 18, 20],
        tipCustomEnabled: settings?.tipCustomEnabled ?? true,
        taxLabel: settings?.taxLabel ?? "Tax",
        tax2Label: settings?.tax2Label ?? "Tax 2",
      },
      // Tenant info is rendered in the desktop side-panel for branding
      // (white-label partners show their own logo, not ZASHX).
      tenant: {
        id: table!.location.tenant.id,
        name: table!.location.tenant.name,
        logoUrl: table!.location.tenant.logoUrl,
        currency: table!.location.tenant.currency,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get payment details error:", error);
    return NextResponse.json(
      { error: "Failed to get payment details" },
      { status: 500 }
    );
  }
}

// POST - Process payment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string; orderId: string }> }
) {
  try {
    const { qrCode, orderId } = await params;
    const validation = await validateGuestPayment(request, qrCode, orderId);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const { order, table, guest } = validation;

    // Check order can be paid
    if (order!.paymentStatus === "COMPLETED") {
      return NextResponse.json(
        { error: "Order already paid" },
        { status: 400 }
      );
    }

    if (order!.status !== "PENDING_PAYMENT") {
      return NextResponse.json(
        { error: "Order is not pending payment" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { method, tipAmount } = body;

    // Calculate final total with tip
    let finalTotal = order!.total;
    if (tipAmount !== undefined && tipAmount > 0) {
      finalTotal = order!.subtotal + order!.taxAmount + (order!.tax2Amount || 0) + tipAmount;
    }

    // Handle online payment - generate payment session/QR
    if (method === "ONLINE" || !method) {
      // Generate payment URL (would integrate with TransferMate or other provider)
      const paymentUrl = `${process.env.NEXT_PUBLIC_APP_URL}/pay/${orderId}`;

      // Generate QR code
      const qrDataUrl = await QRCode.toDataURL(paymentUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 300,
      });

      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      await prisma.order.update({
        where: { id: orderId },
        data: {
          tipAmount: tipAmount || 0,
          total: finalTotal,
          paymentStatus: "PENDING",
          paymentMethod: "ONLINE",
          paymentUrl,
          paymentQrData: paymentUrl,
          paymentExpiresAt: expiresAt,
        },
      });

      return NextResponse.json({
        success: true,
        paymentUrl,
        qrCode: qrDataUrl,
        expiresAt,
        amount: finalTotal,
        message: "Payment session created",
      });
    }

    // For demo/testing: Allow marking as paid immediately
    if (method === "DEMO_PAID") {
      const result = await prisma.$transaction(async (tx) => {
        // Create payment record
        const payment = await tx.payment.create({
          data: {
            orderId,
            provider: "DEMO",
            amount: finalTotal,
            currency: order!.currency,
            status: "COMPLETED",
            method: "ONLINE",
            completedAt: new Date(),
          },
        });

        // Update order: mark as paid and change status to NEW (send to kitchen)
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            tipAmount: tipAmount || 0,
            total: finalTotal,
            paymentStatus: "COMPLETED",
            paymentMethod: "ONLINE",
            status: "NEW", // Now order goes to kitchen
            paidAt: new Date(),
          },
        });

        // Update session total spent
        await tx.tableSession.update({
          where: { id: guest!.session.id },
          data: {
            status: "DINING",
            lastActivityAt: new Date(),
            totalSpent: { increment: finalTotal },
          },
        });

        // NOW create kitchen queue items (order has been paid)
        const orderItems = await tx.orderItem.findMany({
          where: { orderId },
        });

        for (const item of orderItems) {
          await tx.kitchenQueue.create({
            data: {
              orderId,
              orderItemId: item.id,
              status: "PENDING",
            },
          });
        }

        return { payment, updatedOrder };
      });

      console.log(`[TAP API] Payment completed for table order: ${order!.orderNumber}`);

      return NextResponse.json({
        success: true,
        message: "Payment completed - order sent to kitchen",
        payment: result.payment,
        order: {
          id: result.updatedOrder.id,
          orderNumber: result.updatedOrder.orderNumber,
          status: result.updatedOrder.status,
          paymentStatus: result.updatedOrder.paymentStatus,
        },
      });
    }

    return NextResponse.json(
      { error: "Invalid payment method" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[TAP API] Process table payment error:", error);
    return NextResponse.json(
      { error: "Failed to process payment" },
      { status: 500 }
    );
  }
}
