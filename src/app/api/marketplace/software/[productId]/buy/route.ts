// POST /api/marketplace/software/[productId]/buy
//
// Auth: partner_token required — any hub tenant (merchant or supplier) can
// buy from the marketplace. We use their tenant's contact info as the
// invoice's customer, then delegate to createSupplierInvoice which handles
// invoice numbering, payment-link generation, and the fire-and-forget SES.
//
// The returned { payUrl } is the same URL the supplier would email out;
// the marketplace UI redirects the buyer straight to it, so they land on
// the branded pay page (which then hits Stripe or mock).
//
// A buyer trying to buy their own listing is refused (409) — supplier
// shouldn't invoice themselves.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { createSupplierInvoice } from "@/lib/supplier-invoices";
import { sendSupplierInvoiceEmail } from "@/lib/email";
import { notifyInvoiceCreated } from "@/lib/telegram-notify";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  const session = await getPartnerSession(request);
  if (!session) {
    return NextResponse.json(
      { error: "Sign in required to purchase from the marketplace" },
      { status: 401 }
    );
  }

  try {
    // Load the product + supplier + membership (buyer contact info).
    const [product, buyerTenant, buyerMembership] = await Promise.all([
      prisma.supplierProduct.findFirst({
        where: {
          id: productId,
          productType: "SOFTWARE",
          isPublic: true,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          description: true,
          unitLabel: true,
          wholesalePriceCents: true,
          supplierTenantId: true,
          // #6u: vendor branding for the invoice email swap.
          vendorName: true,
          vendorLogoUrl: true,
          vendorBrandColor: true,
          vendorLegalName: true,
          vendorLicenseText: true,
          vendorStatementDescriptor: true,
          vendorSupportEmail: true,
          supplierTenant: {
            select: {
              currency: true,
              name: true,
              supplierProfile: {
                select: { displayName: true, contactEmail: true },
              },
              settings: {
                select: { brandName: true, brandPrimaryColor: true },
              },
            },
          },
        },
      }),
      prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { id: true, name: true },
      }),
      prisma.membership.findUnique({
        where: { id: session.memberId },
        select: { email: true, firstName: true, lastName: true },
      }),
    ]);

    if (!product) {
      return NextResponse.json({ error: "Listing not found or not public" }, { status: 404 });
    }
    if (!buyerTenant || !buyerMembership) {
      return NextResponse.json({ error: "Account not found" }, { status: 401 });
    }
    if (product.supplierTenantId === buyerTenant.id) {
      return NextResponse.json(
        { error: "You can't buy your own listing" },
        { status: 409 }
      );
    }

    // Customer-facing name: use tenant name (the business buying), not the
    // individual member. Fall back to the member's name if the tenant has
    // no useful display.
    const customerName =
      buyerTenant.name && buyerTenant.name.trim().length > 0
        ? buyerTenant.name
        : [buyerMembership.firstName, buyerMembership.lastName]
            .filter(Boolean)
            .join(" ") || "Buyer";

    const origin = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    const currency = product.supplierTenant?.currency || "CAD";

    const invoice = await createSupplierInvoice(
      {
        supplierTenantId: product.supplierTenantId,
        // We're not the "supplier's staff" creating this — leave the audit
        // field null. The webhook + pay page still record who paid.
        createdByMembershipId: null,
        customerName,
        customerEmail: buyerMembership.email,
        customerCompany: buyerTenant.name || null,
        currency,
        notes: `Marketplace purchase · ${product.name}`,
        lines: [
          {
            productId: product.id,
            productName: product.name,
            productDescription: product.description,
            unitLabel: product.unitLabel || "license",
            quantity: 1,
            unitPriceCents: product.wholesalePriceCents,
          },
        ],
      },
      origin
    );

    // Ops Telegram ping — new invoice created via marketplace Buy Now.
    // One-off (subscription-through-marketplace is not wired yet).
    void notifyInvoiceCreated({
      invoiceNumber: invoice.invoiceNumber,
      amountCents: invoice.totalCents,
      currency: invoice.currency,
      subscription: null,
    });

    // Same fire-and-forget email pattern as the supplier's own create
    // endpoint — buyer gets an email copy of the invoice, on top of the
    // instant redirect. Convenient if they abandon the pay page and want
    // to come back to it.
    void (async () => {
      try {
        if (!invoice.paymentLinkUrl) return;
        await sendSupplierInvoiceEmail({
          to: invoice.customerEmail,
          supplierDisplayName:
            product.supplierTenant?.supplierProfile?.displayName ||
            product.supplierTenant?.settings?.brandName ||
            product.supplierTenant?.name ||
            "hub",
          supplierContactEmail:
            product.supplierTenant?.supplierProfile?.contactEmail || null,
          invoiceNumber: invoice.invoiceNumber,
          totalCents: invoice.totalCents,
          currency: invoice.currency,
          itemCount: invoice.items.length,
          paymentLinkUrl: invoice.paymentLinkUrl,
          brandPrimaryColor:
            product.supplierTenant?.settings?.brandPrimaryColor || null,
          notes: invoice.notes,
          // #6u: vendor theme swap — Deep Navy header + Electric Blue CTA
          // when this product is a resold vendor listing.
          vendor: product.vendorName
            ? {
                name: product.vendorName,
                logoUrl: product.vendorLogoUrl,
                brandColor: product.vendorBrandColor || "#006AFE",
                legalName: product.vendorLegalName,
                licenseText: product.vendorLicenseText,
                statementDescriptor: product.vendorStatementDescriptor,
                supportEmail: product.vendorSupportEmail,
              }
            : null,
        });
        await prisma.supplierInvoice.update({
          where: { id: invoice.id },
          data: { emailSentAt: new Date(), emailFailedReason: null },
        });
      } catch (err: any) {
        console.error("[MARKETPLACE-BUY] email failed:", err);
        await prisma.supplierInvoice
          .update({
            where: { id: invoice.id },
            data: {
              emailFailedReason:
                (err?.name || "Error") + ": " + String(err?.message || err).slice(0, 500),
            },
          })
          .catch(() => {});
      }
    })();

    return NextResponse.json({
      success: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      payUrl: invoice.paymentLinkUrl,
      totalCents: invoice.totalCents,
      currency: invoice.currency,
    });
  } catch (err: any) {
    console.error("[MARKETPLACE-BUY] error:", err);
    const message = typeof err?.message === "string" ? err.message : "Purchase failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
