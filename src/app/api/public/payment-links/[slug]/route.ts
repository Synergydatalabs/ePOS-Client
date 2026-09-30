// GET /api/public/payment-links/[slug] — resolve a public payment link.
// No auth. Returns the info the /l/[slug] checkout page needs to render:
// product name/description/price, supplier branding, quantity config,
// which customer fields to require, availability status.
//
// Phase I #1 (2026-09-08). Response is safe to cache briefly (60s) at
// the edge — the price + supplier branding don't change often — but we
// include usage-count fields so clients that need real-time capacity
// checks can pass `?fresh=1` to bypass any cache.

import { NextRequest, NextResponse } from "next/server";
import { resolveLinkBySlug, checkLinkAvailability, resolveQuantity } from "@/lib/payment-link.service";
// Phase I #2e (2026-09-08): expose the supplier's Stripe publishable key
// so the checkout page can mount Stripe Elements upfront (deferred intent
// mode) — card fields visible from the moment the page loads.
import { loadActiveSupplierStripe } from "@/lib/supplier-stripe";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const link = await resolveLinkBySlug(slug);
    if (!link) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    }

    const availability = checkLinkAvailability(link);

    // Compute what the checkout page should render.
    const url = new URL(request.url);
    const urlQtyRaw = url.searchParams.get("qty");
    const urlQty = urlQtyRaw != null ? Number(urlQtyRaw) : null;
    // The URL param, if present, LOCKS qty per the spec — the checkout
    // shouldn't render a stepper. We signal both the effective qty and
    // whether the client should render it as editable.
    const effectiveQty = resolveQuantity(link, urlQty);
    const qtyEditable =
      urlQty == null && !link.qtyLocked;

    // Unit price falls back to the product's wholesale price if the link
    // itself doesn't override.
    const unitAmountCents =
      link.unitAmountCents ??
      (link.product ? link.product.wholesalePriceCents : null);

    // Display metadata — partner branding overrides supplier branding on
    // the checkout page (so it feels co-branded with the partner site).
    const supplierDisplayName =
      link.supplier?.supplierProfile?.displayName ||
      link.supplier?.settings?.brandName ||
      link.supplier?.name ||
      "Merchant";
    const displayName = link.partnerDisplayName || supplierDisplayName;
    const displayLogoUrl = link.partnerLogoUrl || link.supplier?.settings?.brandLogoUrl || null;

    // Publishable key for Elements — safe to expose (pk_live_... / pk_test_...
    // is designed to be sent to browsers). Null when the supplier has no
    // active Stripe processor; the checkout page falls back to the
    // deferred-redirect flow in that case.
    let stripePublishableKey: string | null = null;
    try {
      const stripeCreds = await loadActiveSupplierStripe(link.supplierTenantId);
      if (stripeCreds?.publishableKey) {
        stripePublishableKey = stripeCreds.publishableKey;
      }
    } catch {
      // Non-fatal — the checkout page will just fall back to the redirect flow.
    }

    return NextResponse.json({
      success: true,
      available: availability.ok,
      unavailableReason: availability.ok ? null : availability.reason,
      link: {
        id: link.id,
        shortSlug: link.shortSlug,
        nickname: link.nickname,
        mode: link.mode,
        interval: link.interval,
        intervalCount: link.intervalCount,
        currency: link.currency,
        redirectUrl: link.redirectUrl,
        requireName: link.requireName,
        requirePhone: link.requirePhone,
        requireCompany: link.requireCompany,
        // For diagnostics only — don't render these directly; use `qty` and `qtyEditable` instead.
        qtyLocked: link.qtyLocked,
        qtyDefault: link.qtyDefault,
        qtyMin: link.qtyMin,
        qtyMax: link.qtyMax,
        // Phase I #12 (2026-09-22): editable amount.
        amountLocked: link.amountLocked,
        amountMinCents: link.amountMinCents,
        amountMaxCents: link.amountMaxCents,
      },
      // Convenience booleans for the pay page.
      amountEditable: !link.amountLocked,
      product: link.product
        ? {
            id: link.product.id,
            name: link.product.name,
            description: link.descriptionOverride || link.product.description || null,
            unitLabel: link.product.unitLabel,
          }
        : {
            id: null,
            name: link.nickname,
            description: link.descriptionOverride,
            unitLabel: "unit",
          },
      unitAmountCents,
      // Resolved qty + total for the initial render. The client may
      // recompute if the customer edits qty via the stepper (only when
      // qtyEditable is true).
      quantity: effectiveQty,
      qtyEditable,
      totalCents: unitAmountCents != null ? unitAmountCents * effectiveQty : null,
      merchant: {
        displayName,
        logoUrl: displayLogoUrl,
        supplierDisplayName,
        // Phase I #14 (2026-09-23): tenants can hide the "MEGO" chrome
        // (header, footer, "sold on hub by MEGO" caption, T&C footer
        // text) by turning off tenant_settings.powered_by_visible.
        poweredByVisible: link.supplier?.settings?.poweredByVisible ?? true,
      },
      // For Elements upfront-mount on the checkout page. Null = supplier
      // has no Stripe → checkout falls back to redirect / mock-pay.
      stripePublishableKey,
    });
  } catch (err: any) {
    console.error("[PAYMENT-LINK-PUBLIC] GET error:", err);
    return NextResponse.json({ error: "Failed to load payment link" }, { status: 500 });
  }
}
