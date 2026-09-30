// GET /api/tenants/[tenantId]/ingredients/[ingredientId] - Get ingredient
// PUT /api/tenants/[tenantId]/ingredients/[ingredientId] - Update ingredient
// DELETE /api/tenants/[tenantId]/ingredients/[ingredientId] - Delete ingredient

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get single ingredient with full details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; ingredientId: string }> }
) {
  try {
    const { tenantId, ingredientId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const ingredient = await prisma.ingredient.findFirst({
      where: { id: ingredientId, tenantId },
      include: {
        unit: true,
        supplier: true,
        allergens: {
          include: { allergen: true },
        },
        locationInventory: {
          include: {
            location: { select: { id: true, name: true } },
            lastCountedByMember: { select: { firstName: true, lastName: true } },
          },
        },
        recipes: {
          include: {
            product: { select: { id: true, name: true, isActive: true } },
            unit: true,
          },
        },
        stockMovements: {
          take: 20,
          orderBy: { createdAt: "desc" },
          include: {
            location: { select: { id: true, name: true } },
            createdByMember: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    if (!ingredient) {
      return NextResponse.json(
        { error: "Ingredient not found" },
        { status: 404 }
      );
    }

    // Calculate totals
    const totalStock = ingredient.locationInventory.reduce(
      (sum, inv) => sum + inv.currentStock,
      0
    );
    const totalValue = totalStock * ingredient.costPerUnit;

    return NextResponse.json({
      success: true,
      ingredient: {
        ...ingredient,
        totalStock,
        totalValue,
        isLowStock: ingredient.lowStockThreshold
          ? totalStock <= ingredient.lowStockThreshold
          : false,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get ingredient error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update ingredient
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; ingredientId: string }> }
) {
  try {
    const { tenantId, ingredientId } = await params;

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
      costPerUnit,
      lowStockThreshold,
      supplierId,
      supplierSku,
      allergenIds,
      // Phase D #77 (2026-07-31): marketplace auto-reorder fields.
      autoReorderEnabled,
      reorderQty,
      preferredSupplierTenantId,
      preferredSupplierProductId,
    } = body;

    const existing = await prisma.ingredient.findFirst({
      where: { id: ingredientId, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Ingredient not found" },
        { status: 404 }
      );
    }

    // Check for duplicate SKU
    if (sku && sku !== existing.sku) {
      const duplicate = await prisma.ingredient.findFirst({
        where: { tenantId, sku, id: { not: ingredientId } },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "Ingredient with this SKU already exists" },
          { status: 409 }
        );
      }
    }

    // Validate unit if changing
    if (unitId && unitId !== existing.unitId) {
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
    }

    const ingredient = await prisma.$transaction(async (tx) => {
      // Update allergens if provided
      if (allergenIds !== undefined) {
        await tx.ingredientAllergen.deleteMany({
          where: { ingredientId },
        });

        if (allergenIds.length > 0) {
          await tx.ingredientAllergen.createMany({
            data: allergenIds.map((allergenId: string) => ({
              ingredientId,
              allergenId,
            })),
          });
        }

        // Update recipe-derived allergens on products
        const recipes = await tx.recipe.findMany({
          where: { ingredientId },
          select: { productId: true },
        });

        for (const recipe of recipes) {
          // Remove old recipe-derived allergens for this product
          await tx.productAllergen.deleteMany({
            where: { productId: recipe.productId, isFromRecipe: true },
          });

          // Get all allergens from all ingredients in this product's recipe
          const productRecipes = await tx.recipe.findMany({
            where: { productId: recipe.productId },
            include: {
              ingredient: {
                include: { allergens: true },
              },
            },
          });

          const recipeAllergenIds = new Set<string>();
          for (const pr of productRecipes) {
            for (const ia of pr.ingredient.allergens) {
              recipeAllergenIds.add(ia.allergenId);
            }
          }

          // Add recipe-derived allergens
          if (recipeAllergenIds.size > 0) {
            await tx.productAllergen.createMany({
              data: Array.from(recipeAllergenIds).map((aid) => ({
                productId: recipe.productId,
                allergenId: aid,
                isFromRecipe: true,
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      return tx.ingredient.update({
        where: { id: ingredientId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description?.trim() || null }),
          ...(sku !== undefined && { sku: sku?.trim() || null }),
          ...(unitId !== undefined && { unitId }),
          ...(costPerUnit !== undefined && { costPerUnit: Math.round(costPerUnit) }),
          ...(lowStockThreshold !== undefined && { lowStockThreshold: lowStockThreshold || null }),
          ...(supplierId !== undefined && { supplierId: supplierId || null }),
          ...(supplierSku !== undefined && { supplierSku: supplierSku?.trim() || null }),
          // Phase D #77: marketplace auto-reorder. All four saved together
          // so a partial payload can toggle without disturbing the others.
          ...(autoReorderEnabled !== undefined && { autoReorderEnabled: !!autoReorderEnabled }),
          ...(reorderQty !== undefined && {
            reorderQty:
              reorderQty === null || reorderQty === ""
                ? null
                : Number(reorderQty),
          }),
          ...(preferredSupplierTenantId !== undefined && {
            preferredSupplierTenantId: preferredSupplierTenantId || null,
          }),
          ...(preferredSupplierProductId !== undefined && {
            preferredSupplierProductId: preferredSupplierProductId || null,
          }),
        },
        include: {
          unit: true,
          supplier: { select: { id: true, name: true } },
          allergens: {
            include: { allergen: true },
          },
        },
      });
    });

    console.log(`[TAP API] Updated ingredient: ${ingredient.name}`);

    return NextResponse.json({
      success: true,
      ingredient,
    });
  } catch (error: any) {
    console.error("[TAP API] Update ingredient error:", error);
    return NextResponse.json(
      { error: "Failed to update ingredient" },
      { status: 500 }
    );
  }
}

// DELETE - Delete ingredient
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; ingredientId: string }> }
) {
  try {
    const { tenantId, ingredientId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const ingredient = await prisma.ingredient.findFirst({
      where: { id: ingredientId, tenantId },
      include: {
        _count: { select: { recipes: true, stockMovements: true } },
      },
    });

    if (!ingredient) {
      return NextResponse.json(
        { error: "Ingredient not found" },
        { status: 404 }
      );
    }

    // Check if used in recipes
    if (ingredient._count.recipes > 0) {
      return NextResponse.json(
        { error: "Cannot delete ingredient that is used in product recipes" },
        { status: 409 }
      );
    }

    // Delete related data and ingredient
    await prisma.$transaction(async (tx) => {
      await tx.ingredientAllergen.deleteMany({ where: { ingredientId } });
      await tx.locationInventory.deleteMany({ where: { ingredientId } });
      await tx.stockMovement.deleteMany({ where: { ingredientId } });
      await tx.ingredient.delete({ where: { id: ingredientId } });
    });

    console.log(`[TAP API] Deleted ingredient: ${ingredient.name}`);

    return NextResponse.json({
      success: true,
      message: "Ingredient deleted",
    });
  } catch (error: any) {
    console.error("[TAP API] Delete ingredient error:", error);
    return NextResponse.json(
      { error: "Failed to delete ingredient" },
      { status: 500 }
    );
  }
}
