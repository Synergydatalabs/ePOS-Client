// GET /api/pay/invoice/[invoiceId] — public read for the customer pay page.
//
// No auth: the invoice UUID in the URL is the capability. The customer
// received it via email or QR code. Returns supplier branding alongside
// the invoice + items so the pay page can skin itself in the supplier's
// colors + logo without a second round-trip.
//
// The return payload deliberately excludes internal audit fields
// (created_by_membership_id, cancelled_by_membership_id, cancellation_reason).
// Anything a customer sees on the pay page ships from here — everything
// else stays on the supplier-scoped detail endpoint.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPublicInvoice } from "@/lib/supplier-invoices";
// Phase I #2h (2026-09-08): expose the supplier's Stripe publishable
// key so the pay page can mount Stripe Elements at page-load time
// (deferred intent flow — card visible from start, one-click Pay).
import { loadActiveSupplierStripe } from "@/lib/supplier-stripe";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  try {
    const invoice = await getPublicInvoice(invoiceId);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Shape for the pay page — includes supplier brand block, excludes
    // supplier-internal audit trail.
    const supplierProfile = invoice.supplier.supplierProfile;
    const supplierSettings = invoice.supplier.settings;

    // Phase F #4 (2026-08-27): does the supplier have an active Stripe
    // processor? Determines whether the pay page redirects to Stripe or
    // falls back to the mock-pay endpoint. Cheap query — one row lookup.
    const stripeActive = await prisma.tenantPaymentProvider.findFirst({
      where: {
        tenantId: invoice.supplierTenantId,
        processor: "STRIPE",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    const paymentMethod: "STRIPE" | "MOCK" = stripeActive ? "STRIPE" : "MOCK";

    // Phase I #2h: load the supplier's decrypted Stripe credentials so we
    // can expose the publishableKey to the pay page. Safe to expose —
    // pk_live_... / pk_test_... is designed to be handed to browsers.
    // Only surfaced when there IS an active Stripe processor (otherwise
    // the paymentMethod above is "MOCK" and the pay page won't try to
    // mount Elements).
    let stripePublishableKey: string | null = null;
    if (stripeActive) {
      try {
        const creds = await loadActiveSupplierStripe(invoice.supplierTenantId);
        if (creds?.publishableKey) stripePublishableKey = creds.publishableKey;
      } catch {
        // Non-fatal — pay page falls back to the 2-step redirect flow
        // if the key can't be loaded.
      }
    }

    // Phase F #6r (2026-08-29): aggregate vendor info from the first line
    // item's product (if that product has vendor fields set). One-vendor-
    // per-invoice assumption is fine for MVP — real multi-vendor invoices
    // are rare and can be handled later with a per-item vendor strip.
    const vendorProduct = invoice.items
      .map((it) => it.product)
      .find((p) => p && p.vendorName);
    const vendor = vendorProduct
      ? {
          name: vendorProduct.vendorName!,
          logoUrl: vendorProduct.vendorLogoUrl,
          websiteUrl: vendorProduct.vendorWebsiteUrl,
          supportEmail: vendorProduct.vendorSupportEmail,
          // #6s: vendor brand color. When set, pay page swaps in the
          // vendor's theme (deep-navy hero derived at render, accents in
          // this hex). When null, hub teal remains.
          brandColor: vendorProduct.vendorBrandColor,
          // #6t: compliance text — parent legal name, licence text,
          // statement descriptor. Each renders only when set.
          legalName: vendorProduct.vendorLegalName,
          licenseText: vendorProduct.vendorLicenseText,
          statementDescriptor: vendorProduct.vendorStatementDescriptor,
        }
      : null;

    return NextResponse.json({
      success: true,
      paymentMethod,
      // For the pay page to mount Elements at page load (one-step
      // deferred-intent flow). Null when supplier has no Stripe.
      stripePublishableKey,
      vendor,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        currency: invoice.currency,
        subtotalCents: invoice.subtotalCents,
        taxCents: invoice.taxCents,
        totalCents: invoice.totalCents,
        notes: invoice.notes,
        paymentStatus: invoice.paymentStatus,
        paymentLinkUrl: invoice.paymentLinkUrl,
        paidAt: invoice.paidAt,
        sentAt: invoice.sentAt,
        customer: {
          name: invoice.customerName,
          email: invoice.customerEmail,
          company: invoice.customerCompany,
          address: invoice.customerAddress,
        },
        items: invoice.items.map((it) => ({
          id: it.id,
          productName: it.productName,
          productDescription: it.productDescription,
          unitLabel: it.unitLabel,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          lineTotalCents: it.lineTotalCents,
        })),
      },
      supplier: {
        displayName:
          supplierProfile?.displayName ||
          supplierSettings?.brandName ||
          invoice.supplier.name,
        legalName: supplierProfile?.legalName || null,
        contactEmail: supplierProfile?.contactEmail || null,
        contactPhone: supplierProfile?.contactPhone || null,
        websiteUrl: supplierProfile?.websiteUrl || null,
        // Phase I #14 (2026-09-23): tenants can hide the "Powered by
        // hub / MEGO" footer + trust chips row by turning off
        // tenant_settings.powered_by_visible. Defaults true.
        poweredByVisible: supplierSettings?.poweredByVisible ?? true,
        // Phase I #15 (2026-09-26): tenants can disable /pay/embed
        // entirely (partners must use the /l/[slug] link page instead).
        iframeEnabled: supplierSettings?.iframeEnabled ?? true,
        brand: {
          logoUrl: supplierSettings?.brandLogoUrl || null,
          primaryColor: supplierSettings?.brandPrimaryColor || "#0F766E",
          accentColor: supplierSettings?.brandAccentColor || "#14B8A6",
          backgroundColor: supplierSettings?.brandBackgroundColor || "#FFFFFF",
        },
      },
    });
  } catch (err: any) {
    console.error("[PAY-INVOICE] read error:", err);
    return NextResponse.json({ error: "Failed to load invoice" }, { status: 500 });
  }
}
