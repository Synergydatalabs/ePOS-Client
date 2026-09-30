// ============================================================================
// /api/.../tour/scenes/[mediaId]/hotspots
//
//   POST → create a new hotspot on the given 360° scene
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const createSchema = z
  .object({
    hotspotType: z.enum(["SCENE_LINK", "TABLE_LINK", "INFO", "EXTERNAL_URL"]),
    yaw: z.number().min(-180).max(180),
    pitch: z.number().min(-90).max(90),
    label: z.string().min(1).max(200),
    iconUrl: z.string().url().optional(),
    targetSceneMediaId: z.string().uuid().optional(),
    targetTableId: z.string().uuid().optional(),
    externalUrl: z.string().url().optional(),
    targetYaw: z.number().min(-180).max(180).optional(),
    targetPitch: z.number().min(-90).max(90).optional(),
  })
  .refine(
    (d) => {
      // hotspotType must match populated target
      if (d.hotspotType === "SCENE_LINK") return !!d.targetSceneMediaId;
      if (d.hotspotType === "TABLE_LINK") return !!d.targetTableId;
      if (d.hotspotType === "EXTERNAL_URL") return !!d.externalUrl;
      return true; // INFO needs no target
    },
    { message: "hotspotType doesn't match the populated target field" }
  );

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; mediaId: string }> }
) {
  try {
    const { tenantId, locationId, mediaId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    // Verify scene exists and is a 360° panorama in this location
    const scene = await prisma.mediaItem.findFirst({
      where: {
        id: mediaId,
        locationId,
        location: { tenantId },
        mediaType: "PANORAMA_360",
      },
      select: { id: true },
    });
    if (!scene) {
      return NextResponse.json(
        { error: "360° scene not found in this location" },
        { status: 404 }
      );
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

    // Validate targets belong to same tenant/location
    if (input.targetSceneMediaId) {
      const target = await prisma.mediaItem.findFirst({
        where: {
          id: input.targetSceneMediaId,
          locationId,
          mediaType: "PANORAMA_360",
        },
        select: { id: true },
      });
      if (!target) {
        return NextResponse.json(
          { error: "Target scene not found in this location" },
          { status: 400 }
        );
      }
    }
    if (input.targetTableId) {
      const target = await prisma.table.findFirst({
        where: { id: input.targetTableId, locationId },
        select: { id: true },
      });
      if (!target) {
        return NextResponse.json(
          { error: "Target table not found in this location" },
          { status: 400 }
        );
      }
    }

    const hotspot = await prisma.tourHotspot.create({
      data: {
        sceneMediaId: mediaId,
        hotspotType: input.hotspotType,
        yaw: input.yaw,
        pitch: input.pitch,
        label: input.label,
        iconUrl: input.iconUrl ?? null,
        targetSceneMediaId: input.targetSceneMediaId ?? null,
        targetTableId: input.targetTableId ?? null,
        externalUrl: input.externalUrl ?? null,
        targetYaw: input.targetYaw ?? null,
        targetPitch: input.targetPitch ?? null,
      },
    });

    return NextResponse.json({ hotspot }, { status: 201 });
  } catch (err: any) {
    console.error("[hotspots POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create hotspot" },
      { status: 500 }
    );
  }
}
