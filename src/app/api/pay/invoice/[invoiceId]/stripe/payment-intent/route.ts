// POST /api/pay/invoice/[invoiceId]/stripe/payment-intent
//
// Phase I #2a (2026-09-08) — Elements checkout for supplier invoices.
//
// Called by the /pay/invoice/[invoiceId] page when the customer confirms
// T&C and clicks "Pay". Returns { clientSecret, publishableKey } that the
// pay page hands to @stripe/react-stripe-js Elements to render an inline
// card form — customer never leaves hub.synergydatalabs.com.
//
// Mirrors the guards on stripe/checkout-session/route.ts:
//   • 404 if invoice unknown
//   • 410 if cancelled
//   • 409 if already paid
//   • 502 if the supplier has no active Stripe row
//   • reCAPTCHA + VPN block (same helpers as the redirect flow)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createInvoicePaymentIntent } from "@/lib/supplier-stripe";
import { StripeApiError, StripeConfigError } from "@/lib/stripe/types";
import { verifyRecaptcha } from "@/lib/recaptcha";
import { lookupIp } from "@/lib/ip-intelligence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  try {
    const body = await request.json().catch(() => ({}));

    // Phase I #9 (2026-09-19): pre-load the invoice to check whether it
    // was API-generated. API-created invoices come from a partner that
    // was already authenticated by their bearer key — we don't need to
    // reCAPTCHA-verify the customer's browser too (the embed lives in
    // the partner's iframe, cross-origin reCAPTCHA doesn't work anyway).
    const preloaded = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        paymentLinkId: true,
        paymentLink: { select: { apiGenerated: true } },
      },
    });
    const apiGenerated = !!preloaded?.paymentLink?.apiGenerated;

    // ---- reCAPTCHA — HARD-FAIL for public /l/[slug] flow, SKIPPED for
    // API-generated invoices (partner API key is the fraud check).
    if (!apiGenerated) {
      const captcha = await verifyRecaptcha({
        token: String(body?.recaptchaToken || ""),
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
        expectedAction: "invoice_pay",
        minScore: 0.3,
      });
      if (!captcha.ok) {
        // Phase I #4 (2026-09-11): HARD-FAIL — no bypass.
        console.warn(
          `[PAY-INVOICE-STRIPE-INTENT] ${invoiceId} reCAPTCHA rejected:`,
          { reason: captcha.reason, errorCodes: captcha.errorCodes, score: captcha.score }
        );
        return NextResponse.json(
          { error: "Verification failed. Please refresh the page and try again." },
          { status: 403 }
        );
      }
    }

    // ---- VPN / proxy — SOFT-FAIL (matches reCAPTCHA and codebase guards).
    // IPQS false-positives on residential + mobile carrier IPs were
    // locking real customers out. Stripe Radar is the real fraud filter
    // on the card side. Set IP_INTEL_ENFORCE_PAYMENT=1 to hard-gate.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      "";
    const ipIntel = await lookupIp(ip);
    if (ipIntel.isBlocked) {
      console.warn(
        `[PAY-INVOICE-STRIPE-INTENT] ${invoiceId} IP soft-flagged:`,
        { ip, reason: ipIntel.reason, country: ipIntel.country }
      );
      if (process.env.IP_INTEL_ENFORCE_PAYMENT === "1") {
        return NextResponse.json(
          {
            error:
              "Payment cannot proceed while you're connected via a VPN, proxy, or anonymised network. Please disable it and try again.",
            reason: ipIntel.reason,
          },
          { status: 403 }
        );
      }
    }

    // ---- Invoice lookup + guards -------------------------------------------
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        subtotalCents: true,
        taxCents: true,
        totalCents: true,
        surchargeCents: true,
        surchargeLabel: true,
        currency: true,
        customerEmail: true,
        status: true,
        paymentStatus: true,
        supplierTenantId: true,
        // Phase I #9 (2026-09-19): needed to know if this invoice was
        // API-created so we can suppress Stripe's own receipt email.
        paymentLinkId: true,
        supplier: {
          select: {
            name: true,
            supplierProfile: { select: { displayName: true, legalName: true } },
            settings: { select: { brandName: true } },
          },
        },
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

    const supplierDisplayName =
      invoice.supplier?.supplierProfile?.displayName ||
      invoice.supplier?.settings?.brandName ||
      invoice.supplier?.name ||
      "Supplier";

    // Phase I #13 (2026-09-23): payment-method surcharge (+2% UPI).
    // The pay page passes the customer's currently-picked method type so
    // we can recompute the surcharge on every mint. Idempotent: mounting
    // again with a different method re-derives the total from
    // subtotal+tax and applies the new surcharge fresh (no drift).
    //
    // 2026-10-10: enforcement improvement. When the client doesn't send
    // a paymentMethodType (common on API-created invoices where the
    // customer may bypass our normal pay page), default to applying
    // the UPI surcharge for INR invoices. Rationale: in India, UPI is
    // the dominant payment method; if we don't know what they picked,
    // assume UPI and surcharge accordingly. The breakdown line on the
    // pay page shows the fee so customers see it before confirming.
    const paymentMethodType =
      typeof body?.paymentMethodType === "string"
        ? body.paymentMethodType.toLowerCase()
        : "";
    const isINR = invoice.currency.toUpperCase() === "INR";
    const effectivePmType =
      paymentMethodType || (isINR ? "upi" : "");
    const base = invoice.subtotalCents + invoice.taxCents;
    const surchargeCents =
      effectivePmType === "upi" ? Math.round((base * 200) / 10_000) : 0;
    const surchargeLabel =
      effectivePmType === "upi" ? "Platform fee (2% UPI)" : null;
    const chargedTotalCents = base + surchargeCents;
    if (
      surchargeCents !== invoice.surchargeCents ||
      surchargeLabel !== invoice.surchargeLabel ||
      chargedTotalCents !== invoice.totalCents
    ) {
      await prisma.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          surchargeCents,
          surchargeLabel,
          totalCents: chargedTotalCents,
        },
      });
    }

    // apiGenerated was resolved above in the reCAPTCHA gate — reuse it
    // here to also suppress Stripe's own receipt email for API invoices
    // (the partner sends their own transactional email).
    const result = await createInvoicePaymentIntent({
      supplierTenantId: invoice.supplierTenantId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      totalCents: chargedTotalCents,
      currency: invoice.currency,
      customerEmail: invoice.customerEmail,
      supplierDisplayName,
      sendReceipt: !apiGenerated,
    });
    if (!result) {
      return NextResponse.json(
        { error: "This supplier has no active Stripe processor" },
        { status: 502 }
      );
    }

    // Stash the PaymentIntent id on the invoice so future refund /
    // reconciliation code can look up the invoice from the intent id.
    await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: { paymentLinkRef: result.id },
    });

    return NextResponse.json({
      success: true,
      clientSecret: result.clientSecret,
      publishableKey: result.publishableKey,
      paymentIntentId: result.id,
      totalCents: chargedTotalCents,
      surchargeCents,
      surchargeLabel,
      currency: invoice.currency,
    });
  } catch (err: any) {
    console.error("[PAY-INVOICE-STRIPE-INTENT] error:", err);
    if (err instanceof StripeApiError || err instanceof StripeConfigError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Failed to create Stripe payment intent" },
      { status: 500 }
    );
  }
}
