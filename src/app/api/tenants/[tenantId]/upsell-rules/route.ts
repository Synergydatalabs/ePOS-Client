// GET /api/tenants/[tenantId]/upsell-rules - List upsell rules
// POST /api/tenants/[tenantId]/upsell-rules - Create upsell rule

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - List upsell rules
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

    const rules = await prisma.upsellRule.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });

    // Get product and category names for display
    const productIds = rules.flatMap((r) => [
      ...(r.triggerProducts || []),
      ...(r.suggestProducts || []),
    ]);
    const categoryIds = rules.flatMap((r) => [
      ...(r.triggerCategories || []),
      ...(r.suggestCategories || []),
    ]);

    const [products, categories] = await Promise.all([
      productIds.length > 0
        ? prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true },
          })
        : [],
      categoryIds.length > 0
        ? prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const productMap = new Map(products.map((p) => [p.id, p.name]));
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    // Enrich rules with names
    const enrichedRules = rules.map((rule) => ({
      ...rule,
      triggerProductNames: rule.triggerProducts?.map((id) => productMap.get(id) || id),
      triggerCategoryNames: rule.triggerCategories?.map((id) => categoryMap.get(id) || id),
      suggestProductNames: rule.suggestProducts?.map((id) => productMap.get(id) || id),
      suggestCategoryNames: rule.suggestCategories?.map((id) => categoryMap.get(id) || id),
    }));

    return NextResponse.json({
      success: true,
      rules: enrichedRules,
    });
  } catch (error: any) {
    console.error("[TAP API] List upsell rules error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Create upsell rule
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
      displayType = "MODAL",
      displayImage,
      priority = 0,
      isActive = true,
    } = body;

    if (!name || !triggerType) {
      return NextResponse.json(
        { error: "Name and trigger type are required" },
        { status: 400 }
      );
    }

    // Validate trigger type
    const validTriggerTypes = [
      "PRODUCT_ADDED",
      "CATEGORY_ADDED",
      "CART_VALUE",
      "CHECKOUT",
      "POST_ORDER",
      "TIME_BASED",
    ];
    if (!validTriggerTypes.includes(triggerType)) {
      return NextResponse.json(
        { error: `Invalid trigger type. Must be one of: ${validTriggerTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate display type
    const validDisplayTypes = ["MODAL", "BANNER", "INLINE", "TOAST"];
    if (!validDisplayTypes.includes(displayType)) {
      return NextResponse.json(
        { error: `Invalid display type. Must be one of: ${validDisplayTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const rule = await prisma.upsellRule.create({
      data: {
        tenantId,
        name,
        description,
        triggerType,
        triggerProducts: triggerProducts || [],
        triggerCategories: triggerCategories || [],
        triggerMinCartValue,
        triggerMaxCartValue,
        activeStartTime,
        activeEndTime,
        activeDays: activeDays || [],
        suggestProducts: suggestProducts || [],
        suggestCategories: suggestCategories || [],
        suggestMessage,
        suggestDiscount,
        displayType,
        displayImage,
        priority,
        isActive,
      },
    });

    console.log(`[TAP API] Created upsell rule: ${rule.name}`);

    return NextResponse.json({
      success: true,
      rule,
    });
  } catch (error: any) {
    console.error("[TAP API] Create upsell rule error:", error);
    return NextResponse.json(
      { error: "Failed to create rule" },
      { status: 500 }
    );
  }
}
