// POST /api/tenants/[tenantId]/tip-pools
//   Create a new draft pool for a (location, period). Auto-collects the
//   tip total from Order.tipAmount for orders paid in the window. Does
//   NOT compute distributions yet — call /distribute for that so the
//   admin can review inputs first.
//   Body: { locationId, periodStart, periodEnd, rule?, notes? }
//
// GET /api/tenants/[tenantId]/tip-pools?locationId=&status=&days=30
//   List recent pools with distribution counts + summary.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const {
      locationId,
      periodStart,
      periodEnd,
      rule = "BY_HOURS",
      notes,
      roleWeights,
    } = body as {
      locationId?: string;
      periodStart?: string;
      periodEnd?: string;
      rule?: "BY_HOURS" | "EVENLY" | "BY_ROLE";
      notes?: string;
      roleWeights?: Record<string, number>;
    };

    if (!locationId || !periodStart || !periodEnd) {
      return NextResponse.json(
        { error: "locationId, periodStart and periodEnd are required" },
        { status: 400 }
      );
    }
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return NextResponse.json(
        { error: "periodEnd must be after periodStart" },
        { status: 400 }
      );
    }

    // Sum tipAmount across paid orders in the window. Only COMPLETED
    // paymentStatus counts — partial/refunded orders are excluded until
    // the merchant asks otherwise.
    const tipAgg = await prisma.order.aggregate({
      where: {
        locationId,
        location: { tenantId },
        paymentStatus: "COMPLETED",
        status: { not: "CANCELLED" },
        // Use paidAt if available, fall back to createdAt to avoid
        // missing orders on tenants that haven't populated paidAt yet
        createdAt: { gte: start, lt: end },
      },
      _sum: { tipAmount: true },
    });
    const tipsCollected = tipAgg._sum.tipAmount || 0;

    const pool = await prisma.tipPool.create({
      data: {
        tenantId,
        locationId,
        periodStart: start,
        periodEnd: end,
        rule,
        tipsCollected,
        roleWeights: rule === "BY_ROLE" && roleWeights ? roleWeights : undefined,
        notes: notes || null,
        createdById: auth.context.membership.id,
      },
    });

    return NextResponse.json({ success: true, pool });
  } catch (error: any) {
    console.error("[tip-pools POST] error:", error);
    return NextResponse.json(
      { error: error?.message || "Create failed", code: error?.code },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as
      | "OPEN"
      | "DISTRIBUTED"
      | "CLOSED"
      | null;
    const locationId = searchParams.get("locationId") || undefined;
    const days = Math.max(
      1,
      Math.min(365, parseInt(searchParams.get("days") || "30", 10) || 30)
    );
    const since = new Date();
    since.setDate(since.getDate() - days);

    const pools = await prisma.tipPool.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(locationId ? { locationId } : {}),
        periodStart: { gte: since },
      },
      orderBy: { periodStart: "desc" },
      include: {
        location: { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { distributions: true } },
      },
    });

    return NextResponse.json({ success: true, pools });
  } catch (error: any) {
    console.error("[tip-pools GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load" },
      { status: 500 }
    );
  }
}
