// ============================================================================
// /api/.../tour/scenes/[mediaId]/hotspots/[hotspotId]
//
//   PATCH  → update hotspot (move it, change label, change target, etc.)
//   DELETE → hard-delete hotspot
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const patchSchema = z.object({
  yaw: z.number().min(-180).max(180).optional(),
  pitch: z.number().min(-90).max(90).optional(),
  label: z.string().min(1).max(200).optional(),
  iconUrl: z.string().url().nullable().optional(),
  targetSceneMediaId: z.string().uuid().nullable().optional(),
  targetTableId: z.string().uuid().nullable().optional(),
  externalUrl: z.string().url().nullable().optional(),
  targetYaw: z.number().min(-180).max(180).nullable().optional(),
  targetPitch: z.number().min(-90).max(90).nullable().optional(),
  isActive: z.boolean().optional(),
});

async function verifyHotspot(
  tenantId: string,
  locationId: string,
  mediaId: string,
  hotspotId: string
) {
  return prisma.tourHotspot.findFirst({
    where: {
      id: hotspotId,
      sceneMediaId: mediaId,
      scene: { locationId, location: { tenantId } },
    },
    select: { id: true },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; mediaId: string; hotspotId: string }> }
) {
  try {
    const { tenantId, locationId, mediaId, hotspotId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const hotspot = await verifyHotspot(tenantId, locationId, mediaId, hotspotId);
    if (!hotspot) {
      return NextResponse.json({ error: "Hotspot not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const updated = await prisma.tourHotspot.update({
      where: { id: hotspotId },
      data: {
        ...(input.yaw !== undefined && { yaw: input.yaw }),
        ...(input.pitch !== undefined && { pitch: input.pitch }),
        ...(input.label !== undefined && { label: input.label }),
        ...(input.iconUrl !== undefined && { iconUrl: input.iconUrl }),
        ...(input.targetSceneMediaId !== undefined && {
          targetSceneMediaId: input.targetSceneMediaId,
        }),
        ...(input.targetTableId !== undefined && { targetTableId: input.targetTableId }),
        ...(input.externalUrl !== undefined && { externalUrl: input.externalUrl }),
        ...(input.targetYaw !== undefined && { targetYaw: input.targetYaw }),
        ...(input.targetPitch !== undefined && { targetPitch: input.targetPitch }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });

    return NextResponse.json({ hotspot: updated });
  } catch (err: any) {
    console.error("[hotspot PATCH] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update hotspot" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; mediaId: string; hotspotId: string }> }
) {
  try {
    const { tenantId, locationId, mediaId, hotspotId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const hotspot = await verifyHotspot(tenantId, locationId, mediaId, hotspotId);
    if (!hotspot) {
      return NextResponse.json({ error: "Hotspot not found" }, { status: 404 });
    }

    await prisma.tourHotspot.delete({ where: { id: hotspotId } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[hotspot DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to delete hotspot" },
      { status: 500 }
    );
  }
}
