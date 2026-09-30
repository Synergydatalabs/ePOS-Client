// POST /api/support/threads/[threadId]/messages
// Merchant or supplier posts a reply. Service verifies the thread belongs
// to this tenant, so a stolen threadId from another tenant returns 404.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupportSession } from "@/lib/support/session";
import { postTenantMessage, type AttachmentInput } from "@/lib/support/thread-service";
import { notifyAdminOfTenantReply } from "@/lib/support/notify";
import prisma from "@/lib/prisma";
import {
  SUPPORT_ATTACHMENT_ALLOWED_MIME,
  SUPPORT_ATTACHMENT_MAX_BYTES,
} from "@/lib/support/s3-support";

const MAX_BODY_LEN = 8000;
const MAX_ATTACHMENTS = 5;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await getSupportSession(request);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { threadId } = await params;

  let body: {
    body?: string;
    attachments?: AttachmentInput[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = body.body?.trim();
  if (!text) return NextResponse.json({ error: "Message body required" }, { status: 400 });
  if (text.length > MAX_BODY_LEN) {
    return NextResponse.json(
      { error: `Message too long (max ${MAX_BODY_LEN} chars)` },
      { status: 400 }
    );
  }

  // Attachment metadata validation. The file bytes are already in S3 at
  // this point (client PUT via presigned URL); we're just recording the
  // pointer. Re-check size and type as a defence-in-depth in case someone
  // crafts a message body without going through /attachments/presign.
  const attachments = body.attachments ?? [];
  if (attachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json(
      { error: `Too many attachments (max ${MAX_ATTACHMENTS})` },
      { status: 400 }
    );
  }
  for (const a of attachments) {
    if (!a.s3Key || !a.fileName || !a.contentType || !Number.isFinite(a.sizeBytes)) {
      return NextResponse.json({ error: "Malformed attachment entry" }, { status: 400 });
    }
    if (a.sizeBytes <= 0 || a.sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
      return NextResponse.json({ error: "Attachment size out of range" }, { status: 400 });
    }
    if (!SUPPORT_ATTACHMENT_ALLOWED_MIME.has(a.contentType)) {
      return NextResponse.json({ error: "Attachment type not allowed" }, { status: 400 });
    }
    // The presign endpoint scoped keys to support/<threadId>/… — reject
    // anything else so an attacker can't reference an arbitrary S3 key.
    if (!a.s3Key.startsWith(`support/${threadId}/`)) {
      return NextResponse.json({ error: "Attachment key mismatch" }, { status: 400 });
    }
  }

  let message: Awaited<ReturnType<typeof postTenantMessage>>;
  try {
    message = await postTenantMessage({
      threadId,
      tenantId: session.tenantId,
      tenantRole: session.tenantRole,
      senderUserId: session.userId,
      senderDisplayName: session.displayName,
      body: text,
      attachments,
    });
  } catch (err) {
    if ((err as Error).message === "thread_not_found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }

  // Fire notification after the write succeeds. Never block on it — a
  // dropped email must not roll back a real message.
  const thread = await prisma.supportThread.findUnique({
    where: { id: threadId },
    select: { subject: true },
  });
  if (thread) {
    notifyAdminOfTenantReply({
      threadId,
      threadSubject: thread.subject,
      senderName: session.displayName,
      senderRole: session.tenantRole,
      tenantName: session.tenantName,
      bodyPreview: text,
    }).catch((err) => console.error("notifyAdminOfTenantReply failed:", err));
  }

  return NextResponse.json({ message }, { status: 201 });
}
