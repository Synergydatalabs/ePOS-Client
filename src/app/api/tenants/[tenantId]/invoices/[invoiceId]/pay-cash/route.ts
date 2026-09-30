// POST /api/tenants/[tenantId]/invoices/[invoiceId]/pay-cash - Mark invoice as paid by cash

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; invoiceId: string }> }
) {
  try {
    const { tenantId, invoiceId } = await params;

    // Validate request
    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
      },
      include: {
        payments: { where: { status: "PENDING" } },
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Can only pay OPEN or PENDING_PAYMENT invoices
    if (!["OPEN", "PENDING_PAYMENT"].includes(invoice.status)) {
      return NextResponse.json(
        { error: "Invoice is not payable" },
        { status: 400 }
      );
    }

    // Idempotency: check if already paid
    if (invoice.status === "PAID") {
      return NextResponse.json({
        success: true,
        invoice,
        message: "Invoice already paid",
      });
    }

    const body = await request.json().catch(() => ({}));
    const { amountReceived, notes } = body;

    // Update or create payment record for cash
    const pendingPayment = invoice.payments[0];

    if (pendingPayment) {
      await prisma.payment.update({
        where: { id: pendingPayment.id },
        data: {
          status: "COMPLETED",
          provider: "cash",
          method: "CASH",
          completedAt: new Date(),
        },
      });
    } else {
      await prisma.payment.create({
        data: {
          invoiceId,
          provider: "cash",
          amount: invoice.total,
          currency: invoice.currency,
          status: "COMPLETED",
          method: "CASH",
          completedAt: new Date(),
        },
      });
    }

    // Update invoice status
    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "PAID",
        paidAt: new Date(),
        // Clear any QR payment session data
        paymentUrl: null,
        paymentQrData: null,
        paymentExpiresAt: null,
        notes: notes ? `${invoice.notes || ""}\nCash payment${amountReceived ? ` - Amount received: $${(amountReceived / 100).toFixed(2)}` : ""}`.trim() : invoice.notes,
      },
      include: {
        items: true,
        location: {
          select: { id: true, name: true },
        },
        payments: true,
      },
    });

    console.log(`[iTAP API] Cash payment recorded for invoice: ${invoice.invoiceNumber}`);

    return NextResponse.json({
      success: true,
      invoice: updated,
      change: amountReceived ? Math.max(0, amountReceived - invoice.total) : 0,
    });
  } catch (error: any) {
    console.error("[iTAP API] Cash payment error:", error);
    return NextResponse.json(
      { error: "Failed to record cash payment" },
      { status: 500 }
    );
  }
}
