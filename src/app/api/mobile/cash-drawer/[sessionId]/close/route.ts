// POST /api/mobile/cash-drawer/[sessionId]/close
//
// Close the drawer. Server sums all movements to compute expectedCash,
// subtracts from the operator-entered closingCount to derive variance,
// and (when variance ≠ 0) writes an offsetting CLOSING movement so the
// ledger always reconciles to the physical count.
//
// Body: { closingCount, note? }
//   closingCount — physical cash count in cents
//   note         — optional close-out comment
//
// Response: { session, expectedCash, variance }
//
// Non-zero variance is always accepted (matches web POS). Reason line
// on the CLOSING movement flags it as overage/shortage for the audit
// trail.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const rawCount = Number(body.closingCount);
  if (!Number.isFinite(rawCount) || rawCount < 0) {
    return NextResponse.json(
      { error: "closingCount must be a non-negative integer (cents)" },
      { status: 400 }
    );
  }
  const closingCount = Math.floor(rawCount);
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, 250)
      : null;

  const session = await prisma.cashDrawerSession.findFirst({
    where: {
      id: sessionId,
      tenantId: ctx.ctx.tenantId,
      locationId: ctx.ctx.locationId,
    },
    select: { id: true, status: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "CLOSED") {
    return NextResponse.json({ error: "Session is already closed." }, { status: 409 });
  }

  // Sum ALL movements (OPENING + PAYMENT + REFUND + PAYIN + PAYOUT + DROP)
  // to derive expectedCash. Signed sum already handles direction.
  const movements = await prisma.cashMovement.findMany({
    where: { sessionId: session.id },
    select: { amount: true },
  });
  const expectedCash = movements.reduce((s, m) => s + m.amount, 0);
  const variance = closingCount - expectedCash;

  const closed = await prisma.$transaction(async (tx) => {
    // Offsetting CLOSING row so the ledger sum equals the physical count.
    if (variance !== 0) {
      await tx.cashMovement.create({
        data: {
          sessionId: session.id,
          type: "CLOSING",
          amount: variance,
          performedById: ctx.ctx.session.memberId,
          reason: variance > 0 ? "Overage at close" : "Shortage at close",
        },
      });
    }

    return tx.cashDrawerSession.update({
      where: { id: session.id },
      data: {
        status: "CLOSED",
        closingCount,
        expectedCash,
        variance,
        closingNote: note,
        closedById: ctx.ctx.session.memberId,
        closedAt: new Date(),
      },
      select: {
        id: true, status: true, openingFloat: true, openingNote: true,
        openedAt: true, openedById: true, closingCount: true, expectedCash: true,
        variance: true, closingNote: true, closedAt: true, closedById: true, terminalId: true,
      },
    });
  });

  return NextResponse.json({
    session: closed,
    expectedCash,
    variance,
  });
}
