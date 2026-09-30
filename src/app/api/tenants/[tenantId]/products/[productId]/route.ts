// GET /api/tenants/[tenantId]/products/[productId] - Get product
// PUT /api/tenants/[tenantId]/products/[productId] - Update product
// DELETE /api/tenants/[tenantId]/products/[productId] - Delete product

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get single product with full details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; productId: string }> }
) {
  try {
    const { tenantId, productId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
      },
      include: {
        category: { select: { id: true, name: true } },
        variants: { orderBy: { sortOrder: "asc" } },
        productModifierGroups: {
          orderBy: { sortOrder: "asc" },
          include: {
            modifierGroup: {
              include: {
                modifiers: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        },
        productAllergens: {
          include: { allergen: true },
        },
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
        stationProducts: {
          include: { station: true },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // Calculate total cost from recipe
    let recipeCost = 0;
    if (product.recipes.length > 0) {
      for (const recipe of product.recipes) {
        recipeCost += (recipe.ingredient.costPerUnit * recipe.quantity);
      }
    }

    return NextResponse.json({
      success: true,
      product: {
        ...product,
        calculatedRecipeCost: Math.round(recipeCost),
        totalCost: product.costPrice + product.labourCost + Math.round(recipeCost),
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get product error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update product
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
    const {
      categoryId,
      name,
      description,
      sku,
      barcode,
      taxCategoryId,
      basePrice,
      costPrice,
      labourCost,
      imageUrl,
      sortOrder,
      isActive,
      isAvailable,
      trackInventory,
      prepTimeMinutes,
      durationMinutes,
      requiresTechnician,
      variants,
      modifierGroupIds,
      allergenIds,
    } = body;

    // Check product exists
    const existing = await prisma.product.findFirst({
      where: { id: productId, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // Validate category if provided
    if (categoryId !== undefined && categoryId !== null) {
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
    if (sku && sku !== existing.sku) {
      const existingSku = await prisma.product.findFirst({
        where: { tenantId, sku, id: { not: productId } },
      });
      if (existingSku) {
        return NextResponse.json(
          { error: "Product with this SKU already exists" },
          { status: 409 }
        );
      }
    }

    // Update in transaction
    const product = await prisma.$transaction(async (tx) => {
      // Update variants if provided
      if (variants !== undefined) {
        // Delete existing variants
        await tx.productVariant.deleteMany({
          where: { productId },
        });

        // Create new variants
        if (variants.length > 0) {
          await tx.productVariant.createMany({
            data: variants.map((v: any, idx: number) => ({
              productId,
              name: v.name,
              priceAdjustment: v.priceAdjustment || 0,
              costAdjustment: v.costAdjustment || 0,
              sortOrder: v.sortOrder ?? idx,
              isActive: v.isActive ?? true,
            })),
          });
        }
      }

      // Update modifier group links if provided
      if (modifierGroupIds !== undefined) {
        await tx.productModifierGroup.deleteMany({
          where: { productId },
        });

        if (modifierGroupIds.length > 0) {
          await tx.productModifierGroup.createMany({
            data: modifierGroupIds.map((groupId: string, idx: number) => ({
              productId,
              modifierGroupId: groupId,
              sortOrder: idx,
            })),
          });
        }
      }

      // Update allergen links if provided (only manual ones, not recipe-derived)
      if (allergenIds !== undefined) {
        await tx.productAllergen.deleteMany({
          where: { productId, isFromRecipe: false },
        });

        if (allergenIds.length > 0) {
          await tx.productAllergen.createMany({
            data: allergenIds.map((allergenId: string) => ({
              productId,
              allergenId,
              isFromRecipe: false,
            })),
          });
        }
      }

      // Update product
      return tx.product.update({
        where: { id: productId },
        data: {
          ...(categoryId !== undefined && { categoryId: categoryId || null }),
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description?.trim() || null }),
          ...(sku !== undefined && { sku: sku?.trim() || null }),
          ...(barcode !== undefined && { barcode: barcode?.trim() || null }),
          ...(taxCategoryId !== undefined && { taxCategoryId: taxCategoryId || null }),
          ...(basePrice !== undefined && { basePrice: Math.round(basePrice) }),
          ...(costPrice !== undefined && { costPrice: Math.round(costPrice) }),
          ...(labourCost !== undefined && { labourCost: Math.round(labourCost) }),
          ...(imageUrl !== undefined && { imageUrl: imageUrl?.trim() || null }),
          ...(sortOrder !== undefined && { sortOrder }),
          ...(isActive !== undefined && { isActive }),
          ...(isAvailable !== undefined && { isAvailable }),
          ...(trackInventory !== undefined && { trackInventory }),
          ...(prepTimeMinutes !== undefined && { prepTimeMinutes: prepTimeMinutes || null }),
          ...(durationMinutes !== undefined && { durationMinutes: durationMinutes != null ? Math.round(durationMinutes) : null }),
          ...(requiresTechnician !== undefined && { requiresTechnician }),
        },
        include: {
          category: { select: { id: true, name: true } },
          variants: { orderBy: { sortOrder: "asc" } },
          productModifierGroups: {
            orderBy: { sortOrder: "asc" },
            include: {
              modifierGroup: {
                include: { modifiers: { orderBy: { sortOrder: "asc" } } },
              },
            },
          },
          productAllergens: {
            include: { allergen: true },
          },
        },
      });
    });

    console.log(`[TAP API] Updated product: ${product.name}`);

    return NextResponse.json({
      success: true,
      product,
    });
  } catch (error: any) {
    console.error("[TAP API] Update product error:", error);
    return NextResponse.json(
      { error: "Failed to update product" },
      { status: 500 }
    );
  }
}

// DELETE - Delete product
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; productId: string }> }
) {
  try {
    const { tenantId, productId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: {
        _count: {
          select: { orderItems: true },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // If has orders, soft delete
    if (product._count.orderItems > 0) {
      await prisma.product.update({
        where: { id: productId },
        data: { isActive: false, isAvailable: false },
      });

      return NextResponse.json({
        success: true,
        message: "Product deactivated (has order history)",
        softDeleted: true,
      });
    }

    // Hard delete if no orders - cascade handles variants, modifiers, allergens
    await prisma.$transaction(async (tx) => {
      await tx.productAllergen.deleteMany({ where: { productId } });
      await tx.productModifierGroup.deleteMany({ where: { productId } });
      await tx.productVariant.deleteMany({ where: { productId } });
      await tx.recipe.deleteMany({ where: { productId } });
      await tx.stationProduct.deleteMany({ where: { productId } });
      await tx.product.delete({ where: { id: productId } });
    });

    console.log(`[TAP API] Deleted product: ${product.name}`);

    return NextResponse.json({
      success: true,
      message: "Product deleted",
      softDeleted: false,
    });
  } catch (error: any) {
    console.error("[TAP API] Delete product error:", error);
    return NextResponse.json(
      { error: "Failed to delete product" },
      { status: 500 }
    );
  }
}
