// POST /api/public/payment-links/[slug]/helcim-start
//
// 2026-10-09: Minted when the customer clicks "Pay with Helcim" on
// /l/[slug]. We create a SupplierInvoice from the link template
// (same as /checkout) and then ask Helcim to mint a HelcimPay.js
// checkoutToken. The browser uses that token to open the Helcim
// modal (appendHelcimPayIframe). On completion Helcim POSTs
// /api/webhooks/h-ecom which flips the invoice to PAID.
//
// Public — no auth, slug IS the capability. reCAPTCHA soft-fail
// matches /checkout.
//
// 503 when the tenant has no ACTIVE Helcim provider (shouldn't
// happen if the UI gates correctly, but defence in depth).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  createInvoiceFromLink,
  resolveLinkBySlug,
} from "@/lib/payment-link.service";
import { verifyRecaptcha } from "@/lib/recaptcha";
import {
  extractClientIp,
  lookupGeoForIp,
  recordTermsAcceptance,
} from "@/lib/supplier-terms";
import {
  initializeHelcimCheckout,
  loadHelcimCredentials,
} from "@/lib/helcim/client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const body = await request.json().catch(() => ({}));

    // Soft reCAPTCHA — matches /checkout.
    const captcha = await verifyRecaptcha({
      token: String(body?.recaptchaToken || ""),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      expectedAction: "payment_link_checkout",
      minScore: 0.3,
    });
    if (!captcha.ok) {
      console.warn(`[HELCIM-START] ${slug} reCAPTCHA soft-failed:`, captcha.reason);
    }

    const emailRaw = String(body?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const link = await resolveLinkBySlug(slug);
    if (!link) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    }

    // Confirm the tenant has an active Helcim provider before minting
    // an invoice we'd just have to orphan.
    const creds = await loadHelcimCredentials(link.supplierTenantId);
    if (!creds?.apiToken) {
      return NextResponse.json(
        { error: "Helcim is not configured for this tenant" },
        { status: 503 }
      );
    }

    const rawQty = typeof body.quantity === "number" ? body.quantity : 1;
    const overrideAmountCents =
      typeof body.unitAmountOverrideCents === "number"
        ? Math.floor(body.unitAmountOverrideCents)
        : null;

    const invoice = await createInvoiceFromLink({
      slug,
      quantity: rawQty,
      unitAmountOverrideCents: overrideAmountCents,
      customer: {
        email: emailRaw,
        name: typeof body.name === "string" ? body.name : null,
        phone: typeof body.phone === "string" ? body.phone : null,
        company: typeof body.company === "string" ? body.company : null,
      },
      acceptedTermsVersion:
        typeof body.acceptedTermsVersion === "string"
          ? body.acceptedTermsVersion
          : "checkout-v1",
      attributionOverride:
        typeof body.attributionOverride === "string" ? body.attributionOverride : null,
    });

    // Record T&C acceptance against the invoice for the audit trail.
    // Best-effort — don't block the payment if this fails.
    try {
      const ipAddress = extractClientIp(request);
      const userAgent = request.headers.get("user-agent") || null;
      const geo = await lookupGeoForIp(ipAddress);
      if (typeof body.termsVersionId === "string" && body.termsVersionId.trim()) {
        await recordTermsAcceptance({
          supplierTenantId: link.supplierTenantId,
          termsVersionId: body.termsVersionId.trim(),
          invoiceId: invoice.id,
          acceptedEmail: emailRaw,
          acceptedName:
            (typeof body.acceptedName === "string" && body.acceptedName.trim()) ||
            (typeof body.name === "string" && body.name.trim()) ||
            emailRaw,
          ipAddress,
          userAgent,
          geoCountry: geo?.country ?? null,
          geoRegion: geo?.region ?? null,
        });
      }
    } catch (termsErr) {
      console.warn("[HELCIM-START] T&C recording failed (continuing):", termsErr);
    }

    // Mint a HelcimPay.js checkout session.
    //
    // 2026-10-09 — Helcim's `invoiceNumber` field expects their own
    // format: `INV` + numeric digits (e.g. INV1000, INV1760061234567).
    // Anything else — UUIDs, alphanumeric codes with letters mixed in,
    // short refs — returns 400 "Invalid Invoice Number". So we build
    // one from a timestamp: "INV" + Date.now() → 16 chars, pure digits
    // after the INV prefix, globally unique per call.
    //
    // Stashed on invoice.paymentLinkRef so the webhook can match it
    // back to the right invoice.
    //
    // customerCode omitted — Helcim auto-generates it.
    const helcimRef = "INV" + Date.now().toString();

    await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: { paymentLinkRef: helcimRef },
    });

    const session = await initializeHelcimCheckout({
      apiToken: creds.apiToken,
      amount: invoice.totalCents / 100,
      currency: invoice.currency,
      invoiceNumber: helcimRef,
    });

    return NextResponse.json({
      success: true,
      invoiceId: invoice.id,
      checkoutToken: session.checkoutToken,
      // Convenience fields the browser uses to redirect post-pay.
      successUrl: `/pay/invoice/${invoice.id}?paid=1&via=helcim`,
    });
  } catch (err: any) {
    console.error(`[HELCIM-START] ${slug} error:`, err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Failed to start Helcim checkout" },
      { status: 500 }
    );
  }
}
