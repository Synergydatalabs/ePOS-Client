// ============================================================================
// GET /api/.../floor-plans/[floorPlanId]/versions
//
// Returns the version history list (most recent first).
// Excludes layout_json by default (heavy) — fetch a specific version's
// layout via the restore endpoint preview or a future per-version detail
// endpoint.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; floorPlanId: string }> }
) {
  try {
    const { tenantId, locationId, floorPlanId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    // Verify ownership
    const plan = await prisma.floorPlan.findFirst({
      where: { id: floorPlanId, locationId, location: { tenantId } },
      select: { id: true, currentVersion: true },
    });
    if (!plan) {
      return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });
    }

    const versions = await prisma.floorPlanVersion.findMany({
      where: { floorPlanId },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        note: true,
        savedAt: true,
        savedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        // Derive table count from JSON without sending the heavy blob
        layoutJson: false,
      },
    });

    // Get table counts (lightweight: jsonb_array_length on the server)
    const counts = await prisma.$queryRaw<
      Array<{ id: string; tables_count: bigint; sections_count: bigint }>
    >`
      SELECT
        id,
        jsonb_array_length(COALESCE(layout_json->'tables', '[]'::jsonb)) AS tables_count,
        jsonb_array_length(COALESCE(layout_json->'sections', '[]'::jsonb)) AS sections_count
      FROM floor_plan_versions
      WHERE floor_plan_id = ${floorPlanId}::uuid
    `;
    const countMap = new Map(
      counts.map((c) => [
        c.id,
        { tables: Number(c.tables_count), sections: Number(c.sections_count) },
      ])
    );

    const enriched = versions.map((v) => ({
      ...v,
      tablesCount: countMap.get(v.id)?.tables ?? 0,
      sectionsCount: countMap.get(v.id)?.sections ?? 0,
      isCurrent: v.versionNumber === plan.currentVersion,
    }));

    return NextResponse.json({
      currentVersion: plan.currentVersion,
      versions: enriched,
    });
  } catch (err: any) {
    console.error("[versions GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load version history" },
      { status: 500 }
    );
  }
}
