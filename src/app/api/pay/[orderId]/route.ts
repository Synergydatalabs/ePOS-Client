// GET /api/pay/[orderId] - Public endpoint to get order payment status
// This is a public endpoint - no authentication required
// Only returns limited order information needed for payment

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        displayNumber: true,
        subtotal: true,
        taxAmount: true,
        tax2Amount: true,
        tipAmount: true,
        total: true,
        currency: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentExpiresAt: true,
        location: {
          select: {
            name: true,
            tenant: {
              select: {
                name: true,
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

    // Check if payment session expired
    if (order.paymentExpiresAt && new Date() > new Date(order.paymentExpiresAt)) {
      return NextResponse.json(
        { error: "Payment session expired" },
        { status: 410 }
      );
    }

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        displayNumber: order.displayNumber,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        tax2Amount: order.tax2Amount,
        tipAmount: order.tipAmount,
        total: order.total,
        currency: order.currency,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        location: order.location,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get order payment status error:", error);
    return NextResponse.json(
      { error: "Failed to get order" },
      { status: 500 }
    );
  }
}

// POST /api/pay/[orderId] - Complete online payment (webhook from payment provider)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const body = await request.json();

    // In production, this would verify the webhook signature from the payment provider
    // For now, we'll accept a simple confirmation
    const { paymentId, provider, status } = body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    if (order.paymentStatus === "COMPLETED") {
      return NextResponse.json({
        success: true,
        message: "Payment already completed",
      });
    }

    if (status === "completed" || status === "success") {
      await prisma.$transaction(async (tx) => {
        // Create payment record
        await tx.payment.create({
          data: {
            orderId,
            provider: provider || "ONLINE",
            amount: order.total,
            currency: order.currency,
            status: "COMPLETED",
            method: "ONLINE",
            externalId: paymentId,
            completedAt: new Date(),
          },
        });

        // Update order - set both paymentStatus and status
        await tx.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: "COMPLETED",
            status: order.orderType === "TAKEAWAY" ? "READY" : order.status,
            paidAt: new Date(),
          },
        });
      });

      console.log(`[TAP API] Online payment completed for order: ${order.orderNumber}`);

      return NextResponse.json({
        success: true,
        message: "Payment completed",
      });
    }

    return NextResponse.json(
      { error: "Invalid payment status" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[TAP API] Process online payment error:", error);
    return NextResponse.json(
      { error: "Failed to process payment" },
      { status: 500 }
    );
  }
}
