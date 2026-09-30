// GET /api/tenants/[tenantId]/upsell-rules/[ruleId] - Get single rule
// PUT /api/tenants/[tenantId]/upsell-rules/[ruleId] - Update rule
// DELETE /api/tenants/[tenantId]/upsell-rules/[ruleId] - Delete rule

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { tenantId: string; ruleId: string };

// GET - Get single rule
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, ruleId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const rule = await prisma.upsellRule.findFirst({
      where: { id: ruleId, tenantId },
    });

    if (!rule) {
      return NextResponse.json(
        { error: "Rule not found" },
        { status: 404 }
      );
    }

    // Get product and category details
    const productIds = [
      ...(rule.triggerProducts || []),
      ...(rule.suggestProducts || []),
    ];
    const categoryIds = [
      ...(rule.triggerCategories || []),
      ...(rule.suggestCategories || []),
    ];

    const [products, categories] = await Promise.all([
      productIds.length > 0
        ? prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, basePrice: true, imageUrl: true },
          })
        : [],
      categoryIds.length > 0
        ? prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    return NextResponse.json({
      success: true,
      rule,
      products,
      categories,
    });
  } catch (error: any) {
    console.error("[TAP API] Get upsell rule error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, ruleId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const existing = await prisma.upsellRule.findFirst({
      where: { id: ruleId, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Rule not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      name,
      description,
      triggerType,
      triggerProducts,
      triggerCategories,
      triggerMinCartValue,
      triggerMaxCartValue,
      activeStartTime,
      activeEndTime,
      activeDays,
      suggestProducts,
      suggestCategories,
      suggestMessage,
      suggestDiscount,
      displayType,
      displayImage,
      priority,
      isActive,
    } = body;

    const rule = await prisma.upsellRule.update({
      where: { id: ruleId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(triggerType !== undefined && { triggerType }),
        ...(triggerProducts !== undefined && { triggerProducts }),
        ...(triggerCategories !== undefined && { triggerCategories }),
        ...(triggerMinCartValue !== undefined && { triggerMinCartValue }),
        ...(triggerMaxCartValue !== undefined && { triggerMaxCartValue }),
        ...(activeStartTime !== undefined && { activeStartTime }),
        ...(activeEndTime !== undefined && { activeEndTime }),
        ...(activeDays !== undefined && { activeDays }),
        ...(suggestProducts !== undefined && { suggestProducts }),
        ...(suggestCategories !== undefined && { suggestCategories }),
        ...(suggestMessage !== undefined && { suggestMessage }),
        ...(suggestDiscount !== undefined && { suggestDiscount }),
        ...(displayType !== undefined && { displayType }),
        ...(displayImage !== undefined && { displayImage }),
        ...(priority !== undefined && { priority }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    console.log(`[TAP API] Updated upsell rule: ${rule.name}`);

    return NextResponse.json({
      success: true,
      rule,
    });
  } catch (error: any) {
    console.error("[TAP API] Update upsell rule error:", error);
    return NextResponse.json(
      { error: "Failed to update rule" },
      { status: 500 }
    );
  }
}

// DELETE - Delete rule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, ruleId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const rule = await prisma.upsellRule.findFirst({
      where: { id: ruleId, tenantId },
    });

    if (!rule) {
      return NextResponse.json(
        { error: "Rule not found" },
        { status: 404 }
      );
    }

    await prisma.upsellRule.delete({
      where: { id: ruleId },
    });

    console.log(`[TAP API] Deleted upsell rule: ${rule.name}`);

    return NextResponse.json({
      success: true,
      message: "Rule deleted",
    });
  } catch (error: any) {
    console.error("[TAP API] Delete upsell rule error:", error);
    return NextResponse.json(
      { error: "Failed to delete rule" },
      { status: 500 }
    );
  }
}
