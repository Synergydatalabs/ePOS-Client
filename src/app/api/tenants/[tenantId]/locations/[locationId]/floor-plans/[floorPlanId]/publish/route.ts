// ============================================================================
// POST /api/.../floor-plans/[floorPlanId]/publish
//
// Snapshots the current layout into a new floor_plan_versions row, then
// marks the floor plan as published (current version + 1).
//
// This is the "Save as published" action — what staff actually see in
// the live view comes from this snapshot, not the draft.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const bodySchema = z.object({
  note: z.string().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; floorPlanId: string }> }
) {
  try {
    const { tenantId, locationId, floorPlanId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const plan = await prisma.floorPlan.findFirst({
      where: { id: floorPlanId, locationId, location: { tenantId } },
      include: { tables: { where: { isActive: true } }, sections: true },
    });
    if (!plan) {
      return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const newVersion = plan.currentVersion + 1;

    // Snapshot includes current tables + sections + canvas settings
    const snapshot = {
      version: newVersion,
      publishedAt: new Date().toISOString(),
      canvas: {
        width: plan.canvasWidth,
        height: plan.canvasHeight,
        gridSize: plan.gridSize,
        backgroundUrl: plan.backgroundUrl,
        backgroundOpacity: plan.backgroundOpacity,
      },
      sections: plan.sections.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        displayOrder: s.displayOrder,
        polygonJson: s.polygonJson,
      })),
      tables: plan.tables.map((t) => ({
        id: t.id,
        tableNumber: t.tableNumber,
        displayLabel: t.displayLabel,
        capacity: t.capacity,
        shape: t.shape,
        sectionId: t.sectionId,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        zIndex: t.zIndex,
      })),
    };

    await prisma.$transaction([
      prisma.floorPlanVersion.create({
        data: {
          floorPlanId: plan.id,
          versionNumber: newVersion,
          layoutJson: snapshot,
          note: parsed.data.note ?? null,
          savedById: auth.context.membership.id,
        },
      }),
      prisma.floorPlan.update({
        where: { id: plan.id },
        data: {
          currentVersion: newVersion,
          layoutJson: snapshot,
          // Prisma JSON null sentinel — represents SQL NULL for jsonb columns
          draftJson: { set: null as any },
          hasUnsavedChanges: false,
          publishedAt: new Date(),
          publishedById: auth.context.membership.id,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      version: newVersion,
      publishedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[floor-plan publish] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to publish floor plan" },
      { status: 500 }
    );
  }
}
