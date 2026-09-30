// GET /api/mobile/time-clock/active
//
// Returns the caller's OPEN time-clock entry (status ACTIVE or ON_BREAK)
// or null. Powers the "am I clocked in right now?" check on cold start
// and the elapsed-timer view.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const entry = await prisma.timeClockEntry.findFirst({
    where: {
      membershipId: ctx.ctx.session.memberId,
      status: { in: ["ACTIVE", "ON_BREAK"] },
    },
    orderBy: { clockedInAt: "desc" },
    select: {
      id: true, status: true, clockedInAt: true, clockedOutAt: true,
      totalMinutes: true, breakMinutes: true, notes: true,
      membershipId: true, locationId: true,
    },
  });

  return NextResponse.json({
    entry: entry
      ? {
          id: entry.id,
          status: entry.status,
          clockedInAt: entry.clockedInAt,
          clockedOutAt: entry.clockedOutAt,
          totalMinutes: entry.totalMinutes,
          breakMinutes: entry.breakMinutes,
          notes: entry.notes,
          membershipId: entry.membershipId,
          locationId: entry.locationId,
        }
      : null,
  });
}
