// POST /api/tenants/[tenantId]/cash-drawer
//   Open a new drawer session.
//   Body: { locationId, terminalId?, openingFloat, note? }
//   Rejects if a session is already OPEN for that (location, terminal).
//
// GET  /api/tenants/[tenantId]/cash-drawer
//   List sessions. Query: ?status=OPEN&locationId=<uuid>&days=30
//   Includes running summary rows (movement totals) for the list view.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { locationId, terminalId, openingFloat, note } = body as {
      locationId?: string;
      terminalId?: string | null;
      openingFloat?: number;
      note?: string;
    };

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required" },
        { status: 400 }
      );
    }
    if (typeof openingFloat !== "number" || openingFloat < 0) {
      return NextResponse.json(
        { error: "openingFloat (cents) is required and must be >= 0" },
        { status: 400 }
      );
    }

    // Reject if there's already an OPEN session for this (location, terminal)
    const existing = await prisma.cashDrawerSession.findFirst({
      where: {
        tenantId,
        locationId,
        terminalId: terminalId || null,
        status: "OPEN",
      },
      select: { id: true, openedAt: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "A drawer session is already open for this register",
          sessionId: existing.id,
          openedAt: existing.openedAt,
        },
        { status: 409 }
      );
    }

    const session = await prisma.cashDrawerSession.create({
      data: {
        tenantId,
        locationId,
        terminalId: terminalId || null,
        openingFloat,
        openingNote: note || null,
        openedById: auth.context.membership.id,
        movements: {
          create: {
            type: "OPENING",
            amount: openingFloat,
            performedById: auth.context.membership.id,
            reason: note || "Opening float",
          },
        },
      },
      include: { openedBy: { select: { firstName: true, lastName: true, email: true } } },
    });

    return NextResponse.json({ success: true, session });
  } catch (error: any) {
    console.error("[cash-drawer POST] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to open drawer", code: error?.code },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as "OPEN" | "CLOSED" | null;
    const locationId = searchParams.get("locationId") || undefined;
    const daysParam = parseInt(searchParams.get("days") || "30", 10);
    const days = Math.max(1, Math.min(365, isNaN(daysParam) ? 30 : daysParam));

    const since = new Date();
    since.setDate(since.getDate() - days);

    const sessions = await prisma.cashDrawerSession.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(locationId ? { locationId } : {}),
        openedAt: { gte: since },
      },
      orderBy: { openedAt: "desc" },
      include: {
        openedBy: { select: { firstName: true, lastName: true, email: true } },
        closedBy: { select: { firstName: true, lastName: true, email: true } },
        location: { select: { id: true, name: true } },
        terminal: { select: { id: true, name: true } },
        _count: { select: { movements: true } },
      },
    });

    return NextResponse.json({ success: true, sessions });
  } catch (error: any) {
    console.error("[cash-drawer GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load sessions" },
      { status: 500 }
    );
  }
}
