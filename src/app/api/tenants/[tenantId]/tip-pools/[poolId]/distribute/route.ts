// POST /api/tenants/[tenantId]/tip-pools/[poolId]/distribute
//   Compute + persist per-member shares from the pool's rule. Wipes any
//   prior distribution rows so re-running is idempotent. Bumps status
//   OPEN → DISTRIBUTED. Locked once the pool is CLOSED.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { distributeTips } from "@/lib/tip-distribution";

type Params = { params: Promise<{ tenantId: string; poolId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, poolId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const pool = await prisma.tipPool.findFirst({
      where: { id: poolId, tenantId },
    });
    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 });
    }
    if (pool.status === "CLOSED") {
      return NextResponse.json(
        { error: "Cannot re-distribute a closed pool" },
        { status: 409 }
      );
    }

    // Re-collect the contributor list from time-clock entries at
    // distribute time so admin edits (added shift, extended clock-out)
    // are picked up.
    const entries = await prisma.timeClockEntry.findMany({
      where: {
        locationId: pool.locationId,
        status: "CLOSED",
        clockedInAt: { lt: pool.periodEnd },
        clockedOutAt: { gt: pool.periodStart },
      },
      select: {
        membershipId: true,
        clockedInAt: true,
        clockedOutAt: true,
        breakMinutes: true,
        membership: { select: { role: true } },
      },
    });

    // Aggregate hours per member (clamped to the pool window)
    const memberMap = new Map<string, { role: string; hoursWorked: number }>();
    for (const e of entries) {
      const startMs = Math.max(
        e.clockedInAt.getTime(),
        pool.periodStart.getTime()
      );
      const endMs = Math.min(
        (e.clockedOutAt || pool.periodEnd).getTime(),
        pool.periodEnd.getTime()
      );
      if (endMs <= startMs) continue;
      const workedMinutes = Math.max(
        0,
        Math.round((endMs - startMs) / 60000) - (e.breakMinutes || 0)
      );
      const hours = workedMinutes / 60;
      const existing = memberMap.get(e.membershipId);
      if (existing) {
        existing.hoursWorked += hours;
      } else {
        memberMap.set(e.membershipId, {
          role: e.membership.role,
          hoursWorked: hours,
        });
      }
    }

    const contributors = Array.from(memberMap.entries()).map(
      ([membershipId, v]) => ({
        membershipId,
        role: v.role,
        hoursWorked: v.hoursWorked,
      })
    );

    const shares = distributeTips({
      poolAmount: pool.tipsCollected,
      rule: pool.rule,
      contributors,
      roleWeights: (pool.roleWeights as Record<string, number> | null) || undefined,
    });

    // Wipe old rows + write fresh set + flip status in one tx so the
    // pool never shows stale + partial data mid-recompute.
    await prisma.$transaction([
      prisma.tipDistribution.deleteMany({ where: { poolId } }),
      ...shares.map((s) =>
        prisma.tipDistribution.create({
          data: {
            poolId,
            membershipId: s.membershipId,
            hoursWorked: s.hoursWorked,
            role: s.role,
            weight: s.weight,
            shareAmount: s.shareAmount,
          },
        })
      ),
      prisma.tipPool.update({
        where: { id: poolId },
        data: { status: "DISTRIBUTED" },
      }),
    ]);

    return NextResponse.json({
      success: true,
      count: shares.length,
      totalDistributed: shares.reduce((s, x) => s + x.shareAmount, 0),
    });
  } catch (error: any) {
    console.error("[tip-pool distribute] error:", error);
    return NextResponse.json(
      { error: error?.message || "Distribute failed" },
      { status: 500 }
    );
  }
}
