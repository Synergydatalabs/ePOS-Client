// ============================================================================
// GET  /api/.../locations/[locationId]/tour
// PATCH /api/.../locations/[locationId]/tour
//
// GET: returns the full tour state for the admin editor:
//   - location info (name, publicTourSlug)
//   - list of scenes (PANORAMA_360 media items, with hotspots)
//   - list of tables (so admin can pick table targets for TABLE_LINK hotspots)
//
// PATCH: update tour-level settings on the location (publicTourSlug rename).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true, name: true, publicTourSlug: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    // All 360° panoramas for this location
    const scenes = await prisma.mediaItem.findMany({
      where: {
        locationId,
        mediaType: "PANORAMA_360",
        isActive: true,
      },
      orderBy: [{ isDefaultScene: "desc" }, { displayOrder: "asc" }],
      include: {
        hotspots: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    // Tables in this location (for TABLE_LINK targets)
    const tables = await prisma.table.findMany({
      where: { locationId, isActive: true, isBookable: true },
      select: {
        id: true,
        tableNumber: true,
        displayLabel: true,
        capacity: true,
        section: { select: { id: true, name: true } },
      },
      orderBy: { tableNumber: "asc" },
    });

    return NextResponse.json({
      location,
      scenes: scenes.map((s) => ({
        ...s,
        fileSizeBytes: s.fileSizeBytes != null ? Number(s.fileSizeBytes) : null,
      })),
      tables,
    });
  } catch (err: any) {
    console.error("[tour GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load tour" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  publicTourSlug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "lowercase letters, numbers, dashes only")
    .optional(),
  defaultSceneMediaId: z.string().uuid().nullable().optional(),
});

export async function PATCH(
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
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      // Slug rename
      if (parsed.data.publicTourSlug !== undefined) {
        // Uniqueness check (case slug taken by another location)
        const existing = await tx.location.findFirst({
          where: { publicTourSlug: parsed.data.publicTourSlug, NOT: { id: locationId } },
          select: { id: true },
        });
        if (existing) {
          throw new Error("That public tour URL is already in use. Pick another.");
        }
        await tx.location.update({
          where: { id: locationId },
          data: { publicTourSlug: parsed.data.publicTourSlug },
        });
      }

      // Default scene swap
      if (parsed.data.defaultSceneMediaId !== undefined) {
        // Clear any existing default for this location
        await tx.mediaItem.updateMany({
          where: { locationId, isDefaultScene: true, mediaType: "PANORAMA_360" },
          data: { isDefaultScene: false },
        });
        // Set the new default (if provided)
        if (parsed.data.defaultSceneMediaId !== null) {
          await tx.mediaItem.updateMany({
            where: {
              id: parsed.data.defaultSceneMediaId,
              locationId,
              mediaType: "PANORAMA_360",
            },
            data: { isDefaultScene: true },
          });
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[tour PATCH] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update tour settings" },
      { status: 500 }
    );
  }
}
