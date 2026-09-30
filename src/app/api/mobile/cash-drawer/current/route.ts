// GET /api/mobile/cash-drawer/current
//
// Returns the active drawer session for the caller's location (with
// `expectedCash` computed live from movements so the mobile UI doesn't
// have to sum on-device).
//
// Response:
//   { session: {...} | null, expectedCash: number, movementCount: number }
//
// Matches web POS current route logic: prefer exact terminalId match,
// else fall back to a null-terminal session (single-drawer stores).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  const terminalId =
    typeof url.searchParams.get("terminalId") === "string" &&
    url.searchParams.get("terminalId")
      ? (url.searchParams.get("terminalId") as string)
      : null;

  // Prefer terminal-matched session, then fall back to a terminal-null
  // session (the common single-drawer setup).
  let session = terminalId
    ? await prisma.cashDrawerSession.findFirst({
        where: {
          tenantId: ctx.ctx.tenantId,
          locationId: ctx.ctx.locationId,
          terminalId,
          status: "OPEN",
        },
      })
    : null;

  if (!session) {
    session = await prisma.cashDrawerSession.findFirst({
      where: {
        tenantId: ctx.ctx.tenantId,
        locationId: ctx.ctx.locationId,
        terminalId: null,
        status: "OPEN",
      },
    });
  }

  if (!session) {
    return NextResponse.json({ session: null, expectedCash: 0, movementCount: 0 });
  }

  const movements = await prisma.cashMovement.findMany({
    where: { sessionId: session.id },
    select: { amount: true },
  });
  const expectedCash = movements.reduce((s, m) => s + m.amount, 0);

  return NextResponse.json({
    session: {
      id: session.id,
      status: session.status,
      openingFloat: session.openingFloat,
      openingNote: session.openingNote,
      openedAt: session.openedAt,
      openedById: session.openedById,
      closingCount: session.closingCount,
      expectedCash: session.expectedCash,
      variance: session.variance,
      closingNote: session.closingNote,
      closedAt: session.closedAt,
      closedById: session.closedById,
      terminalId: session.terminalId,
    },
    expectedCash,
    movementCount: movements.length,
  });
}
