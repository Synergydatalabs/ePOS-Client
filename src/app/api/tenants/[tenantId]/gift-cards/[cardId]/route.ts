// GET /api/tenants/[tenantId]/gift-cards/[cardId]
//   Full detail including transaction ledger.
//
// PATCH /api/tenants/[tenantId]/gift-cards/[cardId]
//   Body: { action: "cancel", reason? } to void a card and zero the balance.
//   Only ACTIVE cards can be cancelled; a CANCEL ledger entry is written.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; cardId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, cardId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const card = await prisma.giftCard.findFirst({
      where: { id: cardId, tenantId },
      include: {
        issuedBy: {
          select: { firstName: true, lastName: true, email: true },
        },
        transactions: {
          orderBy: { createdAt: "desc" },
          include: {
            order: {
              select: { id: true, orderNumber: true, displayNumber: true },
            },
          },
        },
      },
    });

    if (!card) {
      return NextResponse.json({ error: "Gift card not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, card });
  } catch (error: any) {
    console.error("[gift-card GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load gift card" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, cardId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { action, reason } = body as { action?: string; reason?: string };

    if (action !== "cancel") {
      return NextResponse.json(
        { error: "Only 'cancel' action is supported" },
        { status: 400 }
      );
    }

    const card = await prisma.giftCard.findFirst({
      where: { id: cardId, tenantId },
    });
    if (!card) {
      return NextResponse.json({ error: "Gift card not found" }, { status: 404 });
    }
    if (card.status !== "ACTIVE") {
      return NextResponse.json(
        { error: `Cannot cancel a ${card.status.toLowerCase()} card` },
        { status: 400 }
      );
    }

    // Zero the balance and log a CANCEL entry with the (negative) delta so
    // outstanding-liability reports drop it immediately.
    const debit = -card.balance;
    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.giftCard.update({
        where: { id: card.id },
        data: {
          status: "CANCELLED",
          balance: 0,
          cancelledAt: new Date(),
          cancelledReason: reason || null,
        },
      });
      await tx.giftCardTransaction.create({
        data: {
          giftCardId: card.id,
          type: "CANCEL",
          amount: debit,
          balanceAfter: 0,
          notes: reason || "Cancelled by admin",
          performedById: auth.context.membership.id,
        },
      });
      return c;
    });

    return NextResponse.json({ success: true, card: updated });
  } catch (error: any) {
    console.error("[gift-card PATCH] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to update gift card" },
      { status: 500 }
    );
  }
}
