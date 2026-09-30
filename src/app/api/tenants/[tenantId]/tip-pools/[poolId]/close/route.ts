// POST /api/tenants/[tenantId]/tip-pools/[poolId]/close
//   Lock the pool. Must have status = DISTRIBUTED (i.e. shares have been
//   computed). Once CLOSED the pool + distributions are immutable —
//   admin can only DELETE to start over.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; poolId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, poolId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const pool = await prisma.tipPool.findFirst({
      where: { id: poolId, tenantId },
      include: { _count: { select: { distributions: true } } },
    });
    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 });
    }
    if (pool.status === "CLOSED") {
      return NextResponse.json(
        { error: "Pool is already closed" },
        { status: 409 }
      );
    }
    if (pool._count.distributions === 0) {
      return NextResponse.json(
        { error: "Distribute before closing" },
        { status: 400 }
      );
    }

    const updated = await prisma.tipPool.update({
      where: { id: poolId },
      data: {
        status: "CLOSED",
        closedById: auth.context.membership.id,
        closedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, pool: updated });
  } catch (error: any) {
    console.error("[tip-pool close] error:", error);
    return NextResponse.json(
      { error: error?.message || "Close failed" },
      { status: 500 }
    );
  }
}
