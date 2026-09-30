// GET /api/marketplace/software/[productId] — public full detail for one
// software listing on hub. Returns everything the /marketplace/[id] page
// needs to render: full description, images, all software fields, supplier
// contact/brand, and the T&C version currently active on that supplier
// (so we can surface "Terms" upfront on the detail page).
//
// Refuses to return non-SOFTWARE products or ones that aren't public/active
// — the marketplace surface is deliberately narrow, physical goods live on
// the merchant-side marketplace under /api/tenants/[tenantId]/marketplace/*.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  try {
    const product = await prisma.supplierProduct.findFirst({
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
        wholesalePriceCents: true,
        retailPriceCents: true,
        softwareDownloadUrl: true,
        softwareDocsUrl: true,
        softwareVersion: true,
        softwareRequirements: true,
        softwareLicenseModel: true,
        softwarePricingModel: true,
        softwareTrialDays: true,
        supplierTenantId: true,
        supplierTenant: {
          select: {
            name: true,
            currency: true,
            supplierProfile: {
              select: {
                displayName: true,
                legalName: true,
                aboutText: true,
                contactEmail: true,
                websiteUrl: true,
              },
            },
            settings: {
              select: {
                brandName: true,
                brandLogoUrl: true,
                brandPrimaryColor: true,
              },
            },
          },
        },
        category: { select: { id: true, name: true } },
        images: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
          select: { id: true, dataUrl: true, altText: true, isPrimary: true },
        },
      },
    });
    if (!product) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Current active T&C for the supplier — shown as a "Read terms" link
    // on the detail page so buyers know what they'll sign at pay time.
    const activeTerms = await prisma.supplierTermsVersion.findFirst({
      where: { supplierTenantId: product.supplierTenantId, effectiveTo: null },
      select: { id: true, version: true, effectiveFrom: true },
    });

    return NextResponse.json({
      success: true,
      listing: {
        id: product.id,
        name: product.name,
        description: product.description,
        priceCents: product.wholesalePriceCents,
        priceReferenceCents: product.retailPriceCents,
        currency: product.supplierTenant?.currency || "CAD",
        version: product.softwareVersion,
        licenseModel: product.softwareLicenseModel,
        pricingModel: product.softwarePricingModel,
        trialDays: product.softwareTrialDays,
        requirements: product.softwareRequirements,
        docsUrl: product.softwareDocsUrl,
        downloadUrl: product.softwareDownloadUrl,
        category: product.category?.name || null,
        images: product.images,
        supplier: {
          id: product.supplierTenantId,
          displayName:
            product.supplierTenant?.supplierProfile?.displayName ||
            product.supplierTenant?.settings?.brandName ||
            product.supplierTenant?.name ||
            "Supplier",
          legalName: product.supplierTenant?.supplierProfile?.legalName || null,
          aboutText: product.supplierTenant?.supplierProfile?.aboutText || null,
          contactEmail: product.supplierTenant?.supplierProfile?.contactEmail || null,
          websiteUrl: product.supplierTenant?.supplierProfile?.websiteUrl || null,
          brandColor: product.supplierTenant?.settings?.brandPrimaryColor || null,
          brandLogoUrl: product.supplierTenant?.settings?.brandLogoUrl || null,
        },
        activeTerms: activeTerms
          ? { version: activeTerms.version, effectiveFrom: activeTerms.effectiveFrom }
          : null,
      },
    });
  } catch (err: any) {
    console.error("[MARKETPLACE] detail error:", err);
    return NextResponse.json({ error: "Failed to load listing" }, { status: 500 });
  }
}
