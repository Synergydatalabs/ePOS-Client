// POST /api/tenants/[tenantId]/cash-drawer/[sessionId]/movement
//   Record a manual cash movement (PAYOUT / PAYIN / DROP).
//   Body: { type, amount, reason? }
//   `amount` is unsigned cents; the server sets the sign from `type`
//   (PAYOUT/DROP are negative, PAYIN is positive).
//
// PAYMENT / REFUND rows are created automatically by the payment endpoint
// when the drawer is open — never sent here.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; sessionId: string }> };

const ALLOWED_TYPES = ["PAYOUT", "PAYIN", "DROP"] as const;

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, sessionId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { type, amount, reason } = body as {
      type?: string;
      amount?: number;
      reason?: string;
    };

    if (!type || !ALLOWED_TYPES.includes(type as any)) {
      return NextResponse.json(
        { error: `type must be one of ${ALLOWED_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "amount (cents) must be > 0" },
        { status: 400 }
      );
    }

    const session = await prisma.cashDrawerSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true, status: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.status !== "OPEN") {
      return NextResponse.json(
        { error: "Drawer session is already closed" },
        { status: 409 }
      );
    }

    const signedAmount = type === "PAYIN" ? amount : -amount;

    const movement = await prisma.cashMovement.create({
      data: {
        sessionId,
        type: type as any,
        amount: signedAmount,
        reason: reason || null,
        performedById: auth.context.membership.id,
      },
    });

    return NextResponse.json({ success: true, movement });
  } catch (error: any) {
    console.error("[cash-drawer movement] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to record movement" },
      { status: 500 }
    );
  }
}
