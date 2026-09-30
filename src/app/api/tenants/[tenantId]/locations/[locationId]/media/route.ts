// ============================================================================
// /api/tenants/[tenantId]/locations/[locationId]/media
//
//   GET  → list all media for a location (optionally filter by mediaType / sectionId)
//   POST → register a media item (called AFTER S3 upload completes)
//
// Upload flow:
//   1. Browser calls /uploads/presign with resourceType='product' or
//      'floor_plan_bg' — we'll add 'restaurant_media' implicitly via the
//      media gallery UI which calls /uploads/presign with that type
//   2. Browser PUTs file to S3
//   3. Browser calls THIS POST endpoint with s3Key + metadata to register
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const createSchema = z.object({
  sectionId: z.string().uuid().nullable().optional(),
  mediaType: z.enum(["PHOTO", "VIDEO", "PANORAMA_360"]),
  s3Key: z.string().min(1).max(500),
  publicUrl: z.string().url().max(800),
  thumbnailUrl: z.string().url().max(800).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  caption: z.string().max(500).optional(),
  altText: z.string().max(500).optional(),
  isCover: z.boolean().optional().default(false),
  sceneName: z.string().max(100).optional(),
  initialYaw: z.number().optional(),
  initialPitch: z.number().optional(),
  initialFov: z.number().min(30).max(120).optional(),
});

async function verifyLocation(tenantId: string, locationId: string) {
  return prisma.location.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const loc = await verifyLocation(tenantId, locationId);
    if (!loc) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const mediaType = searchParams.get("mediaType");
    const sectionId = searchParams.get("sectionId");

    const where: any = { locationId, isActive: true };
    if (mediaType && ["PHOTO", "VIDEO", "PANORAMA_360"].includes(mediaType)) {
      where.mediaType = mediaType;
    }
    if (sectionId) {
      where.sectionId = sectionId;
    }

    const items = await prisma.mediaItem.findMany({
      where,
      orderBy: [{ isCover: "desc" }, { displayOrder: "asc" }, { createdAt: "asc" }],
    });

    // BigInt → Number for JSON serialization
    const safe = items.map((m) => ({
      ...m,
      fileSizeBytes: m.fileSizeBytes != null ? Number(m.fileSizeBytes) : null,
    }));

    return NextResponse.json({ items: safe });
  } catch (err: any) {
    console.error("[media GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load media" },
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

    const loc = await verifyLocation(tenantId, locationId);
    if (!loc) {
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

    // If sectionId provided, verify it belongs to a floor plan in this location
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

    // Auto displayOrder: append to end
    const maxOrder = await prisma.mediaItem.aggregate({
      where: { locationId, isActive: true },
      _max: { displayOrder: true },
    });
    const displayOrder = (maxOrder._max.displayOrder ?? 0) + 1;

    const result = await prisma.$transaction(async (tx) => {
      // If setting as cover, unset any existing cover first
      if (input.isCover) {
        await tx.mediaItem.updateMany({
          where: { locationId, isCover: true },
          data: { isCover: false },
        });
      }

      const created = await tx.mediaItem.create({
        data: {
          locationId,
          sectionId: input.sectionId ?? null,
          mediaType: input.mediaType,
          s3Key: input.s3Key,
          publicUrl: input.publicUrl,
          thumbnailUrl: input.thumbnailUrl ?? null,
          fileSizeBytes: input.fileSizeBytes ? BigInt(input.fileSizeBytes) : null,
          widthPx: input.widthPx ?? null,
          heightPx: input.heightPx ?? null,
          durationSeconds: input.durationSeconds ?? null,
          caption: input.caption ?? null,
          altText: input.altText ?? null,
          displayOrder,
          isCover: input.isCover ?? false,
          sceneName: input.sceneName ?? null,
          initialYaw: input.initialYaw ?? 0,
          initialPitch: input.initialPitch ?? 0,
          initialFov: input.initialFov ?? 90,
          uploadedById: auth.context.membership.id,
        },
      });

      return created;
    });

    return NextResponse.json(
      {
        item: {
          ...result,
          fileSizeBytes: result.fileSizeBytes != null ? Number(result.fileSizeBytes) : null,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[media POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create media item" },
      { status: 500 }
    );
  }
}

// Bulk reorder endpoint — PATCH with body { order: [{id, displayOrder}, ...] }
const reorderSchema = z.object({
  order: z.array(
    z.object({
      id: z.string().uuid(),
      displayOrder: z.number().int().nonnegative(),
    })
  ).min(1).max(500),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const loc = await verifyLocation(tenantId, locationId);
    if (!loc) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }

    // Verify all IDs belong to this location
    const ids = parsed.data.order.map((o) => o.id);
    const validCount = await prisma.mediaItem.count({
      where: { id: { in: ids }, locationId },
    });
    if (validCount !== ids.length) {
      return NextResponse.json(
        { error: "One or more media items don't belong to this location" },
        { status: 400 }
      );
    }

    // Bulk update
    await prisma.$transaction(
      parsed.data.order.map((o) =>
        prisma.mediaItem.update({
          where: { id: o.id },
          data: { displayOrder: o.displayOrder },
        })
      )
    );

    return NextResponse.json({ success: true, updated: ids.length });
  } catch (err: any) {
    console.error("[media PATCH reorder] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to reorder" },
      { status: 500 }
    );
  }
}
