// POST /api/pay/invoice/[invoiceId]/cancel-intent
//
// Called from the pay page via navigator.sendBeacon when the customer
// closes the tab or navigates away mid-checkout. Cancels the invoice's
// Stripe PaymentIntent with reason "abandoned" so it stops showing as
// "Incomplete" in the merchant's Stripe dashboard.
//
// Public — no auth. Best-effort: silently no-ops if the invoice is
// already PAID or there's no PI on file. The underlying Stripe call
// also swallows "already canceled" / "already succeeded" errors.
//
// sendBeacon can't read responses, so we return a minimal payload the
// browser never inspects.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cancelInvoicePaymentIntent } from "@/lib/supplier-stripe";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;

    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        supplierTenantId: true,
        paymentStatus: true,
        paymentLinkRef: true,
      },
    });

    // No invoice, already paid, or no PI reference — nothing to cancel.
    if (!invoice || invoice.paymentStatus === "PAID" || !invoice.paymentLinkRef) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Only attempt cancel on refs that look like Stripe PaymentIntents
    // (pi_...). Checkout sessions (cs_...) and other processors aren't
    // our concern here.
    if (!invoice.paymentLinkRef.startsWith("pi_")) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const result = await cancelInvoicePaymentIntent({
      supplierTenantId: invoice.supplierTenantId,
      paymentIntentId: invoice.paymentLinkRef,
    });

    return NextResponse.json({ ok: true, canceled: result.canceled });
  } catch (err: any) {
    console.error("[CANCEL-INTENT] error:", err?.message || err);
    // Beacon ignores status anyway; return 200 so no retries.
    return NextResponse.json({ ok: true, error: "swallowed" });
  }
}
