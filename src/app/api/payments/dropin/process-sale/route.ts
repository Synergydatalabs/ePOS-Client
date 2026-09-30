// POST /api/payments/dropin/process-sale
// Charges a card using the paymentReference returned by the Drop-in UI.
// Updates the order to PAID on success.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { processDropinSale } from "@/lib/gp-dropin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      paymentReference,
      amount: amountRaw,
      currency,
      orderId,
      tenantId,
      description,
      walletType,
    } = body as {
      paymentReference?: string;
      amount?: number | string;
      currency?: string;
      orderId?: string;
      tenantId?: string;
      description?: string;
      // Wallet payments send the raw Apple/Google token payload as
      // paymentReference and tell us how to wrap it for GP via walletType.
      // Accept both forward-compat strings (GP's spec uses PAY_BY_GOOGLE,
      // browser may send GOOGLEPAY).
      walletType?: "APPLEPAY" | "PAY_BY_GOOGLE" | "GOOGLEPAY";
    };

    if (!paymentReference) {
      return NextResponse.json(
        { success: false, error: "paymentReference is required" },
        { status: 400 }
      );
    }

    // Amount coming from the browser may be a string — coerce.
    const amount =
      typeof amountRaw === "string"
        ? Math.round(parseFloat(amountRaw) * 100)
        : typeof amountRaw === "number"
        ? Math.round(amountRaw)
        : 0;

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: "amount must be > 0 (in cents)" },
        { status: 400 }
      );
    }

    // If orderId is provided, resolve it to validate and enrich metadata.
    let order: any = null;
    if (orderId) {
      order = await prisma.order.findFirst({
        where: { id: orderId },
        include: { location: { select: { tenantId: true } } },
      });

      if (!order) {
        return NextResponse.json(
          { success: false, error: "Order not found" },
          { status: 404 }
        );
      }

      if (tenantId && order.location.tenantId !== tenantId) {
        return NextResponse.json(
          { success: false, error: "Order does not belong to this tenant" },
          { status: 403 }
        );
      }

      if (order.paymentStatus === "PAID") {
        return NextResponse.json(
          { success: false, error: "Order is already paid" },
          { status: 400 }
        );
      }
    }

    // Normalize wallet type — GP expects PAY_BY_GOOGLE specifically.
    const normalizedWalletType =
      walletType === "GOOGLEPAY"
        ? ("PAY_BY_GOOGLE" as const)
        : walletType === "APPLEPAY" || walletType === "PAY_BY_GOOGLE"
        ? walletType
        : undefined;

    // Charge via GP Drop-in
    const result = await processDropinSale({
      paymentReference,
      amount,
      currency: currency || order?.currency || undefined,
      reference: order?.orderNumber || orderId || undefined,
      description: description || (order ? `Order ${order.orderNumber}` : undefined),
      walletType: normalizedWalletType,
    });

    // On success, mark the order as paid
    if (result.success && order) {
      try {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: "PAID" as any, // Prisma client out-of-sync; runtime value is valid
            paymentMethod: "CARD",
            ...(order.status === "NEW" && { status: "CONFIRMED" as any }),
          },
        });
      } catch (updateErr) {
        console.error("[DROPIN] Failed to mark order paid:", updateErr);
        // Still return the transaction result — the payment itself went through.
      }
    }

    return NextResponse.json({
      success: result.success,
      transactionId: result.transactionId,
      status: result.status,
      responseCode: result.responseCode,
      responseMessage: result.responseMessage,
      authCode: result.authCode,
      cardBrand: result.cardBrand,
      cardLast4: result.cardLast4,
      amount: result.amount,
      currency: result.currency,
      reference: result.reference,
      error: result.error,
    });
  } catch (error: any) {
    console.error("[DROPIN] process-sale error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to process payment",
      },
      { status: 500 }
    );
  }
}
