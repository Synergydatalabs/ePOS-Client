// POST /api/tenants/[tenantId]/modifier-groups - Create modifier group
// GET /api/tenants/[tenantId]/modifier-groups - List modifier groups

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Create modifier group with modifiers
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
      displayName,
      isRequired = false,
      minSelect = 0,
      maxSelect = 1,
      modifiers = [],
    } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Modifier group name is required" },
        { status: 400 }
      );
    }

    // Validate min/max select
    if (minSelect < 0 || maxSelect < 1 || minSelect > maxSelect) {
      return NextResponse.json(
        { error: "Invalid min/max selection values" },
        { status: 400 }
      );
    }

    const modifierGroup = await prisma.modifierGroup.create({
      data: {
        tenantId,
        name: name.trim(),
        displayName: displayName?.trim() || name.trim(),
        isRequired,
        minSelect,
        maxSelect,
        modifiers: modifiers.length
          ? {
              create: modifiers.map((m: any, idx: number) => ({
                name: m.name,
                price: m.price || 0, // in cents
                cost: m.cost || 0, // in cents
                sortOrder: m.sortOrder ?? idx,
                isDefault: m.isDefault ?? false,
                isActive: m.isActive ?? true,
              })),
            }
          : undefined,
      },
      include: {
        modifiers: { orderBy: { sortOrder: "asc" } },
        _count: { select: { productModifierGroups: true } },
      },
    });

    console.log(`[TAP API] Created modifier group: ${modifierGroup.name}`);

    return NextResponse.json({
      success: true,
      modifierGroup,
    });
  } catch (error: any) {
    console.error("[TAP API] Create modifier group error:", error);
    return NextResponse.json(
      { error: "Failed to create modifier group" },
      { status: 500 }
    );
  }
}

// GET - List modifier groups
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

    const modifierGroups = await prisma.modifierGroup.findMany({
      where: { tenantId },
      include: {
        modifiers: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        },
        _count: { select: { productModifierGroups: true } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      success: true,
      modifierGroups,
    });
  } catch (error: any) {
    console.error("[TAP API] List modifier groups error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
