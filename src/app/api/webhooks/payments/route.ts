// POST /api/webhooks/payments - Handle payment webhooks from iTip/payment provider

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";

// Verify webhook signature (implement based on your provider)
function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-webhook-signature") || "";

    // Log webhook receipt
    let webhookLog;
    try {
      webhookLog = await prisma.webhookLog.create({
        data: {
          provider: "itip",
          eventType: "unknown",
          payload: JSON.parse(rawBody),
          status: "received",
        },
      });
    } catch (e) {
      console.error("[TAP Webhook] Failed to log webhook:", e);
    }

    // Verify signature in production
    if (process.env.NODE_ENV === "production") {
      const secret = process.env.ITIP_WEBHOOK_SECRET;
      if (!secret) {
        console.error("[TAP Webhook] Missing webhook secret");
        return NextResponse.json({ error: "Server error" }, { status: 500 });
      }

      if (!verifySignature(rawBody, signature, secret)) {
        console.error("[TAP Webhook] Invalid signature");
        if (webhookLog) {
          await prisma.webhookLog.update({
            where: { id: webhookLog.id },
            data: { status: "failed", error: "Invalid signature" },
          });
        }
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    const { event, data } = payload;

    // Update webhook log with event type
    if (webhookLog) {
      await prisma.webhookLog.update({
        where: { id: webhookLog.id },
        data: { eventType: event },
      });
    }

    console.log(`[TAP Webhook] Received event: ${event}`);

    switch (event) {
      case "payment.completed":
      case "payment.success": {
        const { invoiceId, paymentId, providerRef, method } = data;

        if (!invoiceId) {
          console.error("[TAP Webhook] Missing invoiceId in payment event");
          break;
        }

        // Find invoice
        const invoice = await prisma.invoice.findUnique({
          where: { id: invoiceId },
          include: { payments: { where: { status: "PENDING" } } },
        });

        if (!invoice) {
          console.error(`[TAP Webhook] Invoice not found: ${invoiceId}`);
          break;
        }

        // Idempotency: check if already paid
        if (invoice.status === "PAID") {
          console.log(`[TAP Webhook] Invoice already paid: ${invoice.invoiceNumber}`);
          break;
        }

        // Update payment record
        const pendingPayment = invoice.payments[0];
        if (pendingPayment) {
          await prisma.payment.update({
            where: { id: pendingPayment.id },
            data: {
              status: "COMPLETED",
              providerRef: providerRef || null,
              method: method || null,
              completedAt: new Date(),
            },
          });
        } else {
          // Create payment record if doesn't exist
          await prisma.payment.create({
            data: {
              invoiceId,
              provider: "itip",
              providerRef: providerRef || null,
              amount: invoice.total,
              currency: invoice.currency,
              status: "COMPLETED",
              method: method || null,
              completedAt: new Date(),
            },
          });
        }

        // Update invoice status
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            status: "PAID",
            paidAt: new Date(),
          },
        });

        console.log(`[TAP Webhook] Invoice paid: ${invoice.invoiceNumber}`);

        // TODO: Send receipt email if customer email is set
        if (invoice.customerEmail) {
          // await sendReceiptEmail(invoice);
        }

        break;
      }

      case "payment.failed": {
        const { invoiceId, reason } = data;

        if (!invoiceId) break;

        // Update payment record
        const invoice = await prisma.invoice.findUnique({
          where: { id: invoiceId },
          include: { payments: { where: { status: "PENDING" } } },
        });

        if (invoice?.payments[0]) {
          await prisma.payment.update({
            where: { id: invoice.payments[0].id },
            data: {
              status: "FAILED",
              failureReason: reason || "Payment failed",
            },
          });
        }

        // Reset invoice to OPEN so user can try again
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            status: "OPEN",
            paymentUrl: null,
            paymentQrData: null,
            paymentExpiresAt: null,
          },
        });

        console.log(`[TAP Webhook] Payment failed for invoice: ${invoiceId}`);
        break;
      }

      case "refund.completed":
      case "refund.success": {
        const { paymentId, refundId, providerRef, amount } = data;

        if (!paymentId) break;

        // Find payment and update refund status
        const payment = await prisma.payment.findUnique({
          where: { id: paymentId },
          include: {
            refunds: { where: { status: "PENDING" } },
            invoice: true,
          },
        });

        if (!payment) break;

        // Update refund record
        const pendingRefund = payment.refunds[0];
        if (pendingRefund) {
          await prisma.refund.update({
            where: { id: pendingRefund.id },
            data: {
              status: "COMPLETED",
              providerRef: providerRef || null,
              completedAt: new Date(),
            },
          });
        }

        // Check if fully refunded
        const totalRefunded = await prisma.refund.aggregate({
          where: {
            paymentId,
            status: "COMPLETED",
          },
          _sum: { amount: true },
        });

        const refundedAmount = totalRefunded._sum.amount || 0;

        if (refundedAmount >= payment.amount) {
          // Fully refunded
          await prisma.payment.update({
            where: { id: paymentId },
            data: { status: "REFUNDED" },
          });

          await prisma.invoice.update({
            where: { id: payment.invoiceId },
            data: {
              status: "REFUNDED",
              refundedAt: new Date(),
            },
          });
        } else {
          // Partially refunded
          await prisma.payment.update({
            where: { id: paymentId },
            data: { status: "PARTIALLY_REFUNDED" },
          });

          await prisma.invoice.update({
            where: { id: payment.invoiceId },
            data: { status: "PARTIALLY_REFUNDED" },
          });
        }

        console.log(`[TAP Webhook] Refund completed for payment: ${paymentId}`);
        break;
      }

      default:
        console.log(`[TAP Webhook] Unhandled event: ${event}`);
    }

    // Mark webhook as processed
    if (webhookLog) {
      await prisma.webhookLog.update({
        where: { id: webhookLog.id },
        data: { status: "processed", processedAt: new Date() },
      });
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("[TAP Webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
