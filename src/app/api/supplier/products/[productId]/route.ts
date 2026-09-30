// GET    /api/supplier/products/[productId] — full detail incl. all images
// PUT    /api/supplier/products/[productId] — update fields + replace image set
// DELETE /api/supplier/products/[productId] — hard delete (cascades images)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { validateAndNormalizeVariants, validatePriceTiers } from "@/lib/supplier-variants";

const MAX_IMAGES_PER_PRODUCT = 5;
const MAX_IMAGE_DATA_URL_LENGTH = 2_500_000;

// Guard: product MUST belong to the current supplier. Applied at the top
// of every handler — cheap and consistent.
async function loadOwnedProduct(supplierTenantId: string, productId: string) {
  return prisma.supplierProduct.findFirst({
    where: { id: productId, supplierTenantId },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { productId } = await params;

    const product = await prisma.supplierProduct.findFirst({
      where: { id: productId, supplierTenantId: auth.tenant.id },
      include: {
        category: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: "asc" } },
        // Phase D #71: include ALL variants (active + inactive) so the
        // editor can show soft-deleted ones under a "retired" section.
        // Phase D #73: include their tiers nested — one query round-trip.
        variants: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: { priceTiers: { orderBy: { minQty: "asc" } } },
        },
        // Phase D #73: product-level tiers (only used when no variants).
        priceTiers: { orderBy: { minQty: "asc" } },
      },
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, product });
  } catch (error: any) {
    console.error("[SUPPLIER-PRODUCT] GET error:", error);
    return NextResponse.json({ error: "Failed to load product" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { productId } = await params;

    const existing = await loadOwnedProduct(auth.tenant.id, productId);
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const body = await request.json();

    // Whitelist editable fields. Same validation shape as POST — keeps the
    // create/update contract identical from the UI's perspective.
    const data: Record<string, unknown> = {};

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      data.name = name;
    }

    if (body.sku !== undefined) {
      const sku = body.sku?.trim() || null;
      // Same "unique when set" check as POST — but scoped to exclude the
      // current product from dup detection.
      if (sku && sku !== existing.sku) {
        const dup = await prisma.supplierProduct.findFirst({
          where: {
            supplierTenantId: auth.tenant.id,
            sku,
            NOT: { id: productId },
          },
        });
        if (dup) {
          return NextResponse.json(
            { error: `SKU "${sku}" is already used by another product` },
            { status: 409 }
          );
        }
      }
      data.sku = sku;
    }

    if (body.categoryId !== undefined) {
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
      data.categoryId = categoryId;
    }

    if (body.barcode !== undefined) data.barcode = body.barcode?.trim() || null;
    if (typeof body.description === "string") data.description = body.description.trim() || null;
    if (typeof body.unitLabel === "string") data.unitLabel = body.unitLabel.trim() || "unit";

    if (body.wholesalePriceCents !== undefined) {
      const w = Math.round(Number(body.wholesalePriceCents));
      if (!Number.isFinite(w) || w < 0) {
        return NextResponse.json({ error: "Wholesale price must be a non-negative number" }, { status: 400 });
      }
      data.wholesalePriceCents = w;
    }
    if (body.retailPriceCents !== undefined) {
      data.retailPriceCents =
        body.retailPriceCents === null || body.retailPriceCents === ""
          ? null
          : Math.round(Number(body.retailPriceCents));
    }
    // Phase H #1 (2026-09-02): per-product currency override — three-letter
    // ISO code. Only touched when the client sends it; unchanged otherwise.
    if (typeof body.priceCurrency === "string" && body.priceCurrency.trim()) {
      data.priceCurrency = body.priceCurrency.trim().toUpperCase().slice(0, 3);
    }
    if (body.minOrderQty !== undefined) {
      data.minOrderQty = Math.max(1, Math.round(Number(body.minOrderQty)) || 1);
    }
    if (body.stepQty !== undefined) {
      data.stepQty = Math.max(1, Math.round(Number(body.stepQty)) || 1);
    }
    if (body.trackInventory !== undefined) data.trackInventory = Boolean(body.trackInventory);
    if (body.stockLevel !== undefined) {
      data.stockLevel =
        body.stockLevel === null || body.stockLevel === ""
          ? null
          : Math.round(Number(body.stockLevel));
    }
    if (body.lowStockThreshold !== undefined) {
      data.lowStockThreshold =
        body.lowStockThreshold === null || body.lowStockThreshold === ""
          ? null
          : Math.round(Number(body.lowStockThreshold));
    }
    if (body.leadTimeDays !== undefined) {
      data.leadTimeDays =
        body.leadTimeDays === null || body.leadTimeDays === ""
          ? null
          : Math.round(Number(body.leadTimeDays));
    }
    if (body.isPublic !== undefined) data.isPublic = Boolean(body.isPublic);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

    // Phase F #1 (2026-08-27): software-listing fields. All optional on
    // PATCH — absent = leave unchanged. Anything except 'SOFTWARE' on
    // productType is normalised to 'PHYSICAL' so the DB never holds an
    // arbitrary label the app doesn't know how to render.
    if (body.productType !== undefined) {
      data.productType = body.productType === "SOFTWARE" ? "SOFTWARE" : "PHYSICAL";
    }
    if (body.softwareDownloadUrl !== undefined) {
      data.softwareDownloadUrl = body.softwareDownloadUrl?.trim() || null;
    }
    if (body.softwareDocsUrl !== undefined) {
      data.softwareDocsUrl = body.softwareDocsUrl?.trim() || null;
    }
    if (body.softwareVersion !== undefined) {
      data.softwareVersion = body.softwareVersion?.trim() || null;
    }
    if (body.softwareRequirements !== undefined) {
      data.softwareRequirements = body.softwareRequirements?.trim() || null;
    }
    if (body.softwareLicenseModel !== undefined) {
      data.softwareLicenseModel = body.softwareLicenseModel?.trim() || null;
    }
    if (body.softwarePricingModel !== undefined) {
      data.softwarePricingModel = ["ONE_TIME", "MONTHLY", "ANNUAL", "USAGE"].includes(
        body.softwarePricingModel
      )
        ? body.softwarePricingModel
        : null;
    }
    if (body.softwareTrialDays !== undefined) {
      data.softwareTrialDays =
        body.softwareTrialDays === null || body.softwareTrialDays === ""
          ? null
          : Math.max(0, Math.round(Number(body.softwareTrialDays)));
    }
    // Phase F #6q (2026-08-29): per-product T&C — attach a specific
    // SupplierTermsVersion. Empty string / null clears it (falls back to
    // supplier tenant's default T&C at pay time).
    if (body.termsVersionId !== undefined) {
      const raw = typeof body.termsVersionId === "string" ? body.termsVersionId.trim() : "";
      data.termsVersionId = raw ? raw : null;
    }
    // Phase F #6r (2026-08-29): vendor identity fields. Trim + null-if-empty.
    if (body.vendorName !== undefined) {
      data.vendorName = body.vendorName?.trim() || null;
    }
    if (body.vendorLogoUrl !== undefined) {
      data.vendorLogoUrl = body.vendorLogoUrl?.trim() || null;
    }
    if (body.vendorWebsiteUrl !== undefined) {
      data.vendorWebsiteUrl = body.vendorWebsiteUrl?.trim() || null;
    }
    if (body.vendorSupportEmail !== undefined) {
      data.vendorSupportEmail = body.vendorSupportEmail?.trim() || null;
    }
    // #6s: vendor brand color. Empty clears; valid hex saves; junk rejected.
    if (body.vendorBrandColor !== undefined) {
      const raw = typeof body.vendorBrandColor === "string" ? body.vendorBrandColor.trim() : "";
      if (raw === "") {
        data.vendorBrandColor = null;
      } else if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(raw)) {
        data.vendorBrandColor = raw.toUpperCase();
      } else {
        return NextResponse.json(
          { error: "Vendor brand color must be a hex value like #006AFF" },
          { status: 400 }
        );
      }
    }
    // #6t: compliance text fields. Trim + null-if-empty; length capped so
    // the pay page footer + statement notice can't overflow their slots.
    if (body.vendorLegalName !== undefined) {
      const v = body.vendorLegalName?.trim() || null;
      if (v && v.length > 255) {
        return NextResponse.json({ error: "Vendor legal name is too long (max 255 chars)" }, { status: 400 });
      }
      data.vendorLegalName = v;
    }
    if (body.vendorLicenseText !== undefined) {
      const v = body.vendorLicenseText?.trim() || null;
      if (v && v.length > 255) {
        return NextResponse.json({ error: "Vendor license text is too long (max 255 chars)" }, { status: 400 });
      }
      data.vendorLicenseText = v;
    }
    if (body.vendorStatementDescriptor !== undefined) {
      const v = body.vendorStatementDescriptor?.trim() || null;
      if (v && v.length > 64) {
        return NextResponse.json({ error: "Statement descriptor is too long (max 64 chars)" }, { status: 400 });
      }
      data.vendorStatementDescriptor = v;
    }

    // Phase D #71 (2026-07-30): variant handling.
    //
    // Present-vs-absent semantics:
    //   - `variantAxes` OR `variants` absent from body → variants unchanged
    //   - Either present → we sync everything (axes + variants together
    //     since the validator requires them consistent)
    //
    // Diff strategy: match by variant.id where present. Existing variants
    // not in the incoming list get soft-deleted (isActive=false) — hard
    // delete would break PO history via the SET NULL FK.
    const willSyncVariants =
      Array.isArray(body.variants) || Array.isArray(body.variantAxes);

    let normalizedVariants: ReturnType<typeof validateAndNormalizeVariants> | null = null;
    let nextVariantAxes: string[] = existing.variantAxes;

    if (willSyncVariants) {
      const submittedAxes: string[] = Array.isArray(body.variantAxes)
        ? body.variantAxes
            .map((s: unknown) => String(s).trim())
            .filter((s: string) => s.length > 0)
        : existing.variantAxes;

      if (new Set(submittedAxes).size !== submittedAxes.length) {
        return NextResponse.json(
          { error: "Variant axis names must be unique." },
          { status: 400 }
        );
      }
      nextVariantAxes = submittedAxes;

      normalizedVariants = validateAndNormalizeVariants(
        body.variants ?? [],
        submittedAxes
      );
      if (!normalizedVariants.ok) {
        return NextResponse.json(
          { error: normalizedVariants.error },
          { status: 400 }
        );
      }
      data.variantAxes = submittedAxes;
    }

    // Phase D #73: product-level tiers. Validated up-front; applied
    // inside the transaction with a replace-all (deleteMany + createMany).
    // Only meaningful when the product has no variants — same guard as POST.
    const willReplaceProductTiers = Array.isArray(body.priceTiers);
    let productTiers: { minQty: number; unitPriceCents: number }[] = [];
    if (willReplaceProductTiers) {
      const r = validatePriceTiers(body.priceTiers, "Product");
      if (!r.ok) {
        return NextResponse.json({ error: r.error }, { status: 400 });
      }
      const nextAxes = willSyncVariants ? nextVariantAxes : existing.variantAxes;
      if (r.tiers.length > 0 && nextAxes.length > 0) {
        return NextResponse.json(
          {
            error:
              "Products with variants can't have product-level tiers — set tiers on each variant instead.",
          },
          { status: 400 }
        );
      }
      productTiers = r.tiers;
    }

    // Image replacement — if the client sent an `images` array, we treat
    // it as the complete new set. Simpler than granular add/remove/reorder
    // endpoints for v1; the whole array round-trips on every save.
    const replaceImages = Array.isArray(body.images);
    if (replaceImages) {
      if (body.images.length > MAX_IMAGES_PER_PRODUCT) {
        return NextResponse.json(
          { error: `Up to ${MAX_IMAGES_PER_PRODUCT} images per product` },
          { status: 400 }
        );
      }
      for (const img of body.images) {
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
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.supplierProduct.update({
        where: { id: productId },
        data,
      });

      if (replaceImages) {
        // Delete-all-then-insert is the safest way to keep the "one primary
        // per product" partial unique index happy across renames + reorders.
        // Volume is tiny (≤5 rows), so no perf concern.
        await tx.supplierProductImage.deleteMany({ where: { productId } });

        const hasPrimary = body.images.some((i: any) => i.isPrimary);
        if (body.images.length) {
          await tx.supplierProductImage.createMany({
            data: body.images.map((img: any, idx: number) => ({
              productId,
              dataUrl: img.dataUrl,
              altText: img.altText?.trim() || null,
              sortOrder: typeof img.sortOrder === "number" ? img.sortOrder : idx,
              isPrimary: hasPrimary ? Boolean(img.isPrimary) : idx === 0,
            })),
          });
        }
      }

      // Phase D #71: variant sync.
      // Skip when the caller didn't send variant fields (partial-update
      // safety — a supplier just changing the price shouldn't nuke their
      // variants).
      if (willSyncVariants && normalizedVariants?.ok) {
        const incoming = normalizedVariants.normalized;
        const currentVariants = await tx.supplierProductVariant.findMany({
          where: { productId },
          select: { id: true },
        });
        const currentIds = new Set(currentVariants.map((v) => v.id));
        const incomingIds = new Set(
          incoming.map((v) => v.id).filter((id): id is string => !!id)
        );

        // Soft-delete: existing rows not in the incoming list.
        const toDeactivate = [...currentIds].filter((id) => !incomingIds.has(id));
        if (toDeactivate.length > 0) {
          await tx.supplierProductVariant.updateMany({
            where: { id: { in: toDeactivate } },
            data: { isActive: false },
          });
        }

        // Update existing (has id) OR insert new (no id / unknown id).
        // Unknown ids fall through to insert so a stale client id can't
        // corrupt another product's variants.
        for (const v of incoming) {
          const dataFields = {
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
          };
          let variantRowId: string;
          if (v.id && currentIds.has(v.id)) {
            const updated = await tx.supplierProductVariant.update({
              where: { id: v.id },
              data: dataFields,
              select: { id: true },
            });
            variantRowId = updated.id;
          } else {
            const created = await tx.supplierProductVariant.create({
              data: { productId, ...dataFields },
              select: { id: true },
            });
            variantRowId = created.id;
          }

          // Phase D #73: variant tiers — replace-all per variant. Cheap
          // (few rows), preserves the unique index constraints, and keeps
          // the API contract simple ("send the full tier set for each
          // variant, we make it happen").
          await tx.supplierProductPriceTier.deleteMany({
            where: { variantId: variantRowId },
          });
          if (v.priceTiers.length > 0) {
            await tx.supplierProductPriceTier.createMany({
              data: v.priceTiers.map((t) => ({
                variantId: variantRowId,
                minQty: t.minQty,
                unitPriceCents: t.unitPriceCents,
              })),
            });
          }
        }
      }

      // Phase D #73: product-level tiers. Same replace-all pattern. Only
      // touched when the caller sent `priceTiers` on the body.
      if (willReplaceProductTiers) {
        await tx.supplierProductPriceTier.deleteMany({
          where: { productId },
        });
        if (productTiers.length > 0) {
          await tx.supplierProductPriceTier.createMany({
            data: productTiers.map((t) => ({
              productId,
              minQty: t.minQty,
              unitPriceCents: t.unitPriceCents,
            })),
          });
        }
      }

      return p;
    });

    const full = await prisma.supplierProduct.findUnique({
      where: { id: updated.id },
      include: {
        category: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: "asc" } },
        variants: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: { priceTiers: { orderBy: { minQty: "asc" } } },
        },
        priceTiers: { orderBy: { minQty: "asc" } },
      },
    });

    return NextResponse.json({ success: true, product: full });
  } catch (error: any) {
    console.error("[SUPPLIER-PRODUCT] PUT error:", error);
    return NextResponse.json({ error: "Failed to update product" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { productId } = await params;

    const existing = await loadOwnedProduct(auth.tenant.id, productId);
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Hard delete for v1. Images cascade via FK. Once we have POs referencing
    // products (Phase B #58), we'll need to switch this to a soft-delete
    // (set is_active=false) to preserve order history — trivial to add later.
    await prisma.supplierProduct.delete({ where: { id: productId } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[SUPPLIER-PRODUCT] DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
  }
}
