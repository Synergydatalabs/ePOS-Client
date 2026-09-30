// ============================================================================
// POST /api/tenants/[tenantId]/menu/bulk-upload
//
// Bulk-creates products from a parsed CSV. Categories are auto-created if
// they don't exist. Image URLs are attached if provided.
//
// Request body:
//   {
//     rows: [
//       { name, category, priceCents, sku?, description?, costCents?,
//         prepTimeMinutes?, imageUrl?, isActive, sortOrder? },
//       ...
//     ],
//     dryRun?: boolean       // true = validate only, don't write
//   }
//
// Response:
//   {
//     success: boolean,
//     created: number,
//     skipped: number,
//     categoriesCreated: string[],
//     errors: [{ rowIndex, name, reason }]
//   }
//
// Idempotency: rows with an existing SKU in this tenant are SKIPPED (not
// updated). To update, delete first or use the regular product PUT endpoint.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const rowSchema = z.object({
  rowNumber: z.number().int().positive().optional(),
  name: z.string().min(1).max(255),
  category: z.string().min(1).max(100),
  priceCents: z.number().int().nonnegative(),
  sku: z.string().max(50).optional(),
  description: z.string().optional(),
  costCents: z.number().int().nonnegative().optional(),
  prepTimeMinutes: z.number().int().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(1000),
  dryRun: z.boolean().optional().default(false),
});

interface RowError {
  rowIndex: number;
  rowNumber?: number;
  name: string;
  reason: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { rows, dryRun } = parsed.data;

    // 1. Resolve categories: load existing, build map
    const inputCategoryNames = Array.from(
      new Set(rows.map((r) => r.category.trim()))
    );

    const existingCategories = await prisma.category.findMany({
      where: { tenantId, name: { in: inputCategoryNames } },
      select: { id: true, name: true },
    });

    const categoryMap = new Map<string, string>(
      existingCategories.map((c) => [c.name, c.id])
    );

    const categoriesToCreate = inputCategoryNames.filter(
      (n) => !categoryMap.has(n)
    );

    // 2. Find existing SKUs to detect duplicates
    const inputSkus = rows
      .map((r) => r.sku?.trim())
      .filter((s): s is string => !!s);

    const existingSkus =
      inputSkus.length > 0
        ? await prisma.product.findMany({
            where: { tenantId, sku: { in: inputSkus } },
            select: { sku: true },
          })
        : [];

    const existingSkuSet = new Set(
      existingSkus.map((p) => p.sku).filter((s): s is string => !!s)
    );

    // 3. Validate each row against DB state
    const errors: RowError[] = [];
    const validRows: typeof rows = [];

    rows.forEach((r, idx) => {
      const sku = r.sku?.trim();
      if (sku && existingSkuSet.has(sku)) {
        errors.push({
          rowIndex: idx,
          rowNumber: r.rowNumber,
          name: r.name,
          reason: `SKU "${sku}" already exists — skipped`,
        });
        return;
      }
      validRows.push(r);
    });

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        wouldCreate: validRows.length,
        wouldSkip: errors.length,
        wouldCreateCategories: categoriesToCreate,
        errors,
      });
    }

    // 4. Real write — single transaction
    const result = await prisma.$transaction(
      async (tx) => {
        // 4a. Create missing categories
        if (categoriesToCreate.length > 0) {
          // Find max sortOrder to append properly
          const maxSort = await tx.category.aggregate({
            where: { tenantId },
            _max: { sortOrder: true },
          });
          const startOrder = (maxSort._max.sortOrder ?? 0) + 1;

          const created = await Promise.all(
            categoriesToCreate.map((name, i) =>
              tx.category.create({
                data: {
                  tenantId,
                  name,
                  sortOrder: startOrder + i,
                  isActive: true,
                },
                select: { id: true, name: true },
              })
            )
          );

          for (const c of created) categoryMap.set(c.name, c.id);
        }

        // 4b. Create products
        const products = await Promise.all(
          validRows.map((r) => {
            const categoryId = categoryMap.get(r.category.trim());
            if (!categoryId) {
              throw new Error(
                `Category map miss for "${r.category}" — this should not happen`
              );
            }

            return tx.product.create({
              data: {
                tenantId,
                categoryId,
                name: r.name.trim(),
                description: r.description?.trim() || null,
                sku: r.sku?.trim() || null,
                basePrice: r.priceCents,
                costPrice: r.costCents ?? 0,
                imageUrl: r.imageUrl ?? null,
                prepTimeMinutes: r.prepTimeMinutes ?? 0,
                sortOrder: r.sortOrder ?? 0,
                isActive: r.isActive,
                isAvailable: true,
              },
              select: { id: true, name: true },
            });
          })
        );

        return {
          createdCount: products.length,
          createdCategoryNames: categoriesToCreate,
        };
      },
      {
        // bulk inserts can take a bit; default timeout is 5s
        timeout: 30_000,
      }
    );

    return NextResponse.json({
      success: true,
      created: result.createdCount,
      skipped: errors.length,
      categoriesCreated: result.createdCategoryNames,
      errors,
    });
  } catch (err: any) {
    console.error("[menu/bulk-upload] error:", err);
    return NextResponse.json(
      { error: err?.message || "Bulk upload failed" },
      { status: 500 }
    );
  }
}
