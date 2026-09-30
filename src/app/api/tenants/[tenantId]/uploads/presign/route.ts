// ============================================================================
// POST /api/tenants/[tenantId]/uploads/presign
//
// Returns a presigned PUT URL the browser uses to upload directly to S3.
// Also creates a `uploaded_files` row in PENDING state so we can track
// orphans (uploads that started but never completed).
//
// Flow:
//   1. Client POSTs { filename, contentType, size, resourceType, resourceId? }
//   2. Server validates auth + tenant
//   3. Server builds tenant-isolated S3 key
//   4. Server generates presigned URL via AWS SDK
//   5. Server creates uploaded_files row (PENDING)
//   6. Client uploads directly to S3 via the returned URL
//   7. Client calls /uploads/presign/confirm (separate endpoint, future)
//      OR the resource (Product, Category) endpoint just uses the URL
//      and the cleanup job removes orphan PENDING rows after 24h
//
// Request body:
//   { filename, contentType, size, resourceType, resourceId? }
//
// Response (200):
//   {
//     uploadId,           // uuid of uploaded_files row
//     uploadUrl,          // presigned PUT URL — browser uploads here
//     uploadMethod,       // always "PUT"
//     uploadHeaders,      // headers browser MUST include
//     publicUrl,          // URL to use after upload completes (CDN-aware)
//     s3Key,              // raw S3 key for reference
//     expiresAt           // ISO timestamp when the URL stops working
//   }
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import {
  buildKey,
  buildPublicUrl,
  getPresignedUploadUrl,
  getS3Config,
  type S3ResourceType,
} from "@/lib/s3";

// Whitelist of MIME types we accept. Adding new ones requires conscious
// decision (some types like .svg / .html can run scripts if served as html).
const ALLOWED_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // intentionally NOT allowing image/svg+xml — SVG can contain scripts
  // Phase 3b: video formats for restaurant walkthrough
  "video/mp4",
  "video/webm",
  "video/quicktime",  // .mov files from iPhone
]);

const ALLOWED_RESOURCE_TYPES: ReadonlyArray<S3ResourceType> = [
  "product",
  "category",
  "logo",
  "floor_plan_bg",
  "restaurant_media",
  "user_avatar",
  "tmp",
];

const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  resourceType: z.enum([
    "product",
    "category",
    "logo",
    "floor_plan_bg",
    "user_avatar",
    "tmp",
  ]),
  resourceId: z.string().uuid().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Require POS_ADMIN or higher — uploads change the catalog
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { filename, contentType, size, resourceType, resourceId } =
      parsed.data;

    // MIME validation
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${contentType}. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
        },
        { status: 415 }
      );
    }

    // Resource type validation (also enforced by zod above; this is belt+suspenders)
    if (!ALLOWED_RESOURCE_TYPES.includes(resourceType)) {
      return NextResponse.json(
        { error: `Unsupported resource type: ${resourceType}` },
        { status: 400 }
      );
    }

    // Size validation handled inside getPresignedUploadUrl(), but we also
    // bail early with a friendlier error than the SDK throws.
    const config = getS3Config();
    if (size > config.maxUploadBytes) {
      return NextResponse.json(
        {
          error: `File too large: ${(size / 1024 / 1024).toFixed(1)}MB. Max: ${(config.maxUploadBytes / 1024 / 1024).toFixed(0)}MB`,
        },
        { status: 413 }
      );
    }

    // Build tenant-isolated key
    const s3Key = buildKey({
      tenantId,
      resourceType,
      filename,
    });

    // Generate presigned URL
    const presigned = await getPresignedUploadUrl({
      key: s3Key,
      contentType,
      contentLength: size,
      cacheControl: "public, max-age=31536000, immutable", // 1 year cache on images
    });

    // Track upload in DB (PENDING state — confirmed via separate endpoint
    // or by the resource create endpoint)
    const row = await prisma.uploadedFile.create({
      data: {
        tenantId,
        uploadedById: auth.context.membership.id,
        s3Bucket: config.bucket,
        s3Key,
        filename,
        mimeType: contentType,
        sizeBytes: BigInt(size),
        resourceType,
        resourceId: resourceId ?? null,
        uploadStatus: "PENDING",
      },
    });

    return NextResponse.json({
      uploadId: row.id,
      uploadUrl: presigned.url,
      uploadMethod: presigned.method,
      uploadHeaders: presigned.headers,
      publicUrl: buildPublicUrl(s3Key),
      s3Key,
      expiresAt: presigned.expiresAt.toISOString(),
    });
  } catch (err: any) {
    console.error("[uploads/presign] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to generate upload URL" },
      { status: 500 }
    );
  }
}
