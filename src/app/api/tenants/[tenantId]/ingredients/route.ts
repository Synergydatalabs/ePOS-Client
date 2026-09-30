// POST /api/tenants/[tenantId]/ingredients - Create ingredient
// GET /api/tenants/[tenantId]/ingredients - List ingredients

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Create ingredient
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
      name,
      description,
      sku,
      unitId,
      costPerUnit, // in cents
      lowStockThreshold,
      supplierId,
      supplierSku,
      allergenIds = [],
      // Phase D #77 — marketplace auto-reorder fields (all optional on create)
      autoReorderEnabled,
      reorderQty,
      preferredSupplierTenantId,
      preferredSupplierProductId,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Ingredient name is required" },
        { status: 400 }
      );
    }

    if (!unitId) {
      return NextResponse.json(
        { error: "Unit of measure is required" },
        { status: 400 }
      );
    }

    // Validate unit belongs to tenant or is global
    const unit = await prisma.unitOfMeasure.findFirst({
      where: {
        id: unitId,
        OR: [{ tenantId }, { tenantId: null }],
      },
    });

    if (!unit) {
      return NextResponse.json(
        { error: "Unit of measure not found" },
        { status: 404 }
      );
    }

    // Check for duplicate SKU
    if (sku) {
      const existing = await prisma.ingredient.findFirst({
        where: { tenantId, sku },
      });
      if (existing) {
        return NextResponse.json(
          { error: "Ingredient with this SKU already exists" },
          { status: 409 }
        );
      }
    }

    // Validate supplier if provided
    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: supplierId, tenantId },
      });
      if (!supplier) {
        return NextResponse.json(
          { error: "Supplier not found" },
          { status: 404 }
        );
      }
    }

    const ingredient = await prisma.ingredient.create({
      data: {
        tenantId,
        name: name.trim(),
        description: description?.trim() || null,
        sku: sku?.trim() || null,
        unitId,
        costPerUnit: costPerUnit !== undefined ? Math.round(costPerUnit) : 0,
        lowStockThreshold: lowStockThreshold || null,
        supplierId: supplierId || null,
        supplierSku: supplierSku?.trim() || null,
        autoReorderEnabled: !!autoReorderEnabled,
        reorderQty:
          reorderQty === null || reorderQty === "" || reorderQty === undefined
            ? null
            : Number(reorderQty),
        preferredSupplierTenantId: preferredSupplierTenantId || null,
        preferredSupplierProductId: preferredSupplierProductId || null,
        allergens: allergenIds.length
          ? {
              create: allergenIds.map((allergenId: string) => ({
                allergenId,
              })),
            }
          : undefined,
      },
      include: {
        unit: true,
        supplier: { select: { id: true, name: true } },
        allergens: {
          include: { allergen: true },
        },
      },
    });

    console.log(`[TAP API] Created ingredient: ${ingredient.name}`);

    return NextResponse.json({
      success: true,
      ingredient,
    });
  } catch (error: any) {
    console.error("[TAP API] Create ingredient error:", error);
    return NextResponse.json(
      { error: "Failed to create ingredient" },
      { status: 500 }
    );
  }
}

// GET - List ingredients
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const supplierId = searchParams.get("supplierId");
    const lowStockOnly = searchParams.get("lowStockOnly") === "true";
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: any = { tenantId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
      ];
    }

    if (supplierId) {
      where.supplierId = supplierId;
    }

    // Get ingredients with current stock for low stock filter
    const ingredients = await prisma.ingredient.findMany({
      where,
      include: {
        unit: true,
        supplier: { select: { id: true, name: true } },
        allergens: {
          include: { allergen: true },
        },
        locationInventory: {
          include: {
            location: { select: { id: true, name: true } },
          },
        },
        _count: { select: { recipes: true } },
      },
      orderBy: { name: "asc" },
      take: limit,
      skip: offset,
    });

    // Calculate total stock and filter if needed
    let result = ingredients.map((ing) => {
      const totalStock = ing.locationInventory.reduce(
        (sum, inv) => sum + inv.currentStock,
        0
      );
      const isLowStock = ing.lowStockThreshold
        ? totalStock <= ing.lowStockThreshold
        : false;
      return {
        ...ing,
        totalStock,
        isLowStock,
      };
    });

    if (lowStockOnly) {
      result = result.filter((ing) => ing.isLowStock);
    }

    const total = await prisma.ingredient.count({ where });

    return NextResponse.json({
      success: true,
      ingredients: result,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + ingredients.length < total,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] List ingredients error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
