// GET  /api/supplier/products — list this supplier's products
// POST /api/supplier/products — create a new product (with images)
//
// Query params on GET:
//   ?search=xyz          — case-insensitive name/SKU search
//   ?categoryId=<uuid>   — filter by category
//   ?activeOnly=true     — hide soft-deleted products

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { validateAndNormalizeVariants, validatePriceTiers } from "@/lib/supplier-variants";

// Cap on image count + size, enforced server-side. UI enforces these too,
// but a server check keeps the DB from filling with 50 MB rows if someone
// bypasses the modal (curl, malicious client, etc.).
const MAX_IMAGES_PER_PRODUCT = 5;
const MAX_IMAGE_DATA_URL_LENGTH = 2_500_000; // ~1.8 MB decoded — safe for 1 MB source files after base64 inflation

// #6s: shape check for vendor brand color. #RGB / #RRGGBB only — anything
// else (raw color names, HSL strings, arbitrary text) is rejected so a
// client can't inject non-hex values into the pay-page palette.
function isValidHexColor(v: unknown): boolean {
  return typeof v === "string" && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(v.trim());
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const categoryId = searchParams.get("categoryId");
    const activeOnly = searchParams.get("activeOnly") === "true";

    const where: any = { supplierTenantId: auth.tenant.id };
    if (activeOnly) where.isActive = true;
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }

    // List-view query — we skip loading full image dataUrls (they're huge)
    // and just grab the primary image for the thumbnail. Detail view (GET
    // /[id]) loads all images + variants.
    const products = await prisma.supplierProduct.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        category: { select: { id: true, name: true } },
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { id: true, dataUrl: true, altText: true },
        },
        // Phase D #71: variant count for the product card badge (e.g.
        // "3 variants"). Only counts ACTIVE variants — soft-deleted ones
        // hidden from merchants stay counted internally on the detail view.
        _count: { select: { variants: { where: { isActive: true } } } },
      },
    });

    return NextResponse.json({ success: true, products });
  } catch (error: any) {
    console.error("[SUPPLIER-PRODUCTS] GET error:", error);
    return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();

    // Validate required fields early so we don't waste a transaction.
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Product name is required" }, { status: 400 });
    }
    const wholesalePriceCents = Math.round(Number(body.wholesalePriceCents));
    if (!Number.isFinite(wholesalePriceCents) || wholesalePriceCents < 0) {
      return NextResponse.json({ error: "Valid wholesale price is required" }, { status: 400 });
    }

    // Optional-but-validated fields
    const sku = body.sku?.trim() || null;
    if (sku) {
      const dup = await prisma.supplierProduct.findFirst({
        where: { supplierTenantId: auth.tenant.id, sku },
      });
      if (dup) {
        return NextResponse.json(
          { error: `SKU "${sku}" is already used by another product` },
          { status: 409 }
        );
      }
    }

    // Category ownership check — supplier can't attach a product to another
    // supplier's category via a leaked ID.
    const categoryId = body.categoryId || null;
    if (categoryId) {
      const category = await prisma.supplierProductCategory.findFirst({
        where: { id: categoryId, supplierTenantId: auth.tenant.id },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
    }

    // Images. Client sends an array of { dataUrl, altText?, isPrimary? }.
    const rawImages: any[] = Array.isArray(body.images) ? body.images : [];
    if (rawImages.length > MAX_IMAGES_PER_PRODUCT) {
      return NextResponse.json(
        { error: `Up to ${MAX_IMAGES_PER_PRODUCT} images per product` },
        { status: 400 }
      );
    }
    for (const img of rawImages) {
      if (typeof img?.dataUrl !== "string" || !img.dataUrl.length) {
        return NextResponse.json({ error: "Every image needs a dataUrl" }, { status: 400 });
      }
      if (img.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return NextResponse.json(
          { error: `An image exceeds the size limit (max ~1 MB per image)` },
          { status: 400 }
        );
      }
    }
    // If the client didn't mark any image as primary, promote the first one.
    // Enforcement of the "one primary per product" partial unique index is
    // done here — the DB would 500 if two came in with is_primary=true.
    const hasPrimary = rawImages.some((i) => i.isPrimary);
    const imagesToCreate = rawImages.map((img, idx) => ({
      dataUrl: img.dataUrl,
      altText: img.altText?.trim() || null,
      sortOrder: typeof img.sortOrder === "number" ? img.sortOrder : idx,
      isPrimary: hasPrimary ? Boolean(img.isPrimary) : idx === 0,
    }));

    // Phase D #71 (2026-07-30): variants + axes.
    // Axes are the free-form axis names ("Weight", "Format", "Color", …).
    // Empty = simple product; anything else requires at least one variant
    // whose attributes cover every axis. Validation is centralized in
    // validateAndNormalizeVariants().
    const variantAxes: string[] = Array.isArray(body.variantAxes)
      ? body.variantAxes
          .map((s: unknown) => String(s).trim())
          .filter((s: string) => s.length > 0)
      : [];
    // Dedup axis names case-sensitively — leaving different casings would
    // let the client accidentally split "Size" and "size" into two axes.
    if (new Set(variantAxes).size !== variantAxes.length) {
      return NextResponse.json(
        { error: "Variant axis names must be unique." },
        { status: 400 }
      );
    }

    const variantsResult = validateAndNormalizeVariants(body.variants, variantAxes);
    if (!variantsResult.ok) {
      return NextResponse.json({ error: variantsResult.error }, { status: 400 });
    }

    // Phase D #73: product-level price tiers. Only meaningful on simple
    // products (no variant axes) — reject if the supplier sent tiers on
    // a product that ALSO has variants to avoid ambiguity.
    const productTiersResult = validatePriceTiers(body.priceTiers, "Product");
    if (!productTiersResult.ok) {
      return NextResponse.json({ error: productTiersResult.error }, { status: 400 });
    }
    if (productTiersResult.tiers.length > 0 && variantAxes.length > 0) {
      return NextResponse.json(
        {
          error:
            "Products with variants can't have product-level tiers — set tiers on each variant instead.",
        },
        { status: 400 }
      );
    }

    // Phase F #1 (2026-08-27): productType decides which of the two field
    // sets applies. 'PHYSICAL' is the historical path; 'SOFTWARE' hides the
    // physical stuff (SKU/stock/lead-time still saved with sensible defaults)
    // and stores the software-listing fields instead. Anything else falls
    // back to 'PHYSICAL' so a mis-typed client can't break the row.
    const productType =
      body.productType === "SOFTWARE" ? "SOFTWARE" : "PHYSICAL";
    const isSoftware = productType === "SOFTWARE";

    const created = await prisma.supplierProduct.create({
      data: {
        supplierTenantId: auth.tenant.id,
        categoryId,
        sku,
        barcode: body.barcode?.trim() || null,
        name,
        description: body.description?.trim() || null,
        unitLabel: body.unitLabel?.trim() || (isSoftware ? "license" : "unit"),
        wholesalePriceCents,
        // Phase H #1 (2026-09-02): per-product currency override —
        // three-letter ISO code, defaults to 'CAD' if the client omits
        // it. See prisma/migrations/phase-h-product-currency.sql.
        priceCurrency: (typeof body.priceCurrency === "string" && body.priceCurrency.trim())
          ? body.priceCurrency.trim().toUpperCase().slice(0, 3)
          : "CAD",
        productType,
        // Software fields — only saved when the product is a software
        // listing; on physical rows we leave them null so nothing bleeds
        // between the two shapes.
        softwareDownloadUrl:  isSoftware ? (body.softwareDownloadUrl?.trim() || null) : null,
        softwareDocsUrl:      isSoftware ? (body.softwareDocsUrl?.trim() || null) : null,
        softwareVersion:      isSoftware ? (body.softwareVersion?.trim() || null) : null,
        softwareRequirements: isSoftware ? (body.softwareRequirements?.trim() || null) : null,
        softwareLicenseModel: isSoftware ? (body.softwareLicenseModel?.trim() || null) : null,
        softwarePricingModel: isSoftware
          ? (["ONE_TIME", "MONTHLY", "ANNUAL", "USAGE"].includes(body.softwarePricingModel)
              ? body.softwarePricingModel
              : "ONE_TIME")
          : null,
        softwareTrialDays:
          isSoftware && body.softwareTrialDays != null && body.softwareTrialDays !== ""
            ? Math.max(0, Math.round(Number(body.softwareTrialDays)))
            : null,
        retailPriceCents:
          body.retailPriceCents != null && body.retailPriceCents !== ""
            ? Math.round(Number(body.retailPriceCents))
            : null,
        minOrderQty: Math.max(1, Math.round(Number(body.minOrderQty)) || 1),
        stepQty: Math.max(1, Math.round(Number(body.stepQty)) || 1),
        trackInventory: Boolean(body.trackInventory),
        stockLevel:
          body.trackInventory && body.stockLevel != null && body.stockLevel !== ""
            ? Math.round(Number(body.stockLevel))
            : null,
        lowStockThreshold:
          body.trackInventory &&
          body.lowStockThreshold != null &&
          body.lowStockThreshold !== ""
            ? Math.round(Number(body.lowStockThreshold))
            : null,
        leadTimeDays:
          body.leadTimeDays != null && body.leadTimeDays !== ""
            ? Math.round(Number(body.leadTimeDays))
            : null,
        isPublic: Boolean(body.isPublic),
        isActive: body.isActive !== false, // default true
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
        variantAxes,
        // Phase F #6q (2026-08-29): per-product T&C. Only accepted for
        // SOFTWARE products so a resold licence can carry the vendor's terms.
        termsVersionId:
          isSoftware && typeof body.termsVersionId === "string" && body.termsVersionId
            ? body.termsVersionId
            : null,
        // Phase F #6r (2026-08-29): vendor identity. All optional; only meaningful
        // for SOFTWARE products (reseller marketplace pattern). Trimmed + null-if-empty.
        vendorName:          isSoftware ? (body.vendorName?.trim()          || null) : null,
        vendorLogoUrl:       isSoftware ? (body.vendorLogoUrl?.trim()       || null) : null,
        vendorWebsiteUrl:    isSoftware ? (body.vendorWebsiteUrl?.trim()    || null) : null,
        vendorSupportEmail:  isSoftware ? (body.vendorSupportEmail?.trim()  || null) : null,
        // Phase F #6s (2026-08-29): vendor brand color (hex like #006AFF).
        // Drives the per-vendor pay-page theme swap. Only accepted for
        // SOFTWARE products, and only when it looks like a hex color to
        // stop the client from stashing arbitrary strings in the palette.
        vendorBrandColor: isSoftware && isValidHexColor(body.vendorBrandColor)
          ? (body.vendorBrandColor as string).trim().toUpperCase()
          : null,
        // #6t: compliance text for the pixel-perfect per-vendor pay page.
        // All optional; trimmed + null-if-empty; only saved on SOFTWARE rows.
        vendorLegalName:            isSoftware ? (body.vendorLegalName?.trim()           || null) : null,
        vendorLicenseText:          isSoftware ? (body.vendorLicenseText?.trim()         || null) : null,
        vendorStatementDescriptor:  isSoftware ? (body.vendorStatementDescriptor?.trim() || null) : null,
        images: { create: imagesToCreate },
        // Variants are created via nested create — same transaction.
        // Phase D #73: variant tiers piggyback on nested create.
        variants: {
          create: variantsResult.normalized.map((v) => ({
            // Never trust client-provided ids on CREATE — they're only
            // meaningful on UPDATE (see PUT handler).
            displayName: v.displayName,
            attributes: v.attributes,
            sku: v.sku,
            barcode: v.barcode,
            wholesalePriceCents: v.wholesalePriceCents,
            retailPriceCents: v.retailPriceCents,
            minOrderQty: v.minOrderQty,
            stepQty: v.stepQty,
            trackInventory: v.trackInventory,
            stockLevel: v.stockLevel,
            lowStockThreshold: v.lowStockThreshold,
            imageDataUrl: v.imageDataUrl,
            isActive: v.isActive,
            sortOrder: v.sortOrder,
            priceTiers: v.priceTiers.length
              ? { create: v.priceTiers }
              : undefined,
          })),
        },
        // Phase D #73: product-level tiers (guarded above — only when
        // no variant axes).
        priceTiers: productTiersResult.tiers.length
          ? { create: productTiersResult.tiers }
          : undefined,
      },
      include: {
        category: { select: { id: true, name: true } },
        images: true,
        variants: {
          orderBy: { sortOrder: "asc" },
          include: { priceTiers: { orderBy: { minQty: "asc" } } },
        },
        priceTiers: { orderBy: { minQty: "asc" } },
      },
    });

    return NextResponse.json({ success: true, product: created });
  } catch (error: any) {
    console.error("[SUPPLIER-PRODUCTS] POST error:", error);
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
}
