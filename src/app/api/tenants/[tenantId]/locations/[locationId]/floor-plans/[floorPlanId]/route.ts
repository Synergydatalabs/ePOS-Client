// ============================================================================
// /api/tenants/[tenantId]/locations/[locationId]/floor-plans/[floorPlanId]
//
//   GET    → full floor plan with sections + tables (for editor / live view)
//   PATCH  → update floor plan metadata (name, dimensions, BG, etc.)
//   DELETE → soft-delete (set isActive=false) — preserves history
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  floorNumber: z.number().int().optional(),
  description: z.string().max(1000).nullable().optional(),
  canvasWidth: z.number().int().min(400).max(8000).optional(),
  canvasHeight: z.number().int().min(400).max(8000).optional(),
  gridSize: z.number().int().min(5).max(100).optional(),
  backgroundUrl: z.string().url().nullable().optional(),
  backgroundOpacity: z.number().min(0).max(1).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

async function verifyAccess(
  request: NextRequest,
  tenantId: string,
  locationId: string,
  floorPlanId: string,
  requiredRole: "POS_MANAGER" | "POS_ADMIN" = "POS_MANAGER"
) {
  const auth = await validateRequest(request, tenantId, requiredRole);
  if (!auth.success) return { error: auth.response };

  const plan = await prisma.floorPlan.findFirst({
    where: { id: floorPlanId, locationId },
    select: { id: true, location: { select: { tenantId: true } } },
  });

  if (!plan || plan.location.tenantId !== tenantId) {
    return {
      error: NextResponse.json({ error: "Floor plan not found" }, { status: 404 }),
    };
  }

  return { auth: auth.context };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; floorPlanId: string }> }
) {
  try {
    const { tenantId, locationId, floorPlanId } = await params;
    const access = await verifyAccess(request, tenantId, locationId, floorPlanId);
    if ("error" in access) return access.error;

    const plan = await prisma.floorPlan.findUnique({
      where: { id: floorPlanId },
      include: {
        sections: {
          orderBy: { displayOrder: "asc" },
        },
        tables: {
          where: { isActive: true },
          orderBy: { zIndex: "asc" },
        },
      },
    });

    if (!plan) {
      return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });
    }

    return NextResponse.json({ plan });
  } catch (err: any) {
    console.error("[floor-plan GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load floor plan" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; floorPlanId: string }> }
) {
  try {
    const { tenantId, locationId, floorPlanId } = await params;
    const access = await verifyAccess(request, tenantId, locationId, floorPlanId, "POS_ADMIN");
    if ("error" in access) return access.error;

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // If isDefault flipping on, clear other defaults at same location first
    if (input.isDefault === true) {
      await prisma.floorPlan.updateMany({
        where: { locationId, isDefault: true, NOT: { id: floorPlanId } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.floorPlan.update({
      where: { id: floorPlanId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.floorNumber !== undefined && { floorNumber: input.floorNumber }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.canvasWidth !== undefined && { canvasWidth: input.canvasWidth }),
        ...(input.canvasHeight !== undefined && { canvasHeight: input.canvasHeight }),
        ...(input.gridSize !== undefined && { gridSize: input.gridSize }),
        ...(input.backgroundUrl !== undefined && { backgroundUrl: input.backgroundUrl }),
        ...(input.backgroundOpacity !== undefined && { backgroundOpacity: input.backgroundOpacity }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      },
    });

    return NextResponse.json({ plan: updated });
  } catch (err: any) {
    console.error("[floor-plan PATCH] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update floor plan" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; floorPlanId: string }> }
) {
  try {
    const { tenantId, locationId, floorPlanId } = await params;
    const access = await verifyAccess(request, tenantId, locationId, floorPlanId, "POS_ADMIN");
    if ("error" in access) return access.error;

    // Soft delete — preserves DB history + table associations
    await prisma.floorPlan.update({
      where: { id: floorPlanId },
      data: { isActive: false, isDefault: false },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[floor-plan DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to delete floor plan" },
      { status: 500 }
    );
  }
}
