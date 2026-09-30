// /api/mobile/cash-drawer
//
// GET  — list recent sessions at this location (default last 30 days).
// POST — open a fresh session with { openingFloat, note?, terminalId? }.
//
// Mirrors web POS pattern at /api/tenants/[tenantId]/cash-drawer/route.ts:
//   - openingFloat is cents (Int)
//   - Auto-creates the OPENING movement so `expectedCash = sum(movements)`
//     holds from the very first read
//   - 409 if a session is already OPEN at this (location, terminalId) slot
//
// Mobile MVP scopes to one session per location (terminalId=null) because
// the mobile app doesn't yet ship a terminal picker. Web can still open
// per-terminal sessions and they won't conflict — mobile just picks the
// terminal-null slot.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

function serializeSession(s: any) {
  return {
    id: s.id,
    status: s.status,
    openingFloat: s.openingFloat,
    openingNote: s.openingNote,
    openedAt: s.openedAt,
    openedById: s.openedById,
    closingCount: s.closingCount,
    expectedCash: s.expectedCash,
    variance: s.variance,
    closingNote: s.closingNote,
    closedAt: s.closedAt,
    closedById: s.closedById,
    terminalId: s.terminalId,
  };
}

// -- POST — open ------------------------------------------------------------

export async function POST(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const body = await request.json().catch(() => ({}));
  const rawFloat = Number(body.openingFloat);
  if (!Number.isFinite(rawFloat) || rawFloat < 0) {
    return NextResponse.json(
      { error: "openingFloat must be a non-negative integer (cents)" },
      { status: 400 }
    );
  }
  const openingFloat = Math.floor(rawFloat);
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 250) : null;
  const terminalId = typeof body.terminalId === "string" && body.terminalId ? body.terminalId : null;

  // Guard: no duplicate open sessions on this (location, terminal) slot.
  // Matches web POS route.ts:44-52.
  const existing = await prisma.cashDrawerSession.findFirst({
    where: {
      tenantId: ctx.ctx.tenantId,
      locationId: ctx.ctx.locationId,
      terminalId: terminalId,
      status: "OPEN",
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: "A drawer session is already open — close it before opening another.",
        code: "SESSION_ALREADY_OPEN",
        existingSessionId: existing.id,
      },
      { status: 409 }
    );
  }

  const session = await prisma.cashDrawerSession.create({
    data: {
      tenantId: ctx.ctx.tenantId,
      locationId: ctx.ctx.locationId,
      terminalId: terminalId,
      status: "OPEN",
      openingFloat,
      openingNote: note,
      openedById: ctx.ctx.session.memberId,
      // Book-keeping row so expectedCash = sum(movements) works from moment one.
      movements: {
        create: {
          type: "OPENING",
          amount: openingFloat,
          performedById: ctx.ctx.session.memberId,
          reason: "Opening float",
        },
      },
    },
    select: {
      id: true, status: true, openingFloat: true, openingNote: true,
      openedAt: true, openedById: true, closingCount: true, expectedCash: true,
      variance: true, closingNote: true, closedAt: true, closedById: true, terminalId: true,
    },
  });

  return NextResponse.json({ session: serializeSession(session) }, { status: 201 });
}

// -- GET — list -------------------------------------------------------------

export async function GET(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.toUpperCase();
  const rawDays = Number(url.searchParams.get("days") ?? 30);
  const days = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, rawDays)) : 30;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const where: any = {
    tenantId: ctx.ctx.tenantId,
    locationId: ctx.ctx.locationId,
    openedAt: { gte: since },
  };
  if (status === "OPEN" || status === "CLOSED") {
    where.status = status;
  }

  const sessions = await prisma.cashDrawerSession.findMany({
    where,
    orderBy: { openedAt: "desc" },
    take: 50,
    select: {
      id: true, status: true, openingFloat: true, openingNote: true,
      openedAt: true, openedById: true, closingCount: true, expectedCash: true,
      variance: true, closingNote: true, closedAt: true, closedById: true, terminalId: true,
    },
  });

  return NextResponse.json({
    sessions: sessions.map(serializeSession),
    count: sessions.length,
  });
}
