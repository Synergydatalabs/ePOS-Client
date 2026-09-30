// POST /api/tenants/[tenantId]/invoices/[invoiceId]/tip - Add tip to invoice

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

    const body = await request.json();
    const { tipAmount } = body;

    if (tipAmount === undefined || tipAmount < 0) {
      return NextResponse.json(
        { error: "Valid tip amount required (0 or positive number in cents)" },
        { status: 400 }
      );
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Can only add tip to OPEN or PENDING_PAYMENT invoices
    if (!["OPEN", "PENDING_PAYMENT"].includes(invoice.status)) {
      return NextResponse.json(
        { error: "Cannot modify tip on this invoice" },
        { status: 400 }
      );
    }

    // Calculate new total
    const newTotal = invoice.subtotal + invoice.taxAmount + Math.round(tipAmount);

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        tipAmount: Math.round(tipAmount),
        total: newTotal,
      },
      include: {
        items: true,
        location: {
          select: { id: true, name: true },
        },
      },
    });

    console.log(`[TAP API] Added tip $${(tipAmount / 100).toFixed(2)} to invoice: ${invoice.invoiceNumber}`);

    return NextResponse.json({
      success: true,
      invoice: updated,
    });
  } catch (error: any) {
    console.error("[TAP API] Add tip error:", error);
    return NextResponse.json(
      { error: "Failed to add tip" },
      { status: 500 }
    );
  }
}
