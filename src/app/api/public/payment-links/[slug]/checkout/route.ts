// POST /api/public/payment-links/[slug]/checkout
//
// Called by the /l/[slug] page when the customer clicks "Continue to
// payment". Creates a SupplierInvoice from the payment-link template
// and returns the URL to the existing /pay/invoice/[id] page. Client
// then does window.location = url.
//
// Phase I #1 (2026-09-08). No auth required (link's slug IS the
// capability). Rate-limiting + optional reCAPTCHA + optional VPN check
// share the same infra as the existing /api/pay/invoice/[id]/*
// endpoints.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createInvoiceFromLink, resolveLinkBySlug } from "@/lib/payment-link.service";
import { verifyRecaptcha } from "@/lib/recaptcha";
import { lookupIp } from "@/lib/ip-intelligence";
// Phase I #2c (2026-09-08): record T&C acceptance server-side against the
// generated invoice so we have full chargeback-defense parity with the
// invoice pay page.
import {
  extractClientIp,
  lookupGeoForIp,
  recordTermsAcceptance,
} from "@/lib/supplier-terms";
// Phase I #2d (2026-09-08): mint the Stripe PaymentIntent inline so the
// caller only needs ONE reCAPTCHA token (Google's v3 tokens are
// single-use; two rapid calls always fails the second verify).
import { createInvoicePaymentIntent } from "@/lib/supplier-stripe";

