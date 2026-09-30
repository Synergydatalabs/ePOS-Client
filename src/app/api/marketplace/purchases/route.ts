// GET /api/marketplace/purchases — auth required.
//
// Lists every paid supplier invoice where the current partner membership's
// email was the customer. Newest first. Used by /marketplace/mine to give
// the buyer a "your installed apps / receipts" view.
//
// v1 scopes to the current MEMBERSHIP's email (not all memberships in the
// tenant). Two members of the same tenant who each buy something will each
// see only their own purchases. That's the honest, cautious default —
// generalising to "everything my tenant has bought" needs an owner-only
// gate, which we can add when the second real buyer shows up.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

export async function GET(request: NextRequest) {
  const session = await getPartnerSession(request);
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  try {
    const membership = await prisma.membership.findUnique({
      where: { id: session.memberId },
      select: { email: true },
    });
    if (!membership) {
      return NextResponse.json({ error: "Account not found" }, { status: 401 });
    }

    const invoices = await prisma.supplierInvoice.findMany({
      where: {
        customerEmail: membership.email,
        paymentStatus: "PAID",
      },
      orderBy: { paidAt: "desc" },
      take: 200,
      select: {
        id: true,
        invoiceNumber: true,
        currency: true,
        totalCents: true,
        amountPaidCents: true,
        paidAt: true,
        paidMethod: true,
        notes: true,
        supplier: {
          select: {
            id: true,
            name: true,
            supplierProfile: {
              select: { displayName: true, contactEmail: true, websiteUrl: true },
            },
            settings: {
              select: { brandName: true, brandLogoUrl: true, brandPrimaryColor: true },
            },
          },
        },
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            productId: true,
            productName: true,
            productDescription: true,
            quantity: true,
            unitLabel: true,
            unitPriceCents: true,
            lineTotalCents: true,
            // Software fields — join back to the live product row for the
            // download URL / version / license model. Nullable when the
            // product has been deleted since purchase (SET NULL cascade).
            product: {
              select: {
                productType: true,
                softwareDownloadUrl: true,
                softwareDocsUrl: true,
                softwareVersion: true,
                softwareLicenseModel: true,
              },
            },
          },
        },
      },
    });

    const purchases = invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      currency: inv.currency,
      totalCents: inv.totalCents,
      amountPaidCents: inv.amountPaidCents ?? inv.totalCents,
      paidAt: inv.paidAt,
      paidMethod: inv.paidMethod,
      notes: inv.notes,
      supplier: {
        id: inv.supplier.id,
        displayName:
          inv.supplier.supplierProfile?.displayName ||
          inv.supplier.settings?.brandName ||
          inv.supplier.name,
        contactEmail: inv.supplier.supplierProfile?.contactEmail || null,
        websiteUrl: inv.supplier.supplierProfile?.websiteUrl || null,
        brandColor: inv.supplier.settings?.brandPrimaryColor || null,
        brandLogoUrl: inv.supplier.settings?.brandLogoUrl || null,
      },
      items: inv.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        productDescription: it.productDescription,
        quantity: it.quantity,
        unitLabel: it.unitLabel,
        unitPriceCents: it.unitPriceCents,
        lineTotalCents: it.lineTotalCents,
        // Software affordances — only populated when the product is still
        // in the catalog and typed as SOFTWARE. Buyer uses these to install
        // what they paid for.
        software:
          it.product?.productType === "SOFTWARE"
            ? {
                downloadUrl: it.product.softwareDownloadUrl,
                docsUrl: it.product.softwareDocsUrl,
                version: it.product.softwareVersion,
                licenseModel: it.product.softwareLicenseModel,
              }
            : null,
      })),
    }));

    return NextResponse.json({ success: true, purchases, count: purchases.length });
  } catch (err: any) {
    console.error("[MARKETPLACE-PURCHASES] error:", err);
    return NextResponse.json({ error: "Failed to load purchases" }, { status: 500 });
  }
}
