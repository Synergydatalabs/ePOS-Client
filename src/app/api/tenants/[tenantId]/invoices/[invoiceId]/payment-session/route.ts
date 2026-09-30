// POST /api/tenants/[tenantId]/invoices/[invoiceId]/payment-session
// Generate payment session and QR code for customer payment

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { addMinutes } from "date-fns";

const PAYMENT_SESSION_EXPIRY_MINUTES = 30;

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
        tenant: {
          select: { name: true, slug: true, currency: true },
        },
        location: {
          select: { name: true },
        },
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Can only create payment session for OPEN invoices
    if (!["OPEN", "PENDING_PAYMENT"].includes(invoice.status)) {
      return NextResponse.json(
        { error: "Invoice is not payable" },
        { status: 400 }
      );
    }

    // Check if there's already a valid payment session
    if (
      invoice.paymentUrl &&
      invoice.paymentExpiresAt &&
      new Date(invoice.paymentExpiresAt) > new Date()
    ) {
      return NextResponse.json({
        success: true,
        paymentUrl: invoice.paymentUrl,
        qrPayload: invoice.paymentQrData,
        expiresAt: invoice.paymentExpiresAt,
        message: "Existing payment session still valid",
      });
    }

    // TODO: Call iTip payment API to create payment session
    // For now, create a local payment URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://tap.zashx.com";
    const paymentUrl = `${appUrl}/pay/${invoice.id}`;
    const expiresAt = addMinutes(new Date(), PAYMENT_SESSION_EXPIRY_MINUTES);

    // In production, you would:
    // 1. Call iTip API: POST /api/payments/session
    // 2. Get back a payment URL and session ID
    // 3. Store the session reference

    /*
    const itipResponse = await fetch(`${process.env.ITIP_API_URL}/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ITIP_API_KEY}`,
      },
      body: JSON.stringify({
        amount: invoice.total,
        currency: invoice.currency,
        reference: invoice.invoiceNumber,
        description: `Payment for ${invoice.tenant.name}`,
        metadata: {
          tenantId,
          invoiceId,
          locationName: invoice.location?.name,
        },
        webhookUrl: `${appUrl}/api/webhooks/payments`,
        expiresIn: PAYMENT_SESSION_EXPIRY_MINUTES * 60, // seconds
      }),
    });

    const itipData = await itipResponse.json();
    const paymentUrl = itipData.paymentUrl;
    */

    // Update invoice with payment session info
    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "PENDING_PAYMENT",
        paymentUrl,
        paymentQrData: paymentUrl, // QR encodes the payment URL
        paymentExpiresAt: expiresAt,
      },
    });

    // Create pending payment record
    await prisma.payment.create({
      data: {
        invoiceId,
        provider: "itip", // or 'tap' for internal
        amount: invoice.total,
        currency: invoice.currency,
        status: "PENDING",
      },
    });

    console.log(`[TAP API] Created payment session for invoice: ${invoice.invoiceNumber}`);

    return NextResponse.json({
      success: true,
      paymentUrl,
      qrPayload: paymentUrl,
      expiresAt,
      invoice: {
        id: updated.id,
        invoiceNumber: updated.invoiceNumber,
        total: updated.total,
        currency: updated.currency,
        status: updated.status,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Create payment session error:", error);
    return NextResponse.json(
      { error: "Failed to create payment session" },
      { status: 500 }
    );
  }
}
