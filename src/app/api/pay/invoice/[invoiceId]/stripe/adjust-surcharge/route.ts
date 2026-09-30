// POST /api/pay/invoice/[invoiceId]/stripe/adjust-surcharge
//
// Phase I #13 (2026-09-23) — payment-method surcharge (e.g. UPI +2%).
//
// Called by the pay page when the customer switches payment methods in
// the Stripe PaymentElement. Body: { paymentMethodType: "upi" | "card" | ... }.
//
// UPI-selected → surcharge = 2% of (subtotal + tax), rounded to the
// nearest smallest currency unit. Any other method → surcharge = 0.
//
// Server-side we:
//   1. Recompute the invoice total = subtotal + tax + surcharge
//   2. Update the Stripe PaymentIntent amount to match
//   3. Persist surcharge_cents / surcharge_label / total_cents on the invoice
//
// The pay page uses the response to refresh the amount label + show the
// "Platform fee" line item.
//
// Idempotent — safe to call repeatedly (customer flipping between tabs).
// Same guards as /stripe/payment-intent: 404 unknown, 410 cancelled,
// 409 already-paid.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { updateInvoicePaymentIntentAmount } from "@/lib/supplier-stripe";
import { StripeApiError, StripeConfigError } from "@/lib/stripe/types";

// 200 bps = 2%. Tenant-configurable later; hardcoded per MVP scope.
const UPI_SURCHARGE_BPS = 200;

// Payment methods that trigger the surcharge. Kept as a whitelist so we
// don't accidentally surcharge card/apple-pay/google-pay if Stripe ever
// renames its method IDs.
const SURCHARGED_METHODS: Record<string, { bps: number; label: string }> = {
  upi: { bps: UPI_SURCHARGE_BPS, label: "Platform fee (2% UPI)" },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const paymentMethodType = String(body?.paymentMethodType || "").toLowerCase();

    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        supplierTenantId: true,
        subtotalCents: true,
        taxCents: true,
        currency: true,
        paymentLinkRef: true,
        surchargeCents: true,
        surchargeLabel: true,
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status === "CANCELLED") {
      return NextResponse.json({ error: "This invoice was cancelled" }, { status: 410 });
    }
    if (invoice.paymentStatus === "PAID") {
      return NextResponse.json({ error: "Invoice already paid" }, { status: 409 });
    }
    if (!invoice.paymentLinkRef) {
      // No PaymentIntent yet — the pay page hasn't called
      // /stripe/payment-intent. Nothing to adjust; the surcharge will be
      // applied when the customer picks a method on next mount.
      return NextResponse.json(
        { error: "Payment intent not initialised yet" },
        { status: 409 }
      );
    }

    const base = invoice.subtotalCents + invoice.taxCents;
    const rule = SURCHARGED_METHODS[paymentMethodType];
    const newSurchargeCents = rule ? Math.round((base * rule.bps) / 10_000) : 0;
    const newSurchargeLabel = rule ? rule.label : null;
    const newTotalCents = base + newSurchargeCents;

    // Fast path: no change needed. Skips a Stripe API round-trip.
    if (
      newSurchargeCents === invoice.surchargeCents &&
      newSurchargeLabel === invoice.surchargeLabel
    ) {
      return NextResponse.json({
        success: true,
        surchargeCents: newSurchargeCents,
        surchargeLabel: newSurchargeLabel,
        totalCents: newTotalCents,
        currency: invoice.currency,
        unchanged: true,
      });
    }

    const stripeResult = await updateInvoicePaymentIntentAmount({
      supplierTenantId: invoice.supplierTenantId,
      paymentIntentId: invoice.paymentLinkRef,
      newAmountCents: newTotalCents,
      currency: invoice.currency,
    });
    if (!stripeResult) {
      return NextResponse.json(
        { error: "Stripe processor not active for this supplier" },
        { status: 502 }
      );
    }

    await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        surchargeCents: newSurchargeCents,
        surchargeLabel: newSurchargeLabel,
        totalCents: newTotalCents,
      },
    });

    return NextResponse.json({
      success: true,
      surchargeCents: newSurchargeCents,
      surchargeLabel: newSurchargeLabel,
      totalCents: newTotalCents,
      currency: invoice.currency,
    });
  } catch (err: any) {
    console.error("[PAY-INVOICE-ADJUST-SURCHARGE] error:", err);
    if (err instanceof StripeApiError || err instanceof StripeConfigError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Failed to adjust payment amount" },
      { status: 500 }
    );
  }
}
