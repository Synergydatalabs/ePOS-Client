// POST /api/mobile/time-clock/[entryId]/clock-out
//
// Clock out an ACTIVE (or ON_BREAK) entry. Only the entry's owner can
// clock themselves out from mobile — managers use web POS.
//
// Body: { notes? }
//
// Stamps totalMinutes as `round((now - clockedInAt) / 60000)` — matches
// web POS's "nearest minute" convention. Break minutes stay whatever was
// stamped by the /break endpoints (mobile MVP doesn't use breaks, so it
// stays null / 0 unless the user opened a break via web POS).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { entryId } = await params;
  const body = await request.json().catch(() => ({}));
  const extraNotes =
    typeof body.notes === "string" && body.notes.trim().length > 0
      ? body.notes.trim().slice(0, 500)
      : null;

  const entry = await prisma.timeClockEntry.findFirst({
    where: {
      id: entryId,
      membershipId: ctx.ctx.session.memberId,
    },
    select: { id: true, status: true, clockedInAt: true, notes: true, breakMinutes: true },
  });
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  if (entry.status === "CLOSED") {
    return NextResponse.json(
      { error: "Already clocked out.", code: "ALREADY_CLOCKED_OUT" },
      { status: 409 }
    );
  }

  const now = new Date();
  const totalMinutes = Math.max(
    0,
    Math.round((now.getTime() - entry.clockedInAt.getTime()) / 60000)
  );
  const netMinutes = Math.max(0, totalMinutes - (entry.breakMinutes || 0));

  const mergedNotes = extraNotes
    ? entry.notes
      ? `${entry.notes}\n${extraNotes}`
      : extraNotes
    : entry.notes;

  const updated = await prisma.timeClockEntry.update({
    where: { id: entry.id },
    data: {
      status: "CLOSED",
      clockedOutAt: now,
      totalMinutes: netMinutes,
      notes: mergedNotes,
    },
    select: {
      id: true, status: true, clockedInAt: true, clockedOutAt: true,
      totalMinutes: true, breakMinutes: true, notes: true,
      membershipId: true, locationId: true,
    },
  });

  return NextResponse.json({ entry: updated });
}
