// POST /api/support/threads/[threadId]/attachments/presign
// Body: { fileName, contentType, sizeBytes }
// Returns: { uploadUrl, s3Key, expiresAt }
//
// The client PUTs the file directly to uploadUrl, then POSTs the message
// with attachments: [{ s3Key, fileName, contentType, sizeBytes }]. We
// verify the thread belongs to the caller's tenant so a stolen thread id
// can't be used to write into another tenant's S3 space.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getSupportSession } from "@/lib/support/session";
import {
  SUPPORT_ATTACHMENT_ALLOWED_MIME,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  buildSupportAttachmentKey,
  presignSupportUpload,
} from "@/lib/support/s3-support";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await getSupportSession(request);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { threadId } = await params;

  let body: { fileName?: string; contentType?: string; sizeBytes?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const fileName = body.fileName?.trim();
  const contentType = body.contentType?.trim();
  const sizeBytes = Number(body.sizeBytes);

  if (!fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });
  if (!contentType) return NextResponse.json({ error: "contentType required" }, { status: 400 });
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: "sizeBytes required" }, { status: 400 });
  }
  if (sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${SUPPORT_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB)` },
      { status: 400 }
    );
  }
  if (!SUPPORT_ATTACHMENT_ALLOWED_MIME.has(contentType)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }

  // Ownership check — thread must belong to this tenant.
  const scope =
    session.tenantRole === "MERCHANT"
      ? { merchantTenantId: session.tenantId }
      : { supplierTenantId: session.tenantId };
  const thread = await prisma.supportThread.findFirst({
    where: { id: threadId, ...scope },
    select: { id: true },
  });
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  const key = buildSupportAttachmentKey({ threadId, fileName });
  const { url, expiresAt } = await presignSupportUpload({ key, contentType });
  return NextResponse.json({ uploadUrl: url, s3Key: key, expiresAt });
}
