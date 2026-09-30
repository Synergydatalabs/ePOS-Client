// POST /api/pay/invoice/[invoiceId]/mock-pay — Phase 2 mock payment.
//
// Until Stripe wiring lands in Phase 4, the "Pay now" button on the branded
// customer pay page hits this endpoint to flip an invoice's paymentStatus to
// PAID + set paidAt. That's enough to walk end-to-end without a real card
// network — supplier sees the paid state in their portal, customer sees the
// receipt, everyone can validate the flow.
//
// When Phase 4 wires up Stripe, this endpoint stays but becomes for
// dev/staging environments only (guarded by NODE_ENV or a feature flag).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { onSubscriptionInvoicePaid } from "@/lib/supplier-subscriptions";
import { notifyInvoicePaid } from "@/lib/telegram-notify";
// Phase H #3 (2026-09-02): reCAPTCHA v3 gate. verifyRecaptcha() fails
// open when RECAPTCHA_SECRET_KEY is not set — dev environments keep
// working without any extra config. Production sets the secret + this
// endpoint refuses low-score / missing tokens.
import { verifyRecaptcha } from "@/lib/recaptcha";
// Phase H #4 (2026-09-02): VPN / proxy / Tor / datacenter block on the
// invoice pay flow. lookupIp() fails open when IPQS_KEY isn't set OR the
// IPQS call errors — a real customer must never be blocked because our
// fraud API is down. Configure IPQS_KEY on EC2 to arm the block.
import { lookupIp } from "@/lib/ip-intelligence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  try {
    // Read + verify the reCAPTCHA v3 token. Body is optional-shaped to
    // avoid breaking older clients that submit without the field.
    const body = await request.json().catch(() => ({}));
    // reCAPTCHA — SOFT-FAIL (matches codebase pattern: login, booking,
    // contact all log a warning and continue). VPN block + Stripe Radar
    // are the real fraud filters. Set RECAPTCHA_ENFORCE_PAYMENT=1 in
    // the env to make this a hard gate.
    const captcha = await verifyRecaptcha({
      token: String(body?.recaptchaToken || ""),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      expectedAction: "invoice_pay",
      minScore: 0.3,
    });
    if (!captcha.ok) {
      // Phase I #4 (2026-09-11): HARD-FAIL — no bypass.
      console.warn(
        `[pay-invoice-mock ${invoiceId}] reCAPTCHA rejected:`,
        { reason: captcha.reason, errorCodes: captcha.errorCodes, score: captcha.score }
      );
      return NextResponse.json(
        { error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    // Phase H #4: block VPN / proxy / Tor / datacenter IPs. Fails open
    // when IPQS_KEY isn't set — no dev-machine block, no lost customer
    // if IPQS is degraded. Logged either way for ops visibility.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")?.trim()
      || "";
    const ipIntel = await lookupIp(ip);
    console.info(
      `[pay-invoice ${invoiceId}] ip=${ip} intel=${JSON.stringify({
        blocked: ipIntel.isBlocked, reason: ipIntel.reason, country: ipIntel.country,
      })}`
    );
    if (ipIntel.isBlocked) {
      // SOFT-FAIL — IPQS false-positives too often on residential /
      // mobile IPs to hard-block. Set IP_INTEL_ENFORCE_PAYMENT=1 to
      // promote to a hard gate.
      console.warn(
        `[pay-invoice-mock ${invoiceId}] IP soft-flagged:`,
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
      select: { id: true, status: true, paymentStatus: true, totalCents: true, currency: true, invoiceNumber: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status === "CANCELLED") {
      return NextResponse.json({ error: "This invoice was cancelled" }, { status: 410 });
    }
    if (invoice.paymentStatus === "PAID") {
      return NextResponse.json({ success: true, alreadyPaid: true });
    }
    const paidAt = new Date();
    await prisma.supplierInvoice.update({
      where: { id: invoiceId },
      data: {
        paymentStatus: "PAID",
        paidAt,
        paidMethod: "MOCK",
        amountPaidCents: invoice.totalCents,
        status: "PAID",
      },
    });
    // Phase G #1: subscription activation. No-op for one-off invoices.
    await onSubscriptionInvoicePaid(invoiceId, paidAt);
    // Ops Telegram ping — fire-and-forget.
    void notifyInvoicePaid({
      invoiceNumber: invoice.invoiceNumber,
      amountCents: invoice.totalCents,
      currency: invoice.currency,
      processor: "Mock",
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[PAY-INVOICE] mock-pay error:", err);
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
  }
}
