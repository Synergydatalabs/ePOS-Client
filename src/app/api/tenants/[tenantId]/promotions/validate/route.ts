// POST /api/tenants/[tenantId]/promotions/validate
//   Body: { code: string, cartSubtotal?: number, guestCount?: number }
//   Checks if a promo code is redeemable RIGHT NOW for the given cart and
//   returns the discount details + computed discount amount so the POS can
//   show it in the totals without a round-trip to compute again.
//
// Reasons a validate can fail:
//   - unknown code
//   - inactive / not-yet-started / expired
//   - outside its allowed hour/day window
//   - usage limit hit
//   - cart below minCartValue
//   - guest count below minGuestCount (dine-in table size)
//   - BOGO / FREE_ITEM (not supported at POS yet — surface as unsupported)

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
    const codeRaw = String(body?.code || "").trim();
    if (!codeRaw) {
      return NextResponse.json({ valid: false, error: "Code is required" }, { status: 400 });
    }
    const cartSubtotal =
      typeof body?.cartSubtotal === "number" ? body.cartSubtotal : 0;
    const guestCount =
      typeof body?.guestCount === "number" ? body.guestCount : 0;

    // Case-insensitive lookup — merchants tend to make codes CAPS but
    // customers type them lowercase.
    const promotion = await prisma.promotion.findFirst({
      where: {
        tenantId,
        code: { equals: codeRaw, mode: "insensitive" },
      },
    });

    if (!promotion) {
      return NextResponse.json(
        { valid: false, error: "Code not found" },
        { status: 404 }
      );
    }
    if (!promotion.isActive) {
      return NextResponse.json({ valid: false, error: "This code is inactive" });
    }
    const now = new Date();
    if (promotion.startDate && now < promotion.startDate) {
      return NextResponse.json({ valid: false, error: "Code not yet active" });
    }
    if (promotion.endDate && now > promotion.endDate) {
      return NextResponse.json({ valid: false, error: "Code has expired" });
    }
    if (
      promotion.usageLimit != null &&
      promotion.usageCount >= promotion.usageLimit
    ) {
      return NextResponse.json({ valid: false, error: "Usage limit reached" });
    }
    if (promotion.minCartValue && cartSubtotal < promotion.minCartValue) {
      return NextResponse.json({
        valid: false,
        error: `Minimum order ${formatCents(promotion.minCartValue)} required`,
      });
    }
    if (promotion.minGuestCount && guestCount < promotion.minGuestCount) {
      return NextResponse.json({
        valid: false,
        error: `Only for tables of ${promotion.minGuestCount}+`,
      });
    }
    // Day-of-week window (0 = Sunday)
    if (promotion.activeDays && promotion.activeDays.length > 0) {
      if (!promotion.activeDays.includes(now.getDay())) {
        return NextResponse.json({
          valid: false,
          error: "Not available today",
        });
      }
    }
    // Hour-of-day window ("HH:mm" strings)
    if (promotion.activeStartTime && promotion.activeEndTime) {
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
        now.getMinutes()
      ).padStart(2, "0")}`;
      if (hhmm < promotion.activeStartTime || hhmm > promotion.activeEndTime) {
        return NextResponse.json({
          valid: false,
          error: `Only valid ${promotion.activeStartTime}–${promotion.activeEndTime}`,
        });
      }
    }

    // FREE_ITEM / BOGO would need product-level cart context we don't have
    // here yet — hold those for a follow-up. Surface a clear error rather
    // than silently applying a wrong amount.
    if (
      promotion.discountType === "FREE_ITEM" ||
      promotion.discountType === "BOGO"
    ) {
      return NextResponse.json({
        valid: false,
        error: `${promotion.discountType} promotions not supported at POS yet`,
      });
    }

    // Compute discount amount from type
    let discount = 0;
    if (promotion.discountType === "PERCENTAGE") {
      discount = Math.floor((cartSubtotal * promotion.discountValue) / 100);
      if (promotion.maxDiscount && discount > promotion.maxDiscount) {
        discount = promotion.maxDiscount;
      }
    } else {
      // FIXED_AMOUNT — cap at cart subtotal
      discount = Math.min(promotion.discountValue, cartSubtotal);
    }

    return NextResponse.json({
      valid: true,
      promotion: {
        id: promotion.id,
        name: promotion.name,
        code: promotion.code,
        discountType: promotion.discountType,
        discountValue: promotion.discountValue,
        maxDiscount: promotion.maxDiscount,
      },
      computedDiscount: discount,
    });
  } catch (error: any) {
    console.error("[promotions/validate] error:", error);
    return NextResponse.json(
      { valid: false, error: error?.message || "Validation failed" },
      { status: 500 }
    );
  }
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
