// POST /api/tenants/[tenantId]/cash-drawer/[sessionId]/close
//   Close the session with a physical count. Records the count, computes
//   variance vs expected, and stamps status = CLOSED.
//   Body: { closingCount, note? }

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; sessionId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, sessionId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { closingCount, note } = body as {
      closingCount?: number;
      note?: string;
    };

    if (typeof closingCount !== "number" || closingCount < 0) {
      return NextResponse.json(
        { error: "closingCount (cents) is required and must be >= 0" },
        { status: 400 }
      );
    }

    const session = await prisma.cashDrawerSession.findFirst({
      where: { id: sessionId, tenantId },
      include: {
        movements: { select: { amount: true } },
      },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.status !== "OPEN") {
      return NextResponse.json(
        { error: "Session is already closed" },
        { status: 409 }
      );
    }

    const expectedCash = session.movements.reduce((s, m) => s + m.amount, 0);
    const variance = closingCount - expectedCash;

    const updated = await prisma.$transaction(async (tx) => {
      // Record a CLOSING movement iff the variance is non-zero so the
      // ledger reconciles to the physical count.
      if (variance !== 0) {
        await tx.cashMovement.create({
          data: {
            sessionId,
            type: "CLOSING",
            amount: variance, // signed: + over, - short
            reason: variance > 0 ? "Overage at close" : "Shortage at close",
            performedById: auth.context.membership.id,
          },
        });
      }

      return tx.cashDrawerSession.update({
        where: { id: sessionId },
        data: {
          status: "CLOSED",
          closingCount,
          expectedCash,
          variance,
          closingNote: note || null,
          closedById: auth.context.membership.id,
          closedAt: new Date(),
        },
      });
    });

    return NextResponse.json({ success: true, session: updated });
  } catch (error: any) {
    console.error("[cash-drawer close] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to close session" },
      { status: 500 }
    );
  }
}
