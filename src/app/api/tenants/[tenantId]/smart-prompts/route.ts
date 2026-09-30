// GET /api/tenants/[tenantId]/smart-prompts - List smart prompts
// POST /api/tenants/[tenantId]/smart-prompts - Create smart prompt

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - List smart prompts
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

    const prompts = await prisma.smartPrompt.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    // Get product names for display
    const productIds = prompts.flatMap((p) => p.promptProducts || []);
    const products =
      productIds.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true },
          })
        : [];

    const productMap = new Map(products.map((p) => [p.id, p.name]));

    const enrichedPrompts = prompts.map((prompt) => ({
      ...prompt,
      promptProductNames: prompt.promptProducts?.map(
        (id) => productMap.get(id) || id
      ),
    }));

    return NextResponse.json({
      success: true,
      prompts: enrichedPrompts,
    });
  } catch (error: any) {
    console.error("[TAP API] List smart prompts error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Create smart prompt
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
      triggerType,
      triggerMinutes,
      requireMainCourse = false,
      requireNoRecentOrder = false,
      minSessionDuration,
      promptType,
      promptMessage,
      promptProducts,
      isActive = true,
    } = body;

    if (!name || !triggerType || !promptType || !promptMessage) {
      return NextResponse.json(
        { error: "Name, trigger type, prompt type, and message are required" },
        { status: 400 }
      );
    }

    // Validate trigger type
    const validTriggerTypes = [
      "SESSION_DURATION",
      "POST_MAIN_COURSE",
      "INACTIVITY",
      "SCHEDULED",
    ];
    if (!validTriggerTypes.includes(triggerType)) {
      return NextResponse.json(
        { error: `Invalid trigger type. Must be one of: ${validTriggerTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate prompt type
    const validPromptTypes = [
      "DRINKS_REFILL",
      "DESSERT_SUGGESTION",
      "BILL_READY",
      "FEEDBACK_REQUEST",
      "CUSTOM",
    ];
    if (!validPromptTypes.includes(promptType)) {
      return NextResponse.json(
        { error: `Invalid prompt type. Must be one of: ${validPromptTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const prompt = await prisma.smartPrompt.create({
      data: {
        tenantId,
        name,
        triggerType,
        triggerMinutes,
        requireMainCourse,
        requireNoRecentOrder,
        minSessionDuration,
        promptType,
        promptMessage,
        promptProducts: promptProducts || [],
        isActive,
      },
    });

    console.log(`[TAP API] Created smart prompt: ${prompt.name}`);

    return NextResponse.json({
      success: true,
      prompt,
    });
  } catch (error: any) {
    console.error("[TAP API] Create smart prompt error:", error);
    return NextResponse.json(
      { error: "Failed to create prompt" },
      { status: 500 }
    );
  }
}
