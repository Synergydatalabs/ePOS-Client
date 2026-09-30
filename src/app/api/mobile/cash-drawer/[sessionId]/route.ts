// GET /api/mobile/cash-drawer/[sessionId]
//
// Session detail + movements + totals block. Powers the CashDrawerScreen's
// movements list and the close-out summary.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { sessionId } = await params;

  const session = await prisma.cashDrawerSession.findFirst({
    where: {
      id: sessionId,
      tenantId: ctx.ctx.tenantId,
      locationId: ctx.ctx.locationId,
    },
    include: {
      movements: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          amount: true,
          reason: true,
          orderId: true,
          paymentId: true,
          performedById: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Roll up totals by direction + by type for the close-out summary.
  let inTotal = 0;
  let outTotal = 0;
  const byType: Record<string, number> = {};
  for (const m of session.movements) {
    if (m.amount >= 0) inTotal += m.amount;
    else outTotal += m.amount;
    byType[m.type] = (byType[m.type] || 0) + m.amount;
  }

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
    movements: session.movements,
    totals: {
      total: inTotal + outTotal,
      in: inTotal,
      out: outTotal,
      byType,
    },
  });
}
