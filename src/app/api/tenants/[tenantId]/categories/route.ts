// POST /api/tenants/[tenantId]/categories - Create category
// GET /api/tenants/[tenantId]/categories - List categories

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Create category
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Only admin+ can create categories
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { name, description, imageUrl, sortOrder, isActive = true } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Category name is required" },
        { status: 400 }
      );
    }

    // Check for duplicate name
    const existing = await prisma.category.findFirst({
      where: {
        tenantId,
        name: name.trim(),
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Category with this name already exists" },
        { status: 409 }
      );
    }

    // Get max sort order if not provided
    let finalSortOrder = sortOrder;
    if (finalSortOrder === undefined) {
      const maxSort = await prisma.category.aggregate({
        where: { tenantId },
        _max: { sortOrder: true },
      });
      finalSortOrder = (maxSort._max.sortOrder || 0) + 1;
    }

    const category = await prisma.category.create({
      data: {
        tenantId,
        name: name.trim(),
        description: description?.trim() || null,
        imageUrl: imageUrl?.trim() || null,
        sortOrder: finalSortOrder,
        isActive,
      },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    console.log(`[TAP API] Created category: ${category.name} for tenant: ${tenantId}`);

    return NextResponse.json({
      success: true,
      category,
    });
  } catch (error: any) {
    console.error("[TAP API] Create category error:", error);
    return NextResponse.json(
      { error: "Failed to create category" },
      { status: 500 }
    );
  }
}

// GET - List categories
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Staff can view categories
    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("includeInactive") === "true";
    const includeProducts = searchParams.get("includeProducts") === "true";

    const where: any = { tenantId };
    if (!includeInactive) {
      where.isActive = true;
    }

    const categories = await prisma.category.findMany({
      where,
      include: {
        products: includeProducts
          ? {
              where: { isActive: true },
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                name: true,
                basePrice: true,
                isAvailable: true,
                imageUrl: true,
              },
            }
          : false,
        _count: {
          select: { products: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({
      success: true,
      categories,
    });
  } catch (error: any) {
    console.error("[TAP API] List categories error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
