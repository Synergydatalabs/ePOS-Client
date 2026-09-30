// POST /api/tenants/[tenantId]/time-clock
//   Clock in. Body: { locationId, notes? }
//   Rejects with 409 if the caller already has an open entry.
//
// GET  /api/tenants/[tenantId]/time-clock
//   List entries — admins see all, staff only see their own.
//   Query: ?membershipId=<uuid>&status=CLOSED&days=30&locationId=<uuid>

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json().catch(() => ({}));
    const { locationId, notes } = body as {
      locationId?: string;
      notes?: string;
    };

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required" },
        { status: 400 }
      );
    }

    const existing = await prisma.timeClockEntry.findFirst({
      where: {
        membershipId: auth.context.membership.id,
        status: { not: "CLOSED" },
      },
      select: { id: true, clockedInAt: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "You already have an open shift",
          entryId: existing.id,
          clockedInAt: existing.clockedInAt,
        },
        { status: 409 }
      );
    }

    const entry = await prisma.timeClockEntry.create({
      data: {
        tenantId,
        membershipId: auth.context.membership.id,
        locationId,
        notes: notes || null,
      },
    });

    return NextResponse.json({ success: true, entry });
  } catch (error: any) {
    console.error("[time-clock POST] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to clock in", code: error?.code },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as
      | "ACTIVE"
      | "ON_BREAK"
      | "CLOSED"
      | null;
    const requestedMember = searchParams.get("membershipId") || undefined;
    const locationId = searchParams.get("locationId") || undefined;
    const daysParam = parseInt(searchParams.get("days") || "30", 10);
    const days = Math.max(1, Math.min(365, isNaN(daysParam) ? 30 : daysParam));

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Staff can only view their own timesheets; managers+ see all. Role
    // level >= 60 (POS_MANAGER) can filter by any membership.
    const isManager = ["POS_MANAGER", "POS_ADMIN", "TENANT_OWNER"].includes(
      auth.context.membership.role
    );
    const membershipFilter = isManager
      ? requestedMember
      : auth.context.membership.id;

    const entries = await prisma.timeClockEntry.findMany({
      where: {
        tenantId,
        ...(membershipFilter ? { membershipId: membershipFilter } : {}),
        ...(status ? { status } : {}),
        ...(locationId ? { locationId } : {}),
        clockedInAt: { gte: since },
      },
      orderBy: { clockedInAt: "desc" },
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
        location: { select: { id: true, name: true } },
        breaks: {
          orderBy: { startedAt: "asc" },
        },
      },
    });

    return NextResponse.json({ success: true, entries });
  } catch (error: any) {
    console.error("[time-clock GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load entries" },
      { status: 500 }
    );
  }
}
