// GET /api/tenants/[tenantId]/tip-pools/[poolId]
//   Detail with distributions + eligible members (from TimeClockEntry).
//
// PATCH /api/tenants/[tenantId]/tip-pools/[poolId]
//   Edit rule / tipsCollected / notes / roleWeights while pool is
//   OPEN or DISTRIBUTED. Locked once CLOSED.
//
// DELETE /api/tenants/[tenantId]/tip-pools/[poolId]
//   Discard a pool (any status) — cascade drops distributions.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; poolId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, poolId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const pool = await prisma.tipPool.findFirst({
      where: { id: poolId, tenantId },
      include: {
        location: { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true, email: true } },
        closedBy: { select: { firstName: true, lastName: true, email: true } },
        distributions: {
          include: {
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
          orderBy: { shareAmount: "desc" },
        },
      },
    });

    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 });
    }

    // Eligible members = closed TimeClockEntry rows for this location that
    // overlap the pool period. Used as the distribution candidate list
    // before /distribute is called.
    const entries = await prisma.timeClockEntry.findMany({
      where: {
        locationId: pool.locationId,
        status: "CLOSED",
        // Overlap: entry starts before pool ends AND ends after pool starts
        clockedInAt: { lt: pool.periodEnd },
        clockedOutAt: { gt: pool.periodStart },
      },
      select: {
        id: true,
        membershipId: true,
        clockedInAt: true,
        clockedOutAt: true,
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

    // Aggregate hours per member — clamp entries to the pool window so
    // shifts that span outside the pool don't over-count.
    const memberMap = new Map<
      string,
      {
        membershipId: string;
        firstName?: string | null;
        lastName?: string | null;
        email?: string | null;
        role: string;
        hoursWorked: number;
      }
    >();
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
      const key = e.membershipId;
      const existing = memberMap.get(key);
      if (existing) {
        existing.hoursWorked += hours;
      } else {
        memberMap.set(key, {
          membershipId: e.membershipId,
          firstName: e.membership.firstName,
          lastName: e.membership.lastName,
          email: e.membership.email,
          role: e.membership.role,
          hoursWorked: hours,
        });
      }
    }
    const eligibleMembers = Array.from(memberMap.values()).map((m) => ({
      ...m,
      hoursWorked: Number(m.hoursWorked.toFixed(2)),
    }));

    return NextResponse.json({ success: true, pool, eligibleMembers });
  } catch (error: any) {
    console.error("[tip-pool detail] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, poolId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const pool = await prisma.tipPool.findFirst({
      where: { id: poolId, tenantId },
      select: { id: true, status: true },
    });
    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 });
    }
    if (pool.status === "CLOSED") {
      return NextResponse.json(
        { error: "Cannot edit a closed pool" },
        { status: 409 }
      );
    }

    const body = await request.json();
    const { rule, tipsCollected, notes, roleWeights } = body as {
      rule?: "BY_HOURS" | "EVENLY" | "BY_ROLE";
      tipsCollected?: number;
      notes?: string;
      roleWeights?: Record<string, number> | null;
    };

    const updated = await prisma.tipPool.update({
      where: { id: poolId },
      data: {
        ...(rule !== undefined && { rule }),
        ...(tipsCollected !== undefined &&
          typeof tipsCollected === "number" &&
          tipsCollected >= 0 && { tipsCollected }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(roleWeights !== undefined && { roleWeights: roleWeights || undefined }),
      },
    });

    return NextResponse.json({ success: true, pool: updated });
  } catch (error: any) {
    console.error("[tip-pool PATCH] error:", error);
    return NextResponse.json(
      { error: error?.message || "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, poolId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    await prisma.tipPool.delete({ where: { id: poolId } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[tip-pool DELETE] error:", error);
    return NextResponse.json(
      { error: error?.message || "Delete failed" },
      { status: 500 }
    );
  }
}
