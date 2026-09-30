// POST /api/pay/invoice/[invoiceId]/accept-terms — public.
//
// Called from the customer pay page before /mock-pay (Phase 2) or before
// the real Stripe Checkout redirect (Phase 4). Records the acceptance
// with a full snapshot of the T&C body, hash, typed name, IP, UA, and
// best-effort geo. The acceptance row is the chargeback-defense record
// — a supplier can later download / show it as proof the customer agreed.
//
// Auth: none. The invoice UUID in the URL is the capability. Rate-limiting
// / abuse protection is deferred (same posture as the pay page + mock-pay
// endpoints — expected to be behind CloudFront rate limits in prod).
//
// Body:
//   { termsVersionId: string, acceptedName: string, acceptedEmail?: string }
// The email defaults to the invoice's customer_email if omitted.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  extractClientIp,
  lookupGeoForIp,
  recordTermsAcceptance,
} from "@/lib/supplier-terms";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const termsVersionId = String(body?.termsVersionId || "").trim();
    const acceptedName = String(body?.acceptedName || "").trim();
    if (!termsVersionId) {
      return NextResponse.json({ error: "termsVersionId is required" }, { status: 400 });
    }
    if (!acceptedName) {
      return NextResponse.json(
        { error: "Please type your full name to accept" },
        { status: 400 }
      );
    }

    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        supplierTenantId: true,
        customerEmail: true,
        status: true,
        paymentStatus: true,
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status === "CANCELLED") {
      return NextResponse.json({ error: "This invoice was cancelled" }, { status: 410 });
    }
    if (invoice.paymentStatus === "PAID") {
      return NextResponse.json(
        { error: "Invoice already paid — no acceptance needed" },
        { status: 409 }
      );
    }

    const acceptedEmail =
      typeof body?.acceptedEmail === "string" && body.acceptedEmail.trim()
        ? body.acceptedEmail.trim()
        : invoice.customerEmail;

    // Context capture — IP + UA are cheap synchronous reads; geo hits an
    // external service so we cap it at ~2.5s in the helper. If it fails
    // the acceptance still writes with just the IP.
    const ipAddress = extractClientIp(request);
    const userAgent = request.headers.get("user-agent") || null;
    const geo = await lookupGeoForIp(ipAddress);

    const acceptance = await recordTermsAcceptance({
      supplierTenantId: invoice.supplierTenantId,
      termsVersionId,
      invoiceId: invoice.id,
      acceptedName,
      acceptedEmail,
      ipAddress,
      userAgent,
      geoCountry: geo.country,
      geoRegion: geo.region,
      geoCity: geo.city,
    });

    // Also stamp the invoice with the version label — nice for supplier's
    // AR view and cheap ("what T&C version was in force when this invoice
    // was paid?" without joining the acceptances table).
    await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: { termsVersion: acceptance.termsVersion },
    });

    return NextResponse.json({
      success: true,
      acceptanceId: acceptance.id,
      // Echo the fields the pay page might want to display in the "recorded"
      // confirmation microcopy.
      recordedAt: acceptance.acceptedAt,
      ipAddress: acceptance.ipAddress,
    });
  } catch (err: any) {
    console.error("[PAY-INVOICE-ACCEPT] error:", err);
    const message = typeof err?.message === "string" ? err.message : "Failed to record acceptance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
