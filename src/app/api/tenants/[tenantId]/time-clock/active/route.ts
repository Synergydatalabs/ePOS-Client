// GET /api/tenants/[tenantId]/time-clock/active
//   Returns the caller's currently-open entry (ACTIVE or ON_BREAK), or
//   null if they're clocked out. Used by the POS toolbar to render the
//   running-time pill.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const entry = await prisma.timeClockEntry.findFirst({
      where: {
        membershipId: auth.context.membership.id,
        status: { not: "CLOSED" },
      },
      include: {
        breaks: {
          orderBy: { startedAt: "desc" },
        },
        location: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ success: true, entry });
  } catch (error: any) {
    console.error("[time-clock active] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load status" },
      { status: 500 }
    );
  }
}
