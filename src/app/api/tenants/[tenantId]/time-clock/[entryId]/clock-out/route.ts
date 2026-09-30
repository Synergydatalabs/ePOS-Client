// POST /api/tenants/[tenantId]/time-clock/[entryId]/clock-out
//   Closes an active entry, stamps totals. Auto-ends any still-open break.
//   Body: { notes? }
//
// Staff can only close their own entry; managers+ can close anyone's
// (useful when a cashier forgot at end of shift).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; entryId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, entryId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json().catch(() => ({}));
    const { notes } = body as { notes?: string };

    const entry = await prisma.timeClockEntry.findFirst({
      where: { id: entryId, tenantId },
      include: { breaks: { where: { endedAt: null } } },
    });
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const isSelf = entry.membershipId === auth.context.membership.id;
    const isManager = ["POS_MANAGER", "POS_ADMIN", "TENANT_OWNER"].includes(
      auth.context.membership.role
    );
    if (!isSelf && !isManager) {
      return NextResponse.json(
        { error: "Only managers can close another employee's shift" },
        { status: 403 }
      );
    }
    if (entry.status === "CLOSED") {
      return NextResponse.json(
        { error: "Shift is already closed" },
        { status: 409 }
      );
    }

    const now = new Date();

    const closed = await prisma.$transaction(async (tx) => {
      // Auto-end any still-open break (should never be more than one due
      // to the partial unique index, but handle a batch just in case).
      let extraBreakMinutes = 0;
      for (const b of entry.breaks) {
        const mins = Math.max(
          0,
          Math.round((now.getTime() - b.startedAt.getTime()) / 60000)
        );
        extraBreakMinutes += mins;
        await tx.timeClockBreak.update({
          where: { id: b.id },
          data: { endedAt: now, minutes: mins },
        });
      }

      // Sum all breaks now that they're closed
      const allBreaks = await tx.timeClockBreak.findMany({
        where: { entryId: entry.id },
        select: { minutes: true },
      });
      const breakMinutes = allBreaks.reduce(
        (s, b) => s + (b.minutes || 0),
        0
      );

      const elapsedMinutes = Math.max(
        0,
        Math.round((now.getTime() - entry.clockedInAt.getTime()) / 60000)
      );
      const totalMinutes = Math.max(0, elapsedMinutes - breakMinutes);

      return tx.timeClockEntry.update({
        where: { id: entry.id },
        data: {
          status: "CLOSED",
          clockedOutAt: now,
          totalMinutes,
          breakMinutes,
          notes: notes ? (entry.notes ? `${entry.notes}\n${notes}` : notes) : entry.notes,
        },
      });
    });

    return NextResponse.json({ success: true, entry: closed });
  } catch (error: any) {
    console.error("[time-clock clock-out] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to clock out" },
      { status: 500 }
    );
  }
}
