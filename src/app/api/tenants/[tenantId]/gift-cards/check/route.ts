// POST /api/tenants/[tenantId]/gift-cards/check
//   Body: { code: string }
//   Used by the POS to look up a card by code before applying it to an
//   order, and by the public balance-check page.
//
// This endpoint intentionally does NOT require auth so customers can check
// their balance from the public /gift-card page without signing in. It
// returns the bare minimum (balance + status) — never the recipient email
// or the sender name.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizeGiftCardCode } from "@/lib/gift-card-code";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const raw = String(body?.code || "").trim();
    if (!raw) {
      return NextResponse.json(
        { error: "Gift card code is required" },
        { status: 400 }
      );
    }

    const code = normalizeGiftCardCode(raw);

    const card = await prisma.giftCard.findFirst({
      where: { tenantId, code },
      select: {
        id: true,
        code: true,
        status: true,
        balance: true,
        currency: true,
        expiresAt: true,
      },
    });

    if (!card) {
      // Deliberately vague — don't leak whether a code has ever existed
      return NextResponse.json(
        { success: false, error: "Card not found or invalid" },
        { status: 404 }
      );
    }

    // If the card's status is still ACTIVE but the expiry has passed,
    // treat this lookup as the moment we notice — flip status now.
    let status = card.status;
    if (
      status === "ACTIVE" &&
      card.expiresAt &&
      new Date(card.expiresAt) < new Date()
    ) {
      await prisma.giftCard.update({
        where: { id: card.id },
        data: { status: "EXPIRED" },
      });
      status = "EXPIRED";
    }

    return NextResponse.json({
      success: true,
      card: {
        id: card.id,
        code: card.code,
        status,
        balance: card.balance,
        currency: card.currency,
        expiresAt: card.expiresAt,
        redeemable: status === "ACTIVE" && card.balance > 0,
      },
    });
  } catch (error: any) {
    console.error("[gift-card check] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to check card balance" },
      { status: 500 }
    );
  }
}
