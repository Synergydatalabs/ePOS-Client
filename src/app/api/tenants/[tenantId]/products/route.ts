// POST /api/tenants/[tenantId]/products - Create product
// GET /api/tenants/[tenantId]/products - List products

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Create product
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const {
      categoryId,
      name,
      description,
      sku,
      barcode,
      taxCategoryId,
      basePrice, // in cents
      costPrice, // in cents
      labourCost, // in cents
      imageUrl,
      sortOrder,
      isActive = true,
      isAvailable = true,
      trackInventory = false,
      prepTimeMinutes,
      durationMinutes,
      requiresTechnician,
      variants,
      modifierGroupIds,
      allergenIds,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Product name is required" },
        { status: 400 }
      );
    }

    if (basePrice === undefined || basePrice < 0) {
      return NextResponse.json(
        { error: "Valid base price is required" },
        { status: 400 }
      );
    }

    // Validate category if provided
    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, tenantId },
      });
      if (!category) {
        return NextResponse.json(
          { error: "Category not found" },
          { status: 404 }
        );
      }
    }

    // Check for duplicate SKU
    if (sku) {
      const existingSku = await prisma.product.findFirst({
        where: { tenantId, sku },
      });
      if (existingSku) {
        return NextResponse.json(
          { error: "Product with this SKU already exists" },
          { status: 409 }
        );
      }
    }

    // Get max sort order
    let finalSortOrder = sortOrder;
    if (finalSortOrder === undefined) {
      const maxSort = await prisma.product.aggregate({
        where: { tenantId, categoryId: categoryId || null },
        _max: { sortOrder: true },
      });
      finalSortOrder = (maxSort._max.sortOrder || 0) + 1;
    }

    // Create product with related data
    const product = await prisma.product.create({
      data: {
        tenantId,
        categoryId: categoryId || null,
        name: name.trim(),
        description: description?.trim() || null,
        sku: sku?.trim() || null,
        barcode: barcode?.trim() || null,
        taxCategoryId: taxCategoryId || null,
        basePrice: Math.round(basePrice),
        costPrice: costPrice !== undefined ? Math.round(costPrice) : 0,
        labourCost: labourCost !== undefined ? Math.round(labourCost) : 0,
        imageUrl: imageUrl?.trim() || null,
        sortOrder: finalSortOrder,
        isActive,
        isAvailable,
        trackInventory,
        prepTimeMinutes: prepTimeMinutes || null,
        durationMinutes: durationMinutes != null ? Math.round(durationMinutes) : null,
        requiresTechnician: requiresTechnician ?? false,
        // Create variants if provided
        variants: variants?.length
          ? {
              create: variants.map((v: any, idx: number) => ({
                name: v.name,
                priceAdjustment: v.priceAdjustment || 0,
                costAdjustment: v.costAdjustment || 0,
                sortOrder: v.sortOrder ?? idx,
                isActive: v.isActive ?? true,
              })),
            }
          : undefined,
        // Link modifier groups
        productModifierGroups: modifierGroupIds?.length
          ? {
              create: modifierGroupIds.map((groupId: string, idx: number) => ({
                modifierGroupId: groupId,
                sortOrder: idx,
              })),
            }
          : undefined,
        // Link allergens
        productAllergens: allergenIds?.length
          ? {
              create: allergenIds.map((allergenId: string) => ({
                allergenId,
                isFromRecipe: false,
              })),
            }
          : undefined,
      },
      include: {
        category: { select: { id: true, name: true } },
        variants: true,
        productModifierGroups: {
          include: {
            modifierGroup: {
              include: { modifiers: true },
            },
          },
        },
        productAllergens: {
          include: { allergen: true },
        },
      },
    });

    console.log(`[TAP API] Created product: ${product.name} for tenant: ${tenantId}`);

    return NextResponse.json({
      success: true,
      product,
    });
  } catch (error: any) {
    console.error("[TAP API] Create product error:", error);
    return NextResponse.json(
      { error: "Failed to create product" },
      { status: 500 }
    );
  }
}

// GET - List products
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId");
    const search = searchParams.get("search");
    const includeInactive = searchParams.get("includeInactive") === "true";
    const includeUnavailable = searchParams.get("includeUnavailable") === "true";
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: any = { tenantId };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (!includeInactive) {
      where.isActive = true;
    }

    if (!includeUnavailable) {
      where.isAvailable = true;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          taxCategory: { select: { id: true, name: true, ratePercent: true } },
          variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
          productModifierGroups: {
            orderBy: { sortOrder: "asc" },
            include: {
              modifierGroup: {
                include: {
                  modifiers: {
                    where: { isActive: true },
                    orderBy: { sortOrder: "asc" },
                  },
                },
              },
            },
          },
          productAllergens: {
            include: { allergen: true },
          },
        },
        orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
        take: limit,
        skip: offset,
      }),
      prisma.product.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      products,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + products.length < total,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] List products error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
