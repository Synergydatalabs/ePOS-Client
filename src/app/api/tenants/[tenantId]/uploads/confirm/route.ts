// ============================================================================
// POST /api/tenants/[tenantId]/uploads/confirm
//
// After browser successfully PUTs to S3, it calls this endpoint to mark
// the uploaded_files row as COMPLETED. We also verify the object actually
// exists in S3 (defense against client lying about successful upload).
//
// Body: { uploadId: uuid }
// Returns: { success: true, publicUrl } or { error }
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { buildPublicUrl, headObject, assertKeyBelongsToTenant } from "@/lib/s3";

const bodySchema = z.object({
  uploadId: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
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

    const row = await prisma.uploadedFile.findUnique({
      where: { id: parsed.data.uploadId },
    });

    if (!row || row.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Upload record not found" },
        { status: 404 }
      );
    }

    // Verify S3 key really belongs to this tenant (defense in depth)
    assertKeyBelongsToTenant(row.s3Key, tenantId);

    // Verify the object actually landed in S3 (and is the size we expected)
    const head = await headObject(row.s3Key);
    if (!head.exists) {
      // Mark FAILED so cleanup can collect later
      await prisma.uploadedFile.update({
        where: { id: row.id },
        data: { uploadStatus: "FAILED" },
      });
      return NextResponse.json(
        { error: "Upload not found in S3 — did the PUT request complete?" },
        { status: 422 }
      );
    }

    // Optional sanity check: size matches what client originally told us
    if (
      head.contentLength != null &&
      Number(row.sizeBytes) !== head.contentLength
    ) {
      console.warn(
        `[uploads/confirm] size mismatch for ${row.s3Key}: declared=${row.sizeBytes}, actual=${head.contentLength}`
      );
      // Don't fail — just log. Could indicate tampering or browser quirk.
    }

    const updated = await prisma.uploadedFile.update({
      where: { id: row.id },
      data: {
        uploadStatus: "COMPLETED",
        uploadedAt: new Date(),
        s3Etag: head.etag?.replace(/"/g, "") ?? null,
      },
    });

    return NextResponse.json({
      success: true,
      uploadId: updated.id,
      publicUrl: buildPublicUrl(updated.s3Key),
      s3Key: updated.s3Key,
    });
  } catch (err: any) {
    console.error("[uploads/confirm] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to confirm upload" },
      { status: 500 }
    );
  }
}
