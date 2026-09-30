// GET /api/tenants/[tenantId]/invoices/[invoiceId] - Get invoice details
// PATCH /api/tenants/[tenantId]/invoices/[invoiceId] - Update invoice
// DELETE /api/tenants/[tenantId]/invoices/[invoiceId] - Cancel invoice

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get invoice details
export async function GET(
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
        items: true,
        location: {
          select: { id: true, name: true, address: true },
        },
        payments: {
          include: {
            refunds: true,
          },
          orderBy: { createdAt: "desc" },
        },
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      invoice,
    });
  } catch (error: any) {
    console.error("[TAP API] Get invoice error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH - Update invoice (only while OPEN)
export async function PATCH(
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
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Can only update OPEN invoices
    if (invoice.status !== "OPEN") {
      return NextResponse.json(
        { error: "Can only update OPEN invoices" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { orderReference, notes, customerEmail, customerName } = body;

    const updateData: any = {};

    if (orderReference !== undefined) updateData.orderReference = orderReference;
    if (notes !== undefined) updateData.notes = notes;
    if (customerEmail !== undefined) updateData.customerEmail = customerEmail;
    if (customerName !== undefined) updateData.customerName = customerName;

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: updateData,
      include: {
        items: true,
        location: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      invoice: updated,
    });
  } catch (error: any) {
    console.error("[TAP API] Update invoice error:", error);
    return NextResponse.json(
      { error: "Failed to update invoice" },
      { status: 500 }
    );
  }
}

// DELETE - Cancel invoice
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; invoiceId: string }> }
) {
  try {
    const { tenantId, invoiceId } = await params;

    // Validate request - need at least manager to cancel
    const validation = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!validation.success) {
      return validation.response;
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
      },
      include: {
        payments: true,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Cannot cancel paid invoices - must refund instead
    if (invoice.status === "PAID") {
      return NextResponse.json(
        { error: "Cannot cancel paid invoice. Use refund instead." },
        { status: 400 }
      );
    }

    // Already cancelled
    if (invoice.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Invoice is already cancelled" },
        { status: 400 }
      );
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    console.log(`[TAP API] Cancelled invoice: ${invoice.invoiceNumber}`);

    return NextResponse.json({
      success: true,
      message: "Invoice cancelled",
    });
  } catch (error: any) {
    console.error("[TAP API] Cancel invoice error:", error);
    return NextResponse.json(
      { error: "Failed to cancel invoice" },
      { status: 500 }
    );
  }
}
