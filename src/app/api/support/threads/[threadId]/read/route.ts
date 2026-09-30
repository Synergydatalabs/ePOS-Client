// POST /api/support/threads/[threadId]/read — mark this thread as read
// for the current caller. Upserts a SupportReadReceipt row keyed on
// (threadId, readerType, readerId). Idempotent; safe to call on every
// open, tab-focus, or after posting a reply.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupportSession } from "@/lib/support/session";
import { markThreadRead } from "@/lib/support/thread-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await getSupportSession(request);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { threadId } = await params;
  try {
    await markThreadRead({
      threadId,
      tenantId: session.tenantId,
      tenantRole: session.tenantRole,
      readerUserId: session.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).message === "thread_not_found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }
}
