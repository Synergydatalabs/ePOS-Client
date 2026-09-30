// GET  /api/support/threads       — list my tenant's threads with admin
// POST /api/support/threads       — open a new thread to admin
//
// Auth: getSupportSession (Cognito OR partner cookie). Merchant sees
// their own threads only; supplier sees their own; neither can peek at
// other tenants (guard is in thread-service via tenantScope).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupportSession } from "@/lib/support/session";
import {
  createThreadFromTenant,
  listThreadsForTenant,
} from "@/lib/support/thread-service";
import {
  SUPPORT_THREAD_STATUSES,
  type SupportThreadStatusValue,
} from "@/lib/support/constants";

export async function GET(request: NextRequest) {
  const session = await getSupportSession(request);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam && (SUPPORT_THREAD_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as SupportThreadStatusValue)
      : statusParam === "ALL"
        ? "ALL"
        : undefined;

  const threads = await listThreadsForTenant({
    tenantId: session.tenantId,
    tenantRole: session.tenantRole,
    status,
  });
  return NextResponse.json({ threads });
}

export async function POST(request: NextRequest) {
  const session = await getSupportSession(request);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { subject?: string; firstMessage?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subject = body.subject?.trim();
  const firstMessage = body.firstMessage?.trim();
  if (!subject) return NextResponse.json({ error: "Subject is required." }, { status: 400 });
  if (subject.length > 255) {
    return NextResponse.json({ error: "Subject must be 255 characters or fewer." }, { status: 400 });
  }
  if (!firstMessage) return NextResponse.json({ error: "First message is required." }, { status: 400 });

  const thread = await createThreadFromTenant({
    subject,
    firstMessage,
    tenantId: session.tenantId,
    tenantRole: session.tenantRole,
    senderUserId: session.userId,
    senderDisplayName: session.displayName,
  });

  return NextResponse.json({ thread }, { status: 201 });
}
