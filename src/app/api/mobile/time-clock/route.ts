// /api/mobile/time-clock
//
// POST — clock in with optional { notes }.
// GET  — caller's recent entries (default last 30 days).
//
// Mirrors web POS pattern at /api/tenants/[tenantId]/time-clock. Auth
// scoped to the caller's own memberships — mobile is a self-serve
// time-clock. Manager cross-user view stays on web POS.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

function serializeEntry(e: any) {
  return {
    id: e.id,
    status: e.status,
    clockedInAt: e.clockedInAt,
    clockedOutAt: e.clockedOutAt,
    totalMinutes: e.totalMinutes,
    breakMinutes: e.breakMinutes,
    notes: e.notes,
    membershipId: e.membershipId,
    locationId: e.locationId,
  };
}

// -- POST — clock in --------------------------------------------------------

export async function POST(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const body = await request.json().catch(() => ({}));
  const notes =
    typeof body.notes === "string" && body.notes.trim().length > 0
      ? body.notes.trim().slice(0, 500)
      : null;

  // Guard: reject if this member is already clocked in (any non-CLOSED
  // entry across any location). Matches web POS 409.
  const existing = await prisma.timeClockEntry.findFirst({
    where: {
      membershipId: ctx.ctx.session.memberId,
      status: { in: ["ACTIVE", "ON_BREAK"] },
    },
    select: { id: true, status: true, clockedInAt: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: "You're already clocked in. Clock out first before starting a new shift.",
        code: "ALREADY_CLOCKED_IN",
        existingEntryId: existing.id,
      },
      { status: 409 }
    );
  }

  const entry = await prisma.timeClockEntry.create({
    data: {
      tenantId: ctx.ctx.tenantId,
      membershipId: ctx.ctx.session.memberId,
      locationId: ctx.ctx.locationId,
      status: "ACTIVE",
      notes,
    },
    select: {
      id: true, status: true, clockedInAt: true, clockedOutAt: true,
      totalMinutes: true, breakMinutes: true, notes: true,
      membershipId: true, locationId: true,
    },
  });

  return NextResponse.json({ entry: serializeEntry(entry) }, { status: 201 });
}

// -- GET — caller's recent entries ------------------------------------------

export async function GET(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  const rawDays = Number(url.searchParams.get("days") ?? 30);
  const days = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, rawDays)) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const entries = await prisma.timeClockEntry.findMany({
    where: {
      membershipId: ctx.ctx.session.memberId,
      clockedInAt: { gte: since },
    },
    orderBy: { clockedInAt: "desc" },
    take: 50,
    select: {
      id: true, status: true, clockedInAt: true, clockedOutAt: true,
      totalMinutes: true, breakMinutes: true, notes: true,
      membershipId: true, locationId: true,
    },
  });

  return NextResponse.json({
    entries: entries.map(serializeEntry),
    count: entries.length,
  });
}
