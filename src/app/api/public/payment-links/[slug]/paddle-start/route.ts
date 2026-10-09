// POST /api/public/payment-links/[slug]/paddle-start
//
// Minted when the customer picks "Pay with KakaoPay (via Paddle)" on
// the /l/[slug] page. We create a SupplierInvoice from the link
// template (same as the Stripe /checkout path) and then open a
// Paddle transaction. The response hands back the Paddle hosted
// checkout URL that the browser redirects to. On completion Paddle
// webhooks /api/webhooks/paddle, which flips the invoice to PAID.
//
// Public — no auth, slug IS the capability. reCAPTCHA soft-fail
// matches /checkout. Hard-fails with 503 when Paddle isn't
// configured on this environment (PADDLE_API_KEY missing).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createInvoiceFromLink, resolveLinkBySlug } from "@/lib/payment-link.service";
import { verifyRecaptcha } from "@/lib/recaptcha";
import {
  extractClientIp,
  lookupGeoForIp,
  recordTermsAcceptance,
} from "@/lib/supplier-terms";
import { createPaddleTransaction } from "@/lib/paddle/client";
import { getPaddleConfig } from "@/lib/paddle/constants";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const config = getPaddleConfig();
    if (!config.isConfigured) {
      return NextResponse.json(
        { error: "Paddle checkout is not available on this environment" },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));

    // Soft reCAPTCHA — matches /checkout.
    const captcha = await verifyRecaptcha({
      token: String(body?.recaptchaToken || ""),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      expectedAction: "payment_link_checkout",
      minScore: 0.3,
    });
    if (!captcha.ok) {
      console.warn(`[PADDLE-START] ${slug} reCAPTCHA soft-failed:`, captcha.reason);
    }

    const emailRaw = String(body?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const link = await resolveLinkBySlug(slug);
    if (!link) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
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
      // Only record when the browser sent a terms version id.
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
      console.warn("[PADDLE-START] T&C recording failed (continuing):", termsErr);
    }

    // 2026-10-08: force the checkout host onto the tenant's own custom
    // domain when one is set. Paddle enforces a per-vendor approved-
    // domains list — Indian Beans has `indianbeans.com` approved but
    // not `hub.synergydatalabs.com`, so a customer who opened the
    // payment link via the hub host would otherwise get a
    // "domain not approved" error from Paddle. Looking the host up
    // from tenant_settings.customDomain keeps the URL valid regardless
    // of which host the customer loaded the pay page on.
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: link.supplierTenantId },
      select: { customDomain: true },
    });
    const tenantHost = settings?.customDomain?.trim();
    const originHost = tenantHost
      ? `https://${tenantHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
      : new URL(request.url).origin;

    // 2026-10-09: iframe-embed flag. When /l/[slug] was rendered inside
    // a partner iframe (?embed=1), we propagate it through the Paddle
    // round-trip so /pay/invoice/[id] knows to postMessage the parent
    // on paid instead of just rendering a receipt in-place. Appended as
    // &embed=1 on the final success URL built by paddle-checkout.
    const embedMode = body?.embed === true;

    // The checkout host page: /paddle-checkout loads Paddle.js and opens
    // the overlay. The invoice id is carried as a query param so the
    // Paddle.js successUrl can send the customer to the right invoice
    // page after they pay. Paddle appends `?_ptxn=<txn_id>` automatically.
    const checkoutPageUrl = `${originHost}/paddle-checkout?invoiceId=${invoice.id}${embedMode ? "&embed=1" : ""}`;

    const txn = await createPaddleTransaction({
      invoiceId: invoice.id,
      amountCents: invoice.totalCents,
      currency: invoice.currency,
      customerEmail: emailRaw,
      description: `Invoice ${invoice.invoiceNumber}`,
      checkoutPageUrl,
    });

    // Stash the Paddle transaction id on the invoice so the webhook can
    // confirm identity even without custom_data if Paddle ever drops it.
    await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        paymentLinkUrl: txn.checkoutUrl,
        paymentLinkRef: txn.id,
      },
    });

    return NextResponse.json({
      success: true,
      invoiceId: invoice.id,
      paddleCheckoutUrl: txn.checkoutUrl,
      paddleTransactionId: txn.id,
    });
  } catch (err: any) {
    console.error(`[PADDLE-START] ${slug} error:`, err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Failed to start Paddle checkout" },
      { status: 500 }
    );
  }
}
