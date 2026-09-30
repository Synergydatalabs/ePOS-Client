// ============================================================================
// POST /api/.../floor-plans/[floorPlanId]/tables
//
// Bulk save tables for this floor plan. Used by the editor's "Save Draft"
// action. Body contains:
//   { upsert: [...], deleteIds?: [...] }
//
// Each upsert row:
//   - has `id` → UPDATE that existing row
//   - no `id`  → CREATE new table with default capacity etc.
//
// Returns the saved tables with their (now-real) DB IDs so the editor
// can replace any temp client IDs.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const tableInputSchema = z.object({
  id: z.string().uuid().optional(),
  tableNumber: z.string().min(1).max(20),
  displayLabel: z.string().max(50).optional(),
  name: z.string().max(50).optional(),
  capacity: z.number().int().min(1).max(50).optional().default(4),
  minPartySize: z.number().int().min(1).optional().default(1),
  maxPartySize: z.number().int().min(1).optional(),
  shape: z
    .enum(["ROUND", "SQUARE", "RECTANGLE", "BOOTH", "BAR", "CUSTOM"])
    .optional()
    .default("ROUND"),
  customPolygon: z
    .array(z.tuple([z.number(), z.number()]))
    .min(3)
    .max(50)
    .optional(),
  sectionId: z.string().uuid().nullable().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().optional().default(0),
  zIndex: z.number().int().optional().default(0),
  revenueCenter: z.string().max(50).optional(),
  isBookable: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
});

const bodySchema = z.object({
  upsert: z.array(tableInputSchema).max(500),
  deleteIds: z.array(z.string().uuid()).max(500).optional(),
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
      select: { id: true },
    });
    if (!plan) {
      return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { upsert, deleteIds } = parsed.data;

    // Validate sectionId values belong to this floor plan
    const referencedSectionIds = Array.from(
      new Set(
        upsert
          .map((t) => t.sectionId)
          .filter((v): v is string => typeof v === "string")
      )
    );
    if (referencedSectionIds.length > 0) {
      const validSections = await prisma.section.findMany({
        where: { id: { in: referencedSectionIds }, floorPlanId },
        select: { id: true },
      });
      const validIds = new Set(validSections.map((s) => s.id));
      const invalid = referencedSectionIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Sections do not belong to this floor plan: ${invalid.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Check for duplicate tableNumber within the upsert batch
    const tableNumbers = upsert.map((t) => t.tableNumber.trim());
    if (new Set(tableNumbers).size !== tableNumbers.length) {
      return NextResponse.json(
        { error: "Duplicate tableNumber in input" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark deletions (soft) — sets isActive=false rather than DROP because
      //    a deleted Table might still be referenced by Orders.
      if (deleteIds && deleteIds.length > 0) {
        await tx.table.updateMany({
          where: {
            id: { in: deleteIds },
            locationId,
            floorPlanId,
          },
          data: { isActive: false, floorPlanId: null, sectionId: null },
        });
      }

      // 2. Upserts
      const saved: { id: string; tableNumber: string }[] = [];
      for (const t of upsert) {
        const data = {
          locationId,
          floorPlanId,
          sectionId: t.sectionId ?? null,
          tableNumber: t.tableNumber.trim(),
          displayLabel: t.displayLabel ?? null,
          name: t.name ?? null,
          capacity: t.capacity ?? 4,
          minPartySize: t.minPartySize ?? 1,
          maxPartySize: t.maxPartySize ?? null,
          shape: t.shape ?? "ROUND",
          // Custom polygon JSON (null for non-CUSTOM shapes — Prisma JSON null sentinel)
          customPolygon: t.customPolygon
            ? (t.customPolygon as any)
            : ({ set: null as any } as any),
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
          rotation: t.rotation ?? 0,
          zIndex: t.zIndex ?? 0,
          revenueCenter: t.revenueCenter ?? null,
          isBookable: t.isBookable ?? true,
          isActive: t.isActive ?? true,
        };

        if (t.id) {
          // UPDATE
          const row = await tx.table.update({
            where: { id: t.id },
            data,
            select: { id: true, tableNumber: true },
          });
          saved.push(row);
        } else {
          // CREATE
          const row = await tx.table.create({
            data,
            select: { id: true, tableNumber: true },
          });
          saved.push(row);
        }
      }

      // 3. Mark floor plan dirty (next publish will snapshot)
      await tx.floorPlan.update({
        where: { id: floorPlanId },
        data: { hasUnsavedChanges: true },
      });

      return saved;
    }, { timeout: 30_000 });

    return NextResponse.json({
      success: true,
      saved: result,
      deletedCount: deleteIds?.length ?? 0,
    });
  } catch (err: any) {
    console.error("[floor-plan tables save] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to save tables" },
      { status: 500 }
    );
  }
}
