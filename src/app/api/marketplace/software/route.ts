// GET /api/marketplace/software — public list of every SOFTWARE product on hub.
//
// Public: no auth required. Filters:
//   ?category=slug     — supplier product category name (fuzzy)
//   ?search=xyz        — case-insensitive name search
//   ?pricingModel=...  — ONE_TIME / MONTHLY / ANNUAL / USAGE
//
// Only rows where product.isPublic AND product.isActive AND
// productType='SOFTWARE' are returned. The supplier tenant + supplier
// profile display name are joined so the card can show
// "hub POS — by Synergy Data Labs" without a second request.
//
// This is what powers the /marketplace page and, eventually, the "Install"
// tab inside merchant portals.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const category = searchParams.get("category")?.trim();
    const pricingModel = searchParams.get("pricingModel")?.trim();

    // Phase F #6n (2026-08-28): widened to include SERVICE-type products
    // alongside SOFTWARE. Marketplace is now "software & services" — pro
    // services (website dev, SEO, marketing) live next to installable
    // software on the same grid. PHYSICAL products still stay off; those
    // are for the supplier's own PO catalog, not the public marketplace.
    const where: Record<string, unknown> = {
      productType: { in: ["SOFTWARE", "SERVICE"] },
      isPublic: true,
      isActive: true,
    };
    if (pricingModel) where.softwarePricingModel = pricingModel;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }
    if (category) {
      where.category = { name: { contains: category, mode: "insensitive" } };
    }

    const products = await prisma.supplierProduct.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      // Cap at 200 for the MVP — marketplace UI is a grid and users don't
      // scroll past that. Real pagination lands when the catalog grows.
      take: 200,
      select: {
        id: true,
        name: true,
        description: true,
        wholesalePriceCents: true,
        retailPriceCents: true,
        softwareVersion: true,
        softwareLicenseModel: true,
        softwarePricingModel: true,
        softwareTrialDays: true,
        supplierTenantId: true,
        supplierTenant: {
          select: {
            name: true,
            currency: true,
            supplierProfile: {
              select: { displayName: true, websiteUrl: true },
            },
            settings: {
              select: { brandName: true, brandPrimaryColor: true, brandLogoUrl: true },
            },
          },
        },
        category: { select: { id: true, name: true } },
        // Primary image only — the card needs one, not the full gallery.
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { id: true, dataUrl: true, altText: true },
        },
      },
    });

    // Reshape for the client so it doesn't have to unwrap the joined
    // supplier tree everywhere.
    const listings = products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceCents: p.wholesalePriceCents,
      priceReferenceCents: p.retailPriceCents,
      currency: p.supplierTenant?.currency || "CAD",
      version: p.softwareVersion,
      licenseModel: p.softwareLicenseModel,
      pricingModel: p.softwarePricingModel,
      trialDays: p.softwareTrialDays,
      category: p.category?.name || null,
      supplier: {
        id: p.supplierTenantId,
        displayName:
          p.supplierTenant?.supplierProfile?.displayName ||
          p.supplierTenant?.settings?.brandName ||
          p.supplierTenant?.name ||
          "Supplier",
        websiteUrl: p.supplierTenant?.supplierProfile?.websiteUrl || null,
        brandColor: p.supplierTenant?.settings?.brandPrimaryColor || null,
        brandLogoUrl: p.supplierTenant?.settings?.brandLogoUrl || null,
      },
      primaryImage: p.images[0]?.dataUrl || null,
    }));

    return NextResponse.json({ success: true, listings, count: listings.length });
  } catch (err: any) {
    console.error("[MARKETPLACE] list error:", err);
    return NextResponse.json({ error: "Failed to load marketplace" }, { status: 500 });
  }
}
