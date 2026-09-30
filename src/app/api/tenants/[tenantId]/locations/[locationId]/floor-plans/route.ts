// ============================================================================
// /api/tenants/[tenantId]/locations/[locationId]/floor-plans
//
//   GET  → list all floor plans for a location (lightweight summary)
//   POST → create a new floor plan
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  floorNumber: z.number().int().optional().default(1),
  description: z.string().max(1000).optional(),
  canvasWidth: z.number().int().min(400).max(8000).optional().default(1200),
  canvasHeight: z.number().int().min(400).max(8000).optional().default(800),
  isDefault: z.boolean().optional().default(false),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    // Verify location belongs to this tenant
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const plans = await prisma.floorPlan.findMany({
      where: { locationId, isActive: true },
      orderBy: [{ displayOrder: "asc" }, { floorNumber: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        locationId: true,
        name: true,
        floorNumber: true,
        displayOrder: true,
        description: true,
        canvasWidth: true,
        canvasHeight: true,
        gridSize: true,
        backgroundUrl: true,
        backgroundOpacity: true,
        isActive: true,
        isDefault: true,
        hasUnsavedChanges: true,
        currentVersion: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ plans });
  } catch (err: any) {
    console.error("[floor-plans GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load floor plans" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const input = parsed.data;

    // If marked default, clear other defaults at this location
    const result = await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.floorPlan.updateMany({
          where: { locationId, isDefault: true },
          data: { isDefault: false },
        });
      }

      // Auto displayOrder: append to end
      const maxOrder = await tx.floorPlan.aggregate({
        where: { locationId },
        _max: { displayOrder: true },
      });

      // Check if location has zero plans — first one becomes default
      const existingCount = await tx.floorPlan.count({ where: { locationId } });
      const shouldBeDefault = input.isDefault || existingCount === 0;

      const created = await tx.floorPlan.create({
        data: {
          locationId,
          name: input.name.trim(),
          floorNumber: input.floorNumber,
          displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
          description: input.description ?? null,
          canvasWidth: input.canvasWidth,
          canvasHeight: input.canvasHeight,
          isDefault: shouldBeDefault,
        },
      });

      return created;
    });

    return NextResponse.json({ plan: result }, { status: 201 });
  } catch (err: any) {
    console.error("[floor-plans POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create floor plan" },
      { status: 500 }
    );
  }
}
