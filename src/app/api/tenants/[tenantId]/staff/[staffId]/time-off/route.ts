// GET  /api/tenants/[tenantId]/staff/[staffId]/time-off — list active + future
// POST /api/tenants/[tenantId]/staff/[staffId]/time-off — add a range
//
// Time-off ranges are inclusive on both ends. Past ranges (endDate <
// today) are filtered out of the list by default — they're historical
// and no longer affect availability.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

async function ownsMember(tenantId: string, staffId: string): Promise<boolean> {
  const m = await prisma.membership.findFirst({
    where: { id: staffId, tenantId },
    select: { id: true },
  });
  return !!m;
}

function parseISODate(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
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

    // Include today — a person off today should still show even if the
    // range ends today. Simpler than parsing "today" server-side.
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const rows = await prisma.staffTimeOff.findMany({
      where: {
        membershipId: staffId,
        endDate: { gte: startOfToday },
      },
      orderBy: { startDate: "asc" },
    });
    return NextResponse.json({ success: true, timeOff: rows });
  } catch (error: any) {
    console.error("[STAFF-TIMEOFF] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load time off" },
      { status: 500 }
    );
  }
}

export async function POST(
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
    const startDate = parseISODate(body?.startDate);
    const endDate = parseISODate(body?.endDate);
    const reason =
      typeof body?.reason === "string" ? body.reason.trim().slice(0, 255) : null;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required in YYYY-MM-DD format" },
        { status: 400 }
      );
    }
    if (endDate < startDate) {
      return NextResponse.json(
        { error: "endDate cannot be before startDate" },
        { status: 400 }
      );
    }

    const row = await prisma.staffTimeOff.create({
      data: {
        membershipId: staffId,
        startDate,
        endDate,
        reason,
      },
    });
    return NextResponse.json({ success: true, timeOff: row });
  } catch (error: any) {
    console.error("[STAFF-TIMEOFF] POST error:", error);
    return NextResponse.json(
      { error: "Failed to add time off" },
      { status: 500 }
    );
  }
}
