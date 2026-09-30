// POST /api/mobile/cash-drawer/[sessionId]/movement
//
// Manual movement — PAYIN, PAYOUT, or DROP. Client sends UNSIGNED amount
// (positive cents); server signs it based on type:
//   PAYIN  → positive  (cash going into the drawer, e.g. change added)
//   PAYOUT → negative  (cash removed for a legit business expense)
//   DROP   → negative  (cash moved to safe / bank deposit)
//
// PAYMENT and REFUND movements are written by the order/payment/refund
// routes, NOT here — this endpoint rejects those types to prevent
// double-counting.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

const MANUAL_TYPES = new Set(["PAYIN", "PAYOUT", "DROP"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const type = typeof body.type === "string" ? body.type.toUpperCase() : "";
  const rawAmount = Number(body.amount);
  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 250)
      : null;

  if (!MANUAL_TYPES.has(type)) {
    return NextResponse.json(
      { error: "type must be one of PAYIN, PAYOUT, DROP" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive integer (cents)" },
      { status: 400 }
    );
  }
  const amount = Math.floor(rawAmount);

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
  if (session.status !== "OPEN") {
    return NextResponse.json(
      { error: "Session is closed — reopen a new drawer to log movements." },
      { status: 409 }
    );
  }

  // Sign the amount: PAYIN positive, PAYOUT/DROP negative.
  const signedAmount = type === "PAYIN" ? amount : -amount;

  const movement = await prisma.cashMovement.create({
    data: {
      sessionId: session.id,
      type: type as any,
      amount: signedAmount,
      reason,
      performedById: ctx.ctx.session.memberId,
    },
    select: { id: true, type: true, amount: true, reason: true, createdAt: true },
  });

  return NextResponse.json({ ok: true, movement }, { status: 201 });
}
