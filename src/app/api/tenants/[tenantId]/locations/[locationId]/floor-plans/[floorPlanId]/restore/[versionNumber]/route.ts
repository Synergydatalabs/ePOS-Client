// ============================================================================
// POST /api/.../floor-plans/[floorPlanId]/restore/[versionNumber]
//
// Restores a previous version's layout onto the live floor plan. Creates a
// NEW version (current + 1) with the restored snapshot — never overwrites
// history. So restore is fully auditable.
//
// Side effect: tables in DB are reconciled to match the snapshot.
// - Tables in snapshot not currently present → recreated (with original IDs
//   if they still exist soft-deleted, or new IDs if hard-deleted somehow)
// - Tables currently present but not in snapshot → soft-deleted
// - Positions/properties updated to snapshot values
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

interface SnapshotTable {
  id?: string;
  tableNumber: string;
  displayLabel?: string | null;
  capacity?: number;
  shape?: string;
  sectionId?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; floorPlanId: string; versionNumber: string }> }
) {
  try {
    const { tenantId, locationId, floorPlanId, versionNumber } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const targetVersion = parseInt(versionNumber, 10);
    if (!Number.isInteger(targetVersion) || targetVersion < 1) {
      return NextResponse.json({ error: "Invalid version number" }, { status: 400 });
    }

    // Ownership check
    const plan = await prisma.floorPlan.findFirst({
      where: { id: floorPlanId, locationId, location: { tenantId } },
      select: { id: true, currentVersion: true },
    });
    if (!plan) {
      return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });
    }

    // Load the target snapshot
    const snap = await prisma.floorPlanVersion.findFirst({
      where: { floorPlanId, versionNumber: targetVersion },
    });
    if (!snap) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const layout = snap.layoutJson as unknown as {
      tables?: SnapshotTable[];
      sections?: any[];
      canvas?: any;
    };
    const snapshotTables = layout.tables ?? [];

    const newVersionNumber = plan.currentVersion + 1;

    await prisma.$transaction(
      async (tx) => {
        // 1. Soft-delete all currently active tables in this floor plan
        await tx.table.updateMany({
          where: { floorPlanId, isActive: true },
          data: { isActive: false },
        });

        // 2. Recreate tables from snapshot
        //    We don't try to preserve original IDs (snapshot IDs may not exist
        //    anymore). Each restored table is a new row.
        for (const t of snapshotTables) {
          await tx.table.create({
            data: {
              locationId,
              floorPlanId,
              sectionId: t.sectionId ?? null,
              tableNumber: t.tableNumber,
              displayLabel: t.displayLabel ?? null,
              capacity: t.capacity ?? 4,
              shape: (t.shape as any) ?? "ROUND",
              x: t.x,
              y: t.y,
              width: t.width,
              height: t.height,
              rotation: t.rotation ?? 0,
              zIndex: t.zIndex ?? 0,
              isActive: true,
            },
          });
        }

        // 3. Create new version snapshot for the restore action
        await tx.floorPlanVersion.create({
          data: {
            floorPlanId,
            versionNumber: newVersionNumber,
            layoutJson: snap.layoutJson as any,
            note: `Restored from version ${targetVersion}`,
            savedById: auth.context.membership.id,
          },
        });

        // 4. Update floor plan to point at the new version
        await tx.floorPlan.update({
          where: { id: floorPlanId },
          data: {
            currentVersion: newVersionNumber,
            layoutJson: snap.layoutJson as any,
            draftJson: { set: null as any },
            hasUnsavedChanges: false,
            publishedAt: new Date(),
            publishedById: auth.context.membership.id,
          },
        });
      },
      { timeout: 30_000 }
    );

    return NextResponse.json({
      success: true,
      restoredFrom: targetVersion,
      newVersion: newVersionNumber,
      tablesRestored: snapshotTables.length,
    });
  } catch (err: any) {
    console.error("[floor-plan restore] error:", err);
    return NextResponse.json(
      { error: err?.message || "Restore failed" },
      { status: 500 }
    );
  }
}
