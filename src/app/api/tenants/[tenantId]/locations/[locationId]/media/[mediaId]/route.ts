// ============================================================================
// /api/tenants/[tenantId]/locations/[locationId]/media/[mediaId]
//
//   PATCH  → update metadata (caption, alt, isCover, sceneName, etc.)
//   DELETE → soft-delete (sets is_active=false; S3 object NOT removed —
//            run a separate cleanup job to delete S3 objects)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { deleteObject } from "@/lib/s3";

const updateSchema = z.object({
  caption: z.string().max(500).nullable().optional(),
  altText: z.string().max(500).nullable().optional(),
  isCover: z.boolean().optional(),
  sceneName: z.string().max(100).nullable().optional(),
  initialYaw: z.number().optional(),
  initialPitch: z.number().optional(),
  initialFov: z.number().min(30).max(120).optional(),
  sectionId: z.string().uuid().nullable().optional(),
  displayOrder: z.number().int().nonnegative().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; mediaId: string }> }
) {
  try {
    const { tenantId, locationId, mediaId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const item = await prisma.mediaItem.findFirst({
      where: { id: mediaId, locationId, location: { tenantId } },
      select: { id: true },
    });
    if (!item) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // If sectionId provided, verify
    if (input.sectionId) {
      const section = await prisma.section.findFirst({
        where: { id: input.sectionId, floorPlan: { locationId } },
        select: { id: true },
      });
      if (!section) {
        return NextResponse.json(
          { error: "Section not found or not in this location" },
          { status: 400 }
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Cover swap: unset previous cover if this one becomes cover
      if (input.isCover === true) {
        await tx.mediaItem.updateMany({
          where: { locationId, isCover: true, NOT: { id: mediaId } },
          data: { isCover: false },
        });
      }

      const updated = await tx.mediaItem.update({
        where: { id: mediaId },
        data: {
          ...(input.caption !== undefined && { caption: input.caption }),
          ...(input.altText !== undefined && { altText: input.altText }),
          ...(input.isCover !== undefined && { isCover: input.isCover }),
          ...(input.sceneName !== undefined && { sceneName: input.sceneName }),
          ...(input.initialYaw !== undefined && { initialYaw: input.initialYaw }),
          ...(input.initialPitch !== undefined && { initialPitch: input.initialPitch }),
          ...(input.initialFov !== undefined && { initialFov: input.initialFov }),
          ...(input.sectionId !== undefined && { sectionId: input.sectionId }),
          ...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
        },
      });

      return updated;
    });

    return NextResponse.json({
      item: {
        ...result,
        fileSizeBytes: result.fileSizeBytes != null ? Number(result.fileSizeBytes) : null,
      },
    });
  } catch (err: any) {
    console.error("[media PATCH] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update media item" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; mediaId: string }> }
) {
  try {
    const { tenantId, locationId, mediaId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const item = await prisma.mediaItem.findFirst({
      where: { id: mediaId, locationId, location: { tenantId } },
    });
    if (!item) {
      return NextResponse.json({ error: "Media item not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const hardDelete = searchParams.get("hard") === "true";

    if (hardDelete) {
      // Remove from DB + S3
      // Tenant isolation safety: assertKeyBelongsToTenant happens via DB row's location → tenant
      try {
        await deleteObject(item.s3Key);
      } catch (err) {
        console.warn("[media DELETE] S3 delete failed (continuing):", err);
      }
      await prisma.mediaItem.delete({ where: { id: mediaId } });
    } else {
      // Soft delete — preserves history, S3 object retained
      await prisma.mediaItem.update({
        where: { id: mediaId },
        data: { isActive: false, isCover: false },
      });
    }

    return NextResponse.json({ success: true, hardDeleted: hardDelete });
  } catch (err: any) {
    console.error("[media DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to delete media item" },
      { status: 500 }
    );
  }
}
