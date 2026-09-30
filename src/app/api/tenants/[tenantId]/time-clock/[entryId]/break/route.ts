// POST /api/tenants/[tenantId]/time-clock/[entryId]/break
//   action: 'start' | 'end'
//   For 'start' — also accepts { type: 'MEAL' | 'REST' }, default REST.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; entryId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, entryId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { action, type } = body as {
      action?: "start" | "end";
      type?: "MEAL" | "REST";
    };

    const entry = await prisma.timeClockEntry.findFirst({
      where: { id: entryId, tenantId, membershipId: auth.context.membership.id },
      include: { breaks: { where: { endedAt: null } } },
    });
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    if (entry.status === "CLOSED") {
      return NextResponse.json(
        { error: "Shift is closed" },
        { status: 409 }
      );
    }

    if (action === "start") {
      if (entry.status === "ON_BREAK") {
        return NextResponse.json(
          { error: "Already on a break" },
          { status: 409 }
        );
      }
      const [, updated] = await prisma.$transaction([
        prisma.timeClockBreak.create({
          data: {
            entryId: entry.id,
            type: type === "MEAL" ? "MEAL" : "REST",
          },
        }),
        prisma.timeClockEntry.update({
          where: { id: entry.id },
          data: { status: "ON_BREAK" },
        }),
      ]);
      return NextResponse.json({ success: true, entry: updated });
    }

    if (action === "end") {
      const open = entry.breaks[0];
      if (!open) {
        return NextResponse.json(
          { error: "No active break to end" },
          { status: 409 }
        );
      }
      const now = new Date();
      const mins = Math.max(
        0,
        Math.round((now.getTime() - open.startedAt.getTime()) / 60000)
      );
      const [, updated] = await prisma.$transaction([
        prisma.timeClockBreak.update({
          where: { id: open.id },
          data: { endedAt: now, minutes: mins },
        }),
        prisma.timeClockEntry.update({
          where: { id: entry.id },
          data: { status: "ACTIVE" },
        }),
      ]);
      return NextResponse.json({ success: true, entry: updated, minutes: mins });
    }

    return NextResponse.json(
      { error: "action must be 'start' or 'end'" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[time-clock break] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to update break" },
      { status: 500 }
    );
  }
}
