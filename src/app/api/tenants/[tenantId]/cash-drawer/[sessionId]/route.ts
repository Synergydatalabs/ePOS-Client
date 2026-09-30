// GET /api/tenants/[tenantId]/cash-drawer/[sessionId]
//   Full detail: session + all movements + running expectedCash.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; sessionId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, sessionId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const session = await prisma.cashDrawerSession.findFirst({
      where: { id: sessionId, tenantId },
      include: {
        openedBy: { select: { firstName: true, lastName: true, email: true } },
        closedBy: { select: { firstName: true, lastName: true, email: true } },
        location: { select: { id: true, name: true } },
        terminal: { select: { id: true, name: true } },
        movements: {
          orderBy: { createdAt: "desc" },
          include: {
            performedBy: {
              select: { firstName: true, lastName: true, email: true },
            },
            order: {
              select: { id: true, orderNumber: true, displayNumber: true },
            },
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Break the movement total down by type so the UI can show a proper
    // "In / Out" breakdown without recomputing on the client.
    const totals = session.movements.reduce(
      (acc, m) => {
        acc.total += m.amount;
        if (m.amount > 0) acc.in += m.amount;
        else acc.out += -m.amount;
        acc.byType[m.type] = (acc.byType[m.type] || 0) + m.amount;
        return acc;
      },
      {
        total: 0,
        in: 0,
        out: 0,
        byType: {} as Record<string, number>,
      }
    );

    return NextResponse.json({
      success: true,
      session: { ...session, totals, expectedCash: totals.total },
    });
  } catch (error: any) {
    console.error("[cash-drawer detail] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load session" },
      { status: 500 }
    );
  }
}
