// POST /api/supplier/products/import
// Bulk import supplier products from a CSV that was parsed client-side.
//
// Body: {
//   rows: [
//     { name: "...", wholesale_price: "85.00", sku: "...", category: "Cheese", ... },
//     ...
//   ]
// }
//
// Response: {
//   success: true,
//   imported: number,        // rows actually inserted
//   skipped: number,         // rows rejected (see errors)
//   errors: [{ row, message }],
//   createdCategories: string[]  // any category names auto-created during import
// }
//
// Behavior:
//   - Validates each row independently (partial success — the whole file
//     doesn't fail because one row is bad).
//   - Auto-creates categories that don't exist yet (matched case-insensitive
//     against existing category names).
//   - SKUs that clash with an existing product (or another row in the same
//     file) are rejected with a clear message.
//   - Ignores images entirely — bulk import is for the core catalog; images
//     are edited per-product in the UI after.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";

interface RawRow {
  [key: string]: string | number | boolean | null | undefined;
}

interface RowError {
  row: number; // 1-based, matches what a spreadsheet user sees
  message: string;
}

const MAX_ROWS = 1000;

// Truthy string → boolean. Excel exports "TRUE"/"FALSE"; humans type "yes"/"y"/"1".
function parseBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1";
}

// Parse number; return null for empty/blank, undefined for unparseable
// (so callers can distinguish "not provided" from "invalid").
function parseNumber(v: unknown): number | null | undefined {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s.replace(/[$,\s]/g, "")); // tolerate "$85.00", "1,200"
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const rows: RawRow[] = Array.isArray(body.rows) ? body.rows : [];

    if (!rows.length) {
      return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Bulk import is capped at ${MAX_ROWS} rows per file. Split into multiple imports.` },
        { status: 400 }
      );
    }

    const errors: RowError[] = [];

    // Pre-load existing SKUs + categories so we don't do N+1 lookups mid-loop.
    // Case-insensitive category matching happens in JS (Postgres would need
    // citext); the DB unique constraint is case-sensitive, so we normalize
    // to whatever casing the supplier already has.
    const [existingProducts, existingCategories] = await Promise.all([
      prisma.supplierProduct.findMany({
        where: { supplierTenantId: auth.tenant.id, sku: { not: null } },
        select: { sku: true },
      }),
      prisma.supplierProductCategory.findMany({
        where: { supplierTenantId: auth.tenant.id },
        select: { id: true, name: true },
      }),
    ]);
    const existingSkus = new Set(
      existingProducts.map((p) => (p.sku || "").toLowerCase())
    );
    const categoryByLower = new Map<string, { id: string; name: string }>();
    for (const c of existingCategories) {
      categoryByLower.set(c.name.toLowerCase(), c);
    }

    // Track SKUs seen within THIS file so we catch intra-file dupes even
    // before they hit the DB.
    const skusInFile = new Set<string>();
    // Track category names we need to auto-create — only insert each once,
    // even if 50 rows reference the same new category.
    const newCategoryNames = new Set<string>();

    // -----------------------------------------------------------------------
    // Pass 1: validate + normalize every row into a "ready to insert" shape.
    // -----------------------------------------------------------------------
    interface PreparedRow {
      rowIndex: number; // 1-based, for error messages
      data: {
        name: string;
        sku: string | null;
        barcode: string | null;
        description: string | null;
        unitLabel: string;
        wholesalePriceCents: number;
        retailPriceCents: number | null;
        minOrderQty: number;
        stepQty: number;
        trackInventory: boolean;
        stockLevel: number | null;
        lowStockThreshold: number | null;
        leadTimeDays: number | null;
        isPublic: boolean;
        // Category resolution deferred to pass 2 (after we've created any
        // missing categories); we just remember the requested name here.
        categoryName: string | null;
      };
    }

    const prepared: PreparedRow[] = [];

    rows.forEach((raw, idx) => {
      // rowIndex is 1-based AND account for the header row (idx 0 in the
      // parsed array is the first DATA row = spreadsheet row 2).
      const rowIndex = idx + 2;

      const name = String(raw.name || "").trim();
      if (!name) {
        errors.push({ row: rowIndex, message: "Missing product name" });
        return;
      }

      const wholesale = parseNumber(raw.wholesale_price);
      if (wholesale === undefined) {
        errors.push({ row: rowIndex, message: "Wholesale price is not a valid number" });
        return;
      }
      if (wholesale == null || wholesale < 0) {
        errors.push({ row: rowIndex, message: "Wholesale price is required and must be ≥ 0" });
        return;
      }

      const sku = String(raw.sku || "").trim() || null;
      if (sku) {
        const skuLower = sku.toLowerCase();
        if (existingSkus.has(skuLower)) {
          errors.push({ row: rowIndex, message: `SKU "${sku}" already exists in your catalog` });
          return;
        }
        if (skusInFile.has(skuLower)) {
          errors.push({ row: rowIndex, message: `SKU "${sku}" appears more than once in this file` });
          return;
        }
        skusInFile.add(skuLower);
      }

      const retail = parseNumber(raw.retail_price);
      if (retail === undefined) {
        errors.push({ row: rowIndex, message: "Retail price is not a valid number (leave blank if not applicable)" });
        return;
      }

      // Order-rule fields default to 1 if blank; anything invalid errors.
      const minQtyRaw = parseNumber(raw.min_order_qty);
      if (minQtyRaw === undefined) {
        errors.push({ row: rowIndex, message: "min_order_qty is not a valid number" });
        return;
      }
      const minQty = Math.max(1, Math.round(minQtyRaw ?? 1));

      const stepQtyRaw = parseNumber(raw.step_qty);
      if (stepQtyRaw === undefined) {
        errors.push({ row: rowIndex, message: "step_qty is not a valid number" });
        return;
      }
      const stepQty = Math.max(1, Math.round(stepQtyRaw ?? 1));

      const leadRaw = parseNumber(raw.lead_time_days);
      if (leadRaw === undefined) {
        errors.push({ row: rowIndex, message: "lead_time_days is not a valid number" });
        return;
      }

      const trackInventory = parseBool(raw.track_inventory);

      const stockRaw = parseNumber(raw.stock_level);
      if (stockRaw === undefined) {
        errors.push({ row: rowIndex, message: "stock_level is not a valid number" });
        return;
      }
      const lowRaw = parseNumber(raw.low_stock_threshold);
      if (lowRaw === undefined) {
        errors.push({ row: rowIndex, message: "low_stock_threshold is not a valid number" });
        return;
      }

      const categoryName = String(raw.category || "").trim() || null;
      // Queue up category creation if it's new. We normalize by lowercase
      // key but preserve original casing for the row that first mentioned it.
      if (categoryName && !categoryByLower.has(categoryName.toLowerCase())) {
        newCategoryNames.add(categoryName);
      }

      prepared.push({
        rowIndex,
        data: {
          name,
          sku,
          barcode: String(raw.barcode || "").trim() || null,
          description: String(raw.description || "").trim() || null,
          unitLabel: String(raw.unit_label || "").trim() || "unit",
          wholesalePriceCents: Math.round(wholesale * 100),
          retailPriceCents: retail == null ? null : Math.round(retail * 100),
          minOrderQty: minQty,
          stepQty: stepQty,
          trackInventory,
          stockLevel: trackInventory && stockRaw != null ? Math.round(stockRaw) : null,
          lowStockThreshold:
            trackInventory && lowRaw != null ? Math.round(lowRaw) : null,
          leadTimeDays: leadRaw == null ? null : Math.round(leadRaw),
          isPublic: parseBool(raw.is_public),
          categoryName,
        },
      });
    });

    // -----------------------------------------------------------------------
    // Pass 2: create any missing categories, then insert all products in a
    // single transaction so if the DB blows up mid-import we don't leave a
    // half-imported catalog.
    // -----------------------------------------------------------------------
    const createdCategories: string[] = [];

    const result = await prisma.$transaction(async (tx) => {
      // Create new categories one at a time — createMany + returning isn't
      // supported on Postgres in Prisma <6, and the volume is tiny (usually
      // <10 categories). Ignore duplicate errors: another parallel import
      // could theoretically race us, and we'd rather succeed on all rows
      // than fail one because the category-creation lost a race.
      for (const name of newCategoryNames) {
        try {
          const c = await tx.supplierProductCategory.create({
            data: { supplierTenantId: auth.tenant.id, name },
          });
          categoryByLower.set(name.toLowerCase(), { id: c.id, name: c.name });
          createdCategories.push(c.name);
        } catch {
          // Likely a UNIQUE(name) collision — re-read the row that beat us.
          const c = await tx.supplierProductCategory.findFirst({
            where: { supplierTenantId: auth.tenant.id, name },
          });
          if (c) categoryByLower.set(name.toLowerCase(), { id: c.id, name: c.name });
        }
      }

      // Bulk insert products.
      const productsToCreate = prepared.map((p) => {
        const catId = p.data.categoryName
          ? categoryByLower.get(p.data.categoryName.toLowerCase())?.id ?? null
          : null;
        // Strip categoryName from the payload — it's not a schema field.
        const { categoryName: _drop, ...productFields } = p.data;
        return {
          supplierTenantId: auth.tenant.id,
          categoryId: catId,
          ...productFields,
        };
      });

      if (productsToCreate.length === 0) return { count: 0 };
      const createResult = await tx.supplierProduct.createMany({
        data: productsToCreate,
      });
      return createResult;
    });

    return NextResponse.json({
      success: true,
      imported: result.count,
      skipped: errors.length,
      errors,
      createdCategories,
    });
  } catch (error: any) {
    console.error("[SUPPLIER-IMPORT] error:", error);
    return NextResponse.json({ error: "Failed to import products" }, { status: 500 });
  }
}
