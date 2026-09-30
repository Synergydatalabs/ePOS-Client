// GET /api/tenants/[tenantId]/time-clock/summary
//   Per-staff hours summary for the date range. Manager-only.
//   Query: ?days=30&locationId=<uuid>
//   Returns per-member rows: { membership, totalMinutes, breakMinutes,
//                              shiftCount, avgShiftMinutes }

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const daysParam = parseInt(searchParams.get("days") || "30", 10);
    const days = Math.max(1, Math.min(365, isNaN(daysParam) ? 30 : daysParam));
    const locationId = searchParams.get("locationId") || undefined;

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Only closed shifts contribute to hours — open shifts still have
    // null totalMinutes. Aggregate by membership.
    const entries = await prisma.timeClockEntry.findMany({
      where: {
        tenantId,
        status: "CLOSED",
        ...(locationId ? { locationId } : {}),
        clockedInAt: { gte: since },
      },
      select: {
        membershipId: true,
        totalMinutes: true,
        breakMinutes: true,
        membership: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    const byMember = new Map<
      string,
      {
        membership: any;
        totalMinutes: number;
        breakMinutes: number;
        shiftCount: number;
      }
    >();

    for (const e of entries) {
      const row = byMember.get(e.membershipId) || {
        membership: e.membership,
        totalMinutes: 0,
        breakMinutes: 0,
        shiftCount: 0,
      };
      row.totalMinutes += e.totalMinutes || 0;
      row.breakMinutes += e.breakMinutes || 0;
      row.shiftCount += 1;
      byMember.set(e.membershipId, row);
    }

    const rows = Array.from(byMember.values())
      .map((r) => ({
        ...r,
        avgShiftMinutes:
          r.shiftCount > 0 ? Math.round(r.totalMinutes / r.shiftCount) : 0,
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);

    return NextResponse.json({
      success: true,
      windowDays: days,
      rows,
      summary: {
        totalShifts: entries.length,
        totalMinutes: rows.reduce((s, r) => s + r.totalMinutes, 0),
        totalBreakMinutes: rows.reduce((s, r) => s + r.breakMinutes, 0),
        staffCount: rows.length,
      },
    });
  } catch (error: any) {
    console.error("[time-clock summary] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load summary" },
      { status: 500 }
    );
  }
}
