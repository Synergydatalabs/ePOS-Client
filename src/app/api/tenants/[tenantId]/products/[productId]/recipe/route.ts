// PUT /api/tenants/[tenantId]/products/[productId]/recipe - Update product recipe
// GET /api/tenants/[tenantId]/products/[productId]/recipe - Get product recipe

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get product recipe
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; productId: string }> }
) {
  try {
    const { tenantId, productId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: {
        id: true,
        name: true,
        costPrice: true,
        labourCost: true,
        recipes: {
          include: {
            ingredient: {
              include: {
                unit: true,
                allergens: { include: { allergen: true } },
              },
            },
            unit: true,
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // Calculate recipe cost
    let recipeCost = 0;
    const recipeItems = product.recipes.map((recipe) => {
      const itemCost = recipe.ingredient.costPerUnit * recipe.quantity;
      recipeCost += itemCost;
      return {
        ingredientId: recipe.ingredientId,
        ingredientName: recipe.ingredient.name,
        quantity: recipe.quantity,
        unit: recipe.unit,
        costPerUnit: recipe.ingredient.costPerUnit,
        itemCost: Math.round(itemCost),
        allergens: recipe.ingredient.allergens.map((ia) => ia.allergen),
      };
    });

    return NextResponse.json({
      success: true,
      recipe: {
        productId: product.id,
        productName: product.name,
        items: recipeItems,
        recipeCost: Math.round(recipeCost),
        manualCostPrice: product.costPrice,
        labourCost: product.labourCost,
        totalCost: product.costPrice + product.labourCost + Math.round(recipeCost),
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get recipe error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update product recipe (full replacement)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; productId: string }> }
) {
  try {
    const { tenantId, productId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { items } = body; // Array of { ingredientId, quantity, unitId? }

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // Validate all ingredients exist
    if (items && items.length > 0) {
      const ingredientIds = items.map((i: any) => i.ingredientId);
      const ingredients = await prisma.ingredient.findMany({
        where: { id: { in: ingredientIds }, tenantId },
      });

      if (ingredients.length !== ingredientIds.length) {
        return NextResponse.json(
          { error: "One or more ingredients not found" },
          { status: 404 }
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Delete existing recipe
      await tx.recipe.deleteMany({
        where: { productId },
      });

      // Create new recipe items
      if (items && items.length > 0) {
        for (const item of items) {
          // Get ingredient to use its unit if not specified
          const ingredient = await tx.ingredient.findUnique({
            where: { id: item.ingredientId },
          });

          await tx.recipe.create({
            data: {
              productId,
              ingredientId: item.ingredientId,
              quantity: item.quantity,
              unitId: item.unitId || ingredient!.unitId,
            },
          });
        }
      }

      // Update product allergens from recipe
      // First, remove recipe-derived allergens
      await tx.productAllergen.deleteMany({
        where: { productId, isFromRecipe: true },
      });

      // Get all allergens from recipe ingredients
      if (items && items.length > 0) {
        const ingredientAllergens = await tx.ingredientAllergen.findMany({
          where: {
            ingredientId: { in: items.map((i: any) => i.ingredientId) },
          },
          select: { allergenId: true },
        });

        const uniqueAllergenIds = [...new Set(ingredientAllergens.map((ia) => ia.allergenId))];

        // Add recipe-derived allergens
        if (uniqueAllergenIds.length > 0) {
          await tx.productAllergen.createMany({
            data: uniqueAllergenIds.map((allergenId) => ({
              productId,
              allergenId,
              isFromRecipe: true,
            })),
            skipDuplicates: true,
          });
        }
      }

      // Return updated recipe
      return tx.product.findUnique({
        where: { id: productId },
        include: {
          recipes: {
            include: {
              ingredient: {
                include: {
                  unit: true,
                  allergens: { include: { allergen: true } },
                },
              },
              unit: true,
            },
          },
          productAllergens: {
            include: { allergen: true },
          },
        },
      });
    });

    // Calculate recipe cost
    let recipeCost = 0;
    const recipeItems = result!.recipes.map((recipe) => {
      const itemCost = recipe.ingredient.costPerUnit * recipe.quantity;
      recipeCost += itemCost;
      return {
        ingredientId: recipe.ingredientId,
        ingredientName: recipe.ingredient.name,
        quantity: recipe.quantity,
        unit: recipe.unit,
        costPerUnit: recipe.ingredient.costPerUnit,
        itemCost: Math.round(itemCost),
      };
    });

    console.log(`[TAP API] Updated recipe for product: ${product.name}`);

    return NextResponse.json({
      success: true,
      recipe: {
        productId: result!.id,
        productName: result!.name,
        items: recipeItems,
        recipeCost: Math.round(recipeCost),
        totalCost: result!.costPrice + result!.labourCost + Math.round(recipeCost),
      },
      productAllergens: result!.productAllergens,
    });
  } catch (error: any) {
    console.error("[TAP API] Update recipe error:", error);
    return NextResponse.json(
      { error: "Failed to update recipe" },
      { status: 500 }
    );
  }
}
