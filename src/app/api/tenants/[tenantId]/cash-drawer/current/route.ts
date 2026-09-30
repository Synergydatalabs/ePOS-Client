// GET /api/tenants/[tenantId]/cash-drawer/current
//   Returns the current OPEN drawer session for the (location, terminal)
//   combination if any exists. Used by the POS toolbar to render the
//   "Drawer open" pill and by the cash-payment path to attach movements.
//
// Query: ?locationId=<uuid>&terminalId=<uuid>
//   terminalId may be omitted — will match a session opened without a
//   specific terminal.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");
    const terminalId = searchParams.get("terminalId");

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required" },
        { status: 400 }
      );
    }

    // Look for an OPEN session at this location. Prefer an exact terminal
    // match if the caller passed a terminalId; otherwise fall back to a
    // location-wide (terminal-null) session.
    const session = await prisma.cashDrawerSession.findFirst({
      where: {
        tenantId,
        locationId,
        status: "OPEN",
        ...(terminalId ? { terminalId } : {}),
      },
      include: {
        openedBy: { select: { firstName: true, lastName: true, email: true } },
        movements: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            amount: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ success: true, session: null });
    }

    // Sum all movements so the caller can show the expected cash inline
    // without another round-trip. Movements are signed, so a simple sum works.
    const allMovements = await prisma.cashMovement.findMany({
      where: { sessionId: session.id },
      select: { amount: true },
    });
    const expectedCash = allMovements.reduce((s, m) => s + m.amount, 0);

    return NextResponse.json({
      success: true,
      session: { ...session, expectedCash },
    });
  } catch (error: any) {
    console.error("[cash-drawer current] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load session" },
      { status: 500 }
    );
  }
}