// Fallback T&C body seeded against a supplier the FIRST time a customer
// pays via a payment link, when the supplier hasn't published their own
// T&C yet. Kept minimal + platform-focused — the supplier can (and
// should) publish their own via /supplier/terms; the next payment then
// records against that instead. Existing acceptance rows against this
// version stay as historical proof.
const PLATFORM_DEFAULT_TERMS_BODY = `# MEGO Platform Terms of Service

By clicking "Pay" you acknowledge that:

1. You are authorising a payment to the merchant shown above.
2. You have read and agreed to MEGO's Terms of Service and Privacy Policy at https://synergydatalabs.com/legal.
3. Payments are processed securely by Stripe. Card details are never sent to MEGO or the merchant.
4. Digital deliverables begin dispatch immediately after payment. You waive the 14-day right of withdrawal for these items.
5. Refunds are handled by the merchant per their published policy. Contact the merchant first before disputing with your bank.
`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const body = await request.json().catch(() => ({}));

    // ---- Bot / captcha check — SOFT-FAIL (matches every other endpoint
    // in this codebase: partner login, salon booking, contact form all
    // log a warning and continue). Blocking on a mis-registered key or
    // a low v3 score locks legitimate customers out; the VPN block
    // below is the actual fraud filter, and Stripe itself runs Radar
    // on the payment. Set RECAPTCHA_ENFORCE_PAYMENT=1 in the env once
    // scoring is stable and the site key is confirmed registered for
    // this exact domain.
    const captcha = await verifyRecaptcha({
      token: String(body?.recaptchaToken || ""),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      expectedAction: "payment_link_checkout",
      minScore: 0.3,
    });
    if (!captcha.ok) {
      console.warn(
        `[PAYMENT-LINK-CHECKOUT] ${slug} reCAPTCHA soft-failed:`,
        {
          reason: captcha.reason,
          errorCodes: captcha.errorCodes,
          score: captcha.score,
          action: captcha.action,
          tokenPresent: !!body?.recaptchaToken,
          tokenLen: String(body?.recaptchaToken || "").length,
        }
      );
      // Phase I #4 (2026-09-11): HARD-FAIL — no bypass.
      return NextResponse.json(
        {
          error: "Verification failed. Please refresh the page and try again.",
          reason: captcha.reason,
        },
        { status: 403 }
      );
    }

    // ---- VPN / proxy / datacenter — SOFT-FAIL (matches reCAPTCHA and
    // every other guard in this codebase). IPQS produces false positives
    // on residential IPs behind carrier-grade NAT, mobile carriers, and
    // corporate networks; hard-blocking here was locking legitimate
    // customers out. Stripe Radar is the real fraud filter on the card
    // side. Set IP_INTEL_ENFORCE_PAYMENT=1 in the env to promote to a
    // hard gate once you've whitelisted the false-positive ranges.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      "";
    const ipIntel = await lookupIp(ip);
    if (ipIntel.isBlocked) {
      console.warn(
        `[PAYMENT-LINK-CHECKOUT] ${slug} IP soft-flagged:`,
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

    // ---- Validate the link once so we can produce useful errors ------------
    const link = await resolveLinkBySlug(slug);
    if (!link) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    }

    // ---- Body validation ---------------------------------------------------
    const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }
    if (link.requireName && !(typeof body.name === "string" && body.name.trim())) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (link.requirePhone && !(typeof body.phone === "string" && body.phone.trim())) {
      return NextResponse.json({ error: "Phone is required" }, { status: 400 });
    }
    if (link.requireCompany && !(typeof body.company === "string" && body.company.trim())) {
      return NextResponse.json({ error: "Company is required" }, { status: 400 });
    }

    // Terms acceptance MUST be present + confirmed. We store the version
    // string on the invoice for the existing chargeback-defence path to
    // record against; the full acceptance receipt happens on the /pay/
    // invoice pay page (existing infra).
    if (body.acceptedTerms !== true) {
      return NextResponse.json(
        { error: "You must accept the Terms of Service and Privacy Policy to continue" },
        { status: 400 }
      );
    }

    // Quantity — the URL param that the /l/[slug] page rendered under
    // is now sent back to us on submit. Service layer clamps it.
    const rawQty = typeof body.quantity === "number" ? Math.floor(body.quantity) : link.qtyDefault;

    // Phase I #12 (2026-09-22): customer-supplied amount override on
    // "editable amount" links. Service layer validates bounds + rejects
    // the override when the link is amountLocked.
    const overrideAmountCents =
      typeof body.unitAmountOverrideCents === "number"
        ? Math.floor(body.unitAmountOverrideCents)
        : null;

    // Phase I #13 (2026-09-23): payment-method surcharge (+2% UPI).
    // The /l/[slug] page previews this client-side and sends the picked
    // method type back on submit; the server applies the same rule so
    // the invoice + Stripe PI amount match.
    const paymentMethodType =
      typeof body.paymentMethodType === "string"
        ? body.paymentMethodType.toLowerCase()
        : "";
    const surchargeBps = paymentMethodType === "upi" ? 200 : 0;
    const surchargeLabel =
      paymentMethodType === "upi" ? "Platform fee (2% UPI)" : null;

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
        typeof body.acceptedTermsVersion === "string" ? body.acceptedTermsVersion : "checkout-v1",
      attributionOverride:
        typeof body.attributionOverride === "string" ? body.attributionOverride : null,
    });

    // Phase I #2c (2026-09-08, revised): ALWAYS record acceptance so it
    // shows up on the supplier's /legal-records page — the customer
    // ticked a box, they signed something, we owe the supplier an
    // audit row for it.
    //
    // Two soft fallbacks make this reliable across supplier setups:
    //   1. termsVersionId missing → look up the supplier's active T&C.
    //      If they haven't published one, auto-seed a "MEGO Platform"
    //      default so downstream FK to supplier_terms_versions is
    //      satisfied. Real supplier T&C, when published later, becomes
    //      the active one; the platform default stays as history.
    //   2. acceptedName missing → use the customer's form name, or
    //      fall back to their email as the signature (better than
    //      dropping the record entirely).
    let effectiveTermsVersionId =
      typeof body.termsVersionId === "string" && body.termsVersionId.trim()
        ? body.termsVersionId.trim()
        : null;
    const providedAcceptedName =
      typeof body.acceptedName === "string" && body.acceptedName.trim()
        ? body.acceptedName.trim()
        : null;
    const bodyCustomerName =
      typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
    const effectiveAcceptedName =
      providedAcceptedName || bodyCustomerName || emailRaw;

    try {
      // Resolve or seed the T&C version this acceptance is tied to.
      if (!effectiveTermsVersionId) {
        const active = await prisma.supplierTermsVersion.findFirst({
          where: { supplierTenantId: link.supplierTenantId, effectiveTo: null },
          select: { id: true },
        });
        if (active) {
          effectiveTermsVersionId = active.id;
        } else {
          const seeded = await prisma.supplierTermsVersion.create({
            data: {
              supplierTenantId: link.supplierTenantId,
              version: "MEGO-platform-v1",
              bodyMarkdown: PLATFORM_DEFAULT_TERMS_BODY,
              effectiveFrom: new Date(),
            },
            select: { id: true },
          });
          effectiveTermsVersionId = seeded.id;
        }
      }

      const ipAddress = extractClientIp(request);
      const userAgent = request.headers.get("user-agent") || null;
      const geo = await lookupGeoForIp(ipAddress);
      const acceptance = await recordTermsAcceptance({
        supplierTenantId: link.supplierTenantId,
        termsVersionId: effectiveTermsVersionId,
        invoiceId: invoice.id,
        acceptedName: effectiveAcceptedName,
        acceptedEmail: emailRaw,
        ipAddress,
        userAgent,
        geoCountry: geo.country,
        geoRegion: geo.region,
        geoCity: geo.city,
      });
      // Stamp the invoice with the version — nicety for the AR view.
      await prisma.supplierInvoice.update({
        where: { id: invoice.id },
        data: { termsVersion: acceptance.termsVersion },
      });
    } catch (err) {
      // Never fail the checkout on an acceptance write — the invoice
      // exists, the customer is committed. Log loudly for ops.
      console.error(`[PAYMENT-LINK-CHECKOUT] ${slug} terms acceptance failed:`, err);
    }

    // Phase I #2d: try to mint the Stripe PaymentIntent right here so the
    // client can render Elements inline without a second round trip (and
    // without needing a second reCAPTCHA token). If the supplier has no
    // active Stripe processor, fall back to the redirect URL — the pay
    // page there will render whatever alternate flow (mock-pay, Moneris)
    // the supplier IS configured for.
    let clientSecret: string | undefined;
    let publishableKey: string | undefined;
    // Phase I #13: hoisted so the response body can echo the surcharged
    // total the customer actually paid.
    let chargedTotalCentsOut = invoice.totalCents;
    let surchargeCentsOut = 0;
    try {
      const supplier = await prisma.tenant.findUnique({
        where: { id: link.supplierTenantId },
        select: {
          name: true,
          supplierProfile: { select: { displayName: true, legalName: true } },
          settings: { select: { brandName: true } },
        },
      });
      const supplierDisplayName =
        supplier?.supplierProfile?.displayName ||
        supplier?.settings?.brandName ||
        supplier?.name ||
        "Supplier";
      // Phase I #13 (2026-09-23): fold the surcharge into the invoice
      // total + the PI amount together, so what Stripe captures matches
      // the reconciled receipt. Persist the surcharge slot too.
      surchargeCentsOut = surchargeBps
        ? Math.round((invoice.totalCents * surchargeBps) / 10_000)
        : 0;
      chargedTotalCentsOut = invoice.totalCents + surchargeCentsOut;
      if (surchargeCentsOut > 0) {
        await prisma.supplierInvoice.update({
          where: { id: invoice.id },
          data: {
            surchargeCents: surchargeCentsOut,
            surchargeLabel,
            totalCents: chargedTotalCentsOut,
          },
        });
      }

      const pi = await createInvoicePaymentIntent({
        supplierTenantId: link.supplierTenantId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalCents: chargedTotalCentsOut,
        currency: invoice.currency,
        customerEmail: emailRaw,
        supplierDisplayName,
      });
      if (pi) {
        clientSecret = pi.clientSecret;
        publishableKey = pi.publishableKey;
        // Same stash the standalone payment-intent route does — the
        // refund/reconciliation flow looks up the invoice from this ref.
        await prisma.supplierInvoice.update({
          where: { id: invoice.id },
          data: { paymentLinkRef: pi.id },
        });
      }
    } catch (err) {
      // Non-fatal — invoice IS created, client can fall back to the redirect.
      console.warn(`[PAYMENT-LINK-CHECKOUT] ${slug} PI mint failed:`, err);
    }

    // Redirect target — existing pay page picks up from here with all
    // its processor, terms-acceptance, and receipt infrastructure.
    const publicBase =
      process.env.NEXT_PUBLIC_APP_URL || "https://hub.synergydatalabs.com";
    const payUrl = `${publicBase.replace(/\/+$/, "")}/pay/invoice/${invoice.id}`;

    return NextResponse.json({
      success: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      totalCents: chargedTotalCentsOut,
      surchargeCents: surchargeCentsOut,
      surchargeLabel,
      currency: invoice.currency,
      redirectUrl: payUrl,
      // When populated, the client can render Stripe Elements on the same
      // page. When absent (supplier has no Stripe), client should navigate
      // to redirectUrl instead.
      clientSecret,
      publishableKey,
    });
  } catch (err: any) {
    console.error(`[PAYMENT-LINK-CHECKOUT] ${slug} error:`, err);
    return NextResponse.json(
      { error: err?.message || "Failed to start checkout" },
      { status: 500 }
    );
  }
}
