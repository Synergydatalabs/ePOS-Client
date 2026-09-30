// GET /api/tenants/[tenantId]/categories/[categoryId] - Get category
// PUT /api/tenants/[tenantId]/categories/[categoryId] - Update category
// DELETE /api/tenants/[tenantId]/categories/[categoryId] - Delete category

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get single category
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; categoryId: string }> }
) {
  try {
    const { tenantId, categoryId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        tenantId,
      },
      include: {
        products: {
          orderBy: { sortOrder: "asc" },
          include: {
            variants: true,
            productAllergens: {
              include: { allergen: true },
            },
          },
        },
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      category,
    });
  } catch (error: any) {
    console.error("[TAP API] Get category error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update category
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; categoryId: string }> }
) {
  try {
    const { tenantId, categoryId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { name, description, imageUrl, sortOrder, isActive } = body;

    // Check category exists
    const existing = await prisma.category.findFirst({
      where: {
        id: categoryId,
        tenantId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      );
    }

    // Check for duplicate name
    if (name && name.trim() !== existing.name) {
      const duplicate = await prisma.category.findFirst({
        where: {
          tenantId,
          name: name.trim(),
          id: { not: categoryId },
        },
      });

      if (duplicate) {
        return NextResponse.json(
          { error: "Category with this name already exists" },
          { status: 409 }
        );
      }
    }

    const category = await prisma.category.update({
      where: { id: categoryId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(imageUrl !== undefined && { imageUrl: imageUrl?.trim() || null }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    console.log(`[TAP API] Updated category: ${category.name}`);

    return NextResponse.json({
      success: true,
      category,
    });
  } catch (error: any) {
    console.error("[TAP API] Update category error:", error);
    return NextResponse.json(
      { error: "Failed to update category" },
      { status: 500 }
    );
  }
}

// DELETE - Delete category (soft delete by marking inactive, or hard delete if no products)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; categoryId: string }> }
) {
  try {
    const { tenantId, categoryId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        tenantId,
      },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!category) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 }
      );
    }

    // If has products, soft delete
    if (category._count.products > 0) {
      await prisma.category.update({
        where: { id: categoryId },
        data: { isActive: false },
      });

      return NextResponse.json({
        success: true,
        message: "Category deactivated (has products)",
        softDeleted: true,
      });
    }

    // Hard delete if no products
    await prisma.category.delete({
      where: { id: categoryId },
    });

    console.log(`[TAP API] Deleted category: ${category.name}`);

    return NextResponse.json({
      success: true,
      message: "Category deleted",
      softDeleted: false,
    });
  } catch (error: any) {
    console.error("[TAP API] Delete category error:", error);
    return NextResponse.json(
      { error: "Failed to delete category" },
      { status: 500 }
    );
  }
}
