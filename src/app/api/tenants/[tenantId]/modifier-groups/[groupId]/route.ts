// GET /api/tenants/[tenantId]/modifier-groups/[groupId] - Get modifier group
// PUT /api/tenants/[tenantId]/modifier-groups/[groupId] - Update modifier group
// DELETE /api/tenants/[tenantId]/modifier-groups/[groupId] - Delete modifier group

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get single modifier group
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; groupId: string }> }
) {
  try {
    const { tenantId, groupId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const modifierGroup = await prisma.modifierGroup.findFirst({
      where: { id: groupId, tenantId },
      include: {
        modifiers: { orderBy: { sortOrder: "asc" } },
        productModifierGroups: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!modifierGroup) {
      return NextResponse.json(
        { error: "Modifier group not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      modifierGroup,
    });
  } catch (error: any) {
    console.error("[TAP API] Get modifier group error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update modifier group
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; groupId: string }> }
) {
  try {
    const { tenantId, groupId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const {
      name,
      displayName,
      isRequired,
      minSelect,
      maxSelect,
      modifiers,
    } = body;

    const existing = await prisma.modifierGroup.findFirst({
      where: { id: groupId, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Modifier group not found" },
        { status: 404 }
      );
    }

    // Validate min/max if provided
    const finalMin = minSelect ?? existing.minSelect;
    const finalMax = maxSelect ?? existing.maxSelect;
    if (finalMin < 0 || finalMax < 1 || finalMin > finalMax) {
      return NextResponse.json(
        { error: "Invalid min/max selection values" },
        { status: 400 }
      );
    }

    const modifierGroup = await prisma.$transaction(async (tx) => {
      // Update modifiers if provided
      if (modifiers !== undefined) {
        // Delete existing modifiers
        await tx.modifier.deleteMany({
          where: { groupId },
        });

        // Create new modifiers
        if (modifiers.length > 0) {
          await tx.modifier.createMany({
            data: modifiers.map((m: any, idx: number) => ({
              groupId,
              name: m.name,
              price: m.price || 0,
              cost: m.cost || 0,
              sortOrder: m.sortOrder ?? idx,
              isDefault: m.isDefault ?? false,
              isActive: m.isActive ?? true,
            })),
          });
        }
      }

      return tx.modifierGroup.update({
        where: { id: groupId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(displayName !== undefined && { displayName: displayName?.trim() || name?.trim() }),
          ...(isRequired !== undefined && { isRequired }),
          ...(minSelect !== undefined && { minSelect }),
          ...(maxSelect !== undefined && { maxSelect }),
        },
        include: {
          modifiers: { orderBy: { sortOrder: "asc" } },
          _count: { select: { productModifierGroups: true } },
        },
      });
    });

    console.log(`[TAP API] Updated modifier group: ${modifierGroup.name}`);

    return NextResponse.json({
      success: true,
      modifierGroup,
    });
  } catch (error: any) {
    console.error("[TAP API] Update modifier group error:", error);
    return NextResponse.json(
      { error: "Failed to update modifier group" },
      { status: 500 }
    );
  }
}

// DELETE - Delete modifier group
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; groupId: string }> }
) {
  try {
    const { tenantId, groupId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const modifierGroup = await prisma.modifierGroup.findFirst({
      where: { id: groupId, tenantId },
      include: {
        _count: { select: { productModifierGroups: true } },
      },
    });

    if (!modifierGroup) {
      return NextResponse.json(
        { error: "Modifier group not found" },
        { status: 404 }
      );
    }

    // Check if used by products
    if (modifierGroup._count.productModifierGroups > 0) {
      return NextResponse.json(
        { error: "Cannot delete modifier group that is used by products" },
        { status: 409 }
      );
    }

    // Delete modifiers and group
    await prisma.$transaction(async (tx) => {
      await tx.modifier.deleteMany({ where: { groupId } });
      await tx.modifierGroup.delete({ where: { id: groupId } });
    });

    console.log(`[TAP API] Deleted modifier group: ${modifierGroup.name}`);

    return NextResponse.json({
      success: true,
      message: "Modifier group deleted",
    });
  } catch (error: any) {
    console.error("[TAP API] Delete modifier group error:", error);
    return NextResponse.json(
      { error: "Failed to delete modifier group" },
      { status: 500 }
    );
  }
}
