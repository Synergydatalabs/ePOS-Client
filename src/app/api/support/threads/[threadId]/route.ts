// GET /api/support/threads/[threadId] — thread + messages (non-internal only).
// 404 (not 403) when the thread belongs to another tenant, so we don't
// leak the existence of other tenants' threads.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupportSession } from "@/lib/support/session";
import { getThreadForTenantWithAttachments } from "@/lib/support/thread-service";
import { presignSupportDownload } from "@/lib/support/s3-support";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await getSupportSession(request);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { threadId } = await params;
  const thread = await getThreadForTenantWithAttachments({
    threadId,
    tenantId: session.tenantId,
    tenantRole: session.tenantRole,
  });
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Enrich each attachment with a fresh presigned download URL. Minted
  // on every fetch so a stale browser tab won't cache a valid link past
  // the 5-minute TTL. sizeBytes is BigInt → coerce to number for JSON.
  const messages = await Promise.all(
    thread.messages.map(async (m) => {
      const attachments = await Promise.all(
        m.attachments.map(async (a) => ({
          id: a.id,
          fileName: a.fileName,
          contentType: a.contentType,
          sizeBytes: Number(a.sizeBytes),
          downloadUrl: await presignSupportDownload({
            s3Key: a.s3Key,
            fileName: a.fileName,
          }),
        }))
      );
      return { ...m, attachments };
    })
  );

  return NextResponse.json({ thread: { ...thread, messages } });
}
