// GET /api/tenants/[tenantId]/marketplace/suppliers/[supplierId]/products
// Products from a specific supplier, from the merchant's point of view.
//
// Only returns ACTIVE products. Merchant never sees anything the supplier
// has soft-deleted (isActive=false), and doesn't need to worry about
// isPublic — the ACTIVE relationship already gives them access to the
// full private catalog.
//
// Query params: ?search=xyz  ?categoryId=<uuid>

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; supplierId: string }> }
) {
  try {
    const { tenantId, supplierId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    // Same relationship guard as the supplier profile endpoint. Repeating
    // it here rather than extracting to a helper because the marketplace
    // surface only has 3 endpoints total; a helper would be premature.
    const relationship = await prisma.supplierMerchantRelationship.findFirst({
      where: {
        merchantTenantId: tenantId,
        supplierTenantId: supplierId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!relationship) {
      return NextResponse.json(
        { error: "You're not connected to this supplier" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const categoryId = searchParams.get("categoryId");

    const where: any = {
      supplierTenantId: supplierId,
      isActive: true,
    };
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const products = await prisma.supplierProduct.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        category: { select: { id: true, name: true } },
        // Primary thumbnail for the card + fallback for variant images.
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { id: true, dataUrl: true, altText: true },
        },
        // Phase D #72: variants — active only, so merchants never see
        // retired options. Ordered so grid + picker match the supplier's
        // intended display sequence.
        variants: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          // Phase D #73: nested tiers per variant.
          include: {
            priceTiers: {
              orderBy: { minQty: "asc" },
              select: { minQty: true, unitPriceCents: true },
            },
          },
        },
        // Phase D #73: product-level tiers (only meaningful when the
        // product has no variants; supplier UI enforces that but the
        // resolver ignores product tiers when a variant is picked).
        priceTiers: {
          orderBy: { minQty: "asc" },
          select: { minQty: true, unitPriceCents: true },
        },
      },
    });

    // Helper — computes stockIndicator + surfaced stock level from a
    // (trackInventory, stockLevel, lowStockThreshold) trio. Used for both
    // products (simple) and variants.
    const stockOf = (
      trackInventory: boolean,
      stockLevel: number | null,
      lowThresh: number | null
    ): { indicator: "in" | "low" | "out" | null; level: number | null } => {
      if (!trackInventory) return { indicator: null, level: null };
      const lvl = stockLevel ?? 0;
      const low = lowThresh ?? 0;
      let indicator: "in" | "low" | "out";
      if (lvl <= 0) indicator = "out";
      else if (low > 0 && lvl <= low) indicator = "low";
      else indicator = "in";
      return { indicator, level: lvl };
    };

    // We deliberately do NOT expose the supplier's internal cost / margin /
    // stockLevel-vs-lowStockThreshold private wiring. Merchants see resolved
    // wholesale price + unit + min/step qty + a stock indicator.
    const surfaced = products.map((p) => {
      const productStock = stockOf(
        p.trackInventory,
        p.stockLevel,
        p.lowStockThreshold
      );

      // Phase D #72: resolve every variant's price / stock / order-rule
      // fields — null on the variant means "inherit product-level". This
      // is where the "override or inherit" contract from the supplier
      // side gets materialized into what the merchant sees.
      const variants = p.variants.map((v) => {
        const vStock = stockOf(
          v.trackInventory,
          v.stockLevel,
          v.lowStockThreshold
        );
        return {
          id: v.id,
          displayName: v.displayName,
          attributes: v.attributes,
          sku: v.sku,
          wholesalePriceCents: v.wholesalePriceCents ?? p.wholesalePriceCents,
          retailPriceCents: v.retailPriceCents ?? p.retailPriceCents,
          minOrderQty: v.minOrderQty ?? p.minOrderQty,
          stepQty: v.stepQty ?? p.stepQty,
          stockIndicator: vStock.indicator,
          stockLevel: vStock.level,
          image: v.imageDataUrl
            ? { id: `${v.id}-img`, dataUrl: v.imageDataUrl, altText: v.displayName }
            : null,
          // Phase D #73: expose per-variant tiers so the cart can preview
          // the effective price + "add N more to reach the next tier".
          priceTiers: v.priceTiers,
        };
      });

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        description: p.description,
        category: p.category,
        unitLabel: p.unitLabel,
        wholesalePriceCents: p.wholesalePriceCents,
        retailPriceCents: p.retailPriceCents,
        minOrderQty: p.minOrderQty,
        stepQty: p.stepQty,
        leadTimeDays: p.leadTimeDays,
        stockIndicator: productStock.indicator,
        stockLevel: productStock.level,
        image: p.images[0] || null,
        // Phase D #72
        variantAxes: p.variantAxes,
        variants,
        // Phase D #73 — product-level tiers only apply when the product
        // has no variants. When variants exist, tiers hang off each
        // variant (see `variants[].priceTiers` above).
        priceTiers: p.variantAxes.length === 0 ? p.priceTiers : [],
      };
    });

    return NextResponse.json({ success: true, products: surfaced });
  } catch (error: any) {
    console.error("[MARKETPLACE-PRODUCTS] GET error:", error);
    return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
  }
}
