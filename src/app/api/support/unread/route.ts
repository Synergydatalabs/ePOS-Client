// GET /api/support/unread — { count, threadIds } for the current tenant's
// unread threads. Used by the floating button badge and the sidebar
// indicator. Poll cadence is set by the client (30s while closed).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupportSession } from "@/lib/support/session";
import { getUnreadForTenant } from "@/lib/support/thread-service";

export async function GET(request: NextRequest) {
  const session = await getSupportSession(request);
  if (!session) return NextResponse.json({ count: 0, threadIds: [] });

  const result = await getUnreadForTenant({
    tenantId: session.tenantId,
    tenantRole: session.tenantRole,
    readerUserId: session.userId,
  });
  return NextResponse.json(result);
}
