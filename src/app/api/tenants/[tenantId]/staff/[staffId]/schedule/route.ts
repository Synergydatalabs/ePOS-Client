// GET  /api/tenants/[tenantId]/staff/[staffId]/schedule
// PUT  /api/tenants/[tenantId]/staff/[staffId]/schedule
//
// Per-technician weekly working hours (Phase E R1). The PUT accepts the
// full 7-day payload and does a delete-all + createMany replace inside a
// transaction — simpler than diffing, and 7 rows is trivial.
//
// Day-of-week convention: 0=Sun..6=Sat, matches JS Date.getDay().
// Both start_time and end_time nullable for that day = "off that day"
// (still gets a row so the UI shows the day; missing rows also count as
// "off").

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

interface ScheduleDay {
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
}

async function ownsMember(tenantId: string, staffId: string): Promise<boolean> {
  const m = await prisma.membership.findFirst({
    where: { id: staffId, tenantId },
    select: { id: true },
  });
  return !!m;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; staffId: string }> }
) {
  try {
    const { tenantId, staffId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;
    if (!(await ownsMember(tenantId, staffId))) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }
    const rows = await prisma.staffSchedule.findMany({
      where: { membershipId: staffId },
      orderBy: { dayOfWeek: "asc" },
    });
    return NextResponse.json({
      success: true,
      schedule: rows.map((r) => ({
        dayOfWeek: r.dayOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
      })),
    });
  } catch (error: any) {
    console.error("[STAFF-SCHEDULE] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load schedule" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; staffId: string }> }
) {
  try {
    const { tenantId, staffId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;
    if (!(await ownsMember(tenantId, staffId))) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    const body = await request.json();
    const days: unknown = body?.schedule;
    if (!Array.isArray(days)) {
      return NextResponse.json(
        { error: "Body must be { schedule: [{ dayOfWeek, startTime, endTime }] }" },
        { status: 400 }
      );
    }

    // Validate + normalize. Rejects malformed rows early so a bad row
    // doesn't half-wipe the schedule.
    const cleaned: ScheduleDay[] = [];
    const seenDays = new Set<number>();
    for (const raw of days as any[]) {
      const dow = Number(raw?.dayOfWeek);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        return NextResponse.json(
          { error: `Invalid dayOfWeek: ${raw?.dayOfWeek}` },
          { status: 400 }
        );
      }
      if (seenDays.has(dow)) {
        return NextResponse.json(
          { error: `Duplicate dayOfWeek ${dow} in payload` },
          { status: 400 }
        );
      }
      seenDays.add(dow);
      const startTime =
        typeof raw?.startTime === "string" && raw.startTime.length > 0
          ? raw.startTime
          : null;
      const endTime =
        typeof raw?.endTime === "string" && raw.endTime.length > 0
          ? raw.endTime
          : null;
      // Both-or-neither. Half-set = confused UX; refuse it.
      if ((startTime && !endTime) || (!startTime && endTime)) {
        return NextResponse.json(
          { error: `Day ${dow}: set both start and end, or leave both blank for 'off'.` },
          { status: 400 }
        );
      }
      cleaned.push({ dayOfWeek: dow, startTime, endTime });
    }

    // Replace: 7 rows fits in one round-trip inside a tx.
    await prisma.$transaction([
      prisma.staffSchedule.deleteMany({ where: { membershipId: staffId } }),
      prisma.staffSchedule.createMany({
        data: cleaned.map((d) => ({
          membershipId: staffId,
          dayOfWeek: d.dayOfWeek,
          startTime: d.startTime,
          endTime: d.endTime,
        })),
      }),
    ]);

    return NextResponse.json({ success: true, schedule: cleaned });
  } catch (error: any) {
    console.error("[STAFF-SCHEDULE] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save schedule" },
      { status: 500 }
    );
  }
}
