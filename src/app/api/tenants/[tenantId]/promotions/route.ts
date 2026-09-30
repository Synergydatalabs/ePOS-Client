// GET /api/tenants/[tenantId]/promotions - List promotions
// POST /api/tenants/[tenantId]/promotions - Create promotion

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - List promotions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";

    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }

    const promotions = await prisma.promotion.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      promotions,
    });
  } catch (error: any) {
    console.error("[TAP API] List promotions error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Create promotion
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const {
      name,
      code,
      discountType,
      discountValue,
      maxDiscount,
      minCartValue,
      minGuestCount,
      applicableProducts,
      applicableCategories,
      startDate,
      endDate,
      activeStartTime,
      activeEndTime,
      activeDays,
      autoApply = false,
      triggerConditions,
      usageLimit,
      perCustomerLimit,
      isActive = true,
    } = body;

    if (!name || !discountType || discountValue === undefined) {
      return NextResponse.json(
        { error: "Name, discount type, and discount value are required" },
        { status: 400 }
      );
    }

    // Validate discount type
    const validDiscountTypes = ["PERCENTAGE", "FIXED_AMOUNT", "FREE_ITEM", "BOGO"];
    if (!validDiscountTypes.includes(discountType)) {
      return NextResponse.json(
        { error: `Invalid discount type. Must be one of: ${validDiscountTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Check for duplicate code
    if (code) {
      const existing = await prisma.promotion.findFirst({
        where: { tenantId, code },
      });
      if (existing) {
        return NextResponse.json(
          { error: "A promotion with this code already exists" },
          { status: 409 }
        );
      }
    }

    const promotion = await prisma.promotion.create({
      data: {
        tenantId,
        name,
        code,
        discountType,
        discountValue,
        maxDiscount,
        minCartValue,
        minGuestCount,
        applicableProducts: applicableProducts || [],
        applicableCategories: applicableCategories || [],
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        activeStartTime,
        activeEndTime,
        activeDays: activeDays || [],
        autoApply,
        triggerConditions,
        usageLimit,
        perCustomerLimit,
        isActive,
      },
    });

    console.log(`[TAP API] Created promotion: ${promotion.name}`);

    return NextResponse.json({
      success: true,
      promotion,
    });
  } catch (error: any) {
    console.error("[TAP API] Create promotion error:", error);
    return NextResponse.json(
      { error: "Failed to create promotion" },
      { status: 500 }
    );
  }
}
