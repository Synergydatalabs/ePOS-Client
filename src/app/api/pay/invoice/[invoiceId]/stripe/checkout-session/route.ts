// POST /api/pay/invoice/[invoiceId]/stripe/checkout-session
//
// Public endpoint — the invoice UUID is the capability.
//
// Called from the pay page's "Pay now" button when the supplier has an
// active Stripe processor configured. Returns { url } — pay page redirects
// the browser to Stripe Checkout. When the customer completes payment,
// Stripe fires checkout.session.completed → our webhook flips the invoice
// to PAID (see /api/webhooks/payment/stripe/supplier-invoice/route.ts).
//
// Guards:
//   • 404 if invoice unknown
//   • 410 if cancelled
//   • 409 if already paid (customer probably clicked twice, or a race)
//   • 502 if the supplier has no active Stripe row (pay page shouldn't
//     have offered the button in that state — caller bug worth logging)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createInvoiceCheckoutSession } from "@/lib/supplier-stripe";
import { StripeApiError, StripeConfigError } from "@/lib/stripe/types";
import { resolvePublicOrigin } from "@/lib/public-origin";
// Phase H #3 (2026-09-02): reCAPTCHA v3 protects Stripe-session creation
// against bot spam. Same helper as the mock-pay route; fails open in dev.
import { verifyRecaptcha } from "@/lib/recaptcha";
// Phase H #4 (2026-09-02): same VPN block as mock-pay so obfuscated IPs
// cannot even start a Stripe checkout session. Configure IPQS_KEY to arm.
import { lookupIp } from "@/lib/ip-intelligence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    // reCAPTCHA — SOFT-FAIL (matches codebase pattern). VPN block +
    // Stripe Radar are the real fraud filters. Set RECAPTCHA_ENFORCE_PAYMENT=1
    // in the env to promote this to a hard gate.
    const captcha = await verifyRecaptcha({
      token: String(body?.recaptchaToken || ""),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      expectedAction: "invoice_pay",
      minScore: 0.3,
    });
    if (!captcha.ok) {
      // Phase I #4 (2026-09-11): HARD-FAIL — no bypass.
      console.warn(
        `[pay-invoice-session ${invoiceId}] reCAPTCHA rejected:`,
        { reason: captcha.reason, errorCodes: captcha.errorCodes, score: captcha.score }
      );
      return NextResponse.json(
        { error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    // Phase H #4: block VPN / proxy / Tor / datacenter IPs on the pay flow.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")?.trim()
      || "";
    const ipIntel = await lookupIp(ip);
    console.info(
      `[pay-invoice ${invoiceId} stripe] ip=${ip} intel=${JSON.stringify({
        blocked: ipIntel.isBlocked, reason: ipIntel.reason, country: ipIntel.country,
      })}`
    );
    if (ipIntel.isBlocked) {
      // SOFT-FAIL — IPQS false-positives too often to hard-block.
      // Set IP_INTEL_ENFORCE_PAYMENT=1 to promote to a hard gate.
      console.warn(
        `[pay-invoice-session ${invoiceId}] IP soft-flagged:`,
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
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        totalCents: true,
        currency: true,
        customerEmail: true,
        status: true,
        paymentStatus: true,
        supplierTenantId: true,
        supplier: {
          select: {
            supplierProfile: { select: { displayName: true, legalName: true } },
            settings: { select: { brandName: true } },
            name: true,
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

    // Phase F #6i (2026-08-28): shared canonical-origin resolver so the
    // success/cancel URLs Stripe redirects back to are hub.synergydatalabs.com
    // and never 0.0.0.0:PORT or itap.zashx.com. Same helper the invoice
    // creation route uses — one place to change the ingress config.
    const origin = resolvePublicOrigin(request);
    const supplierDisplayName =
      invoice.supplier?.supplierProfile?.displayName ||
      invoice.supplier?.settings?.brandName ||
      invoice.supplier?.name ||
      "Supplier";

    const result = await createInvoiceCheckoutSession({
      supplierTenantId: invoice.supplierTenantId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      totalCents: invoice.totalCents,
      currency: invoice.currency,
      customerEmail: invoice.customerEmail,
      origin,
      supplierDisplayName,
    });
    if (!result) {
      // Supplier isn't set up for Stripe. The pay page shouldn't have
      // offered the button — but if it did (stale UI state), return 502
      // so the client can retry with the mock-pay path or show a friendly
      // "processor not configured" message.
      return NextResponse.json(
        { error: "This supplier has no active Stripe processor" },
        { status: 502 }
      );
    }

    // Stash the session id on the invoice so a supplier looking at the
    // row later can trace it back into their Stripe dashboard.
    await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: { paymentLinkRef: result.sessionId },
    });

    return NextResponse.json({ success: true, url: result.url });
  } catch (err: any) {
    console.error("[PAY-INVOICE-STRIPE] checkout error:", err);
    // Stripe SDK errors have a friendlier message we can surface as-is
    // (they're not privileged data).
    if (err instanceof StripeApiError || err instanceof StripeConfigError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Failed to create Stripe checkout session" },
      { status: 500 }
    );
  }
}
