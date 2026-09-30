// GET /api/tenants/[tenantId]/loyalty/rewards - List rewards
// POST /api/tenants/[tenantId]/loyalty/rewards - Create reward

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - List rewards
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

    const program = await prisma.loyaltyProgram.findUnique({
      where: { tenantId },
    });

    if (!program) {
      return NextResponse.json(
        { error: "No loyalty program configured" },
        { status: 404 }
      );
    }

    const rewards = await prisma.loyaltyReward.findMany({
      where: { programId: program.id },
      include: {
        _count: { select: { redemptions: true } },
      },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json({
      success: true,
      rewards: rewards.map((r) => ({
        ...r,
        redemptionCount: r._count.redemptions,
      })),
    });
  } catch (error: any) {
    console.error("[TAP API] List rewards error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Create reward
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

    const program = await prisma.loyaltyProgram.findUnique({
      where: { tenantId },
    });

    if (!program) {
      return NextResponse.json(
        { error: "No loyalty program configured. Create a program first." },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      name,
      description,
      pointsRequired,
      rewardType,
      rewardValue,
      productId,
      sortOrder = 0,
      isActive = true,
    } = body;

    if (!name || !pointsRequired || !rewardType || rewardValue === undefined) {
      return NextResponse.json(
        { error: "Name, points required, reward type, and reward value are required" },
        { status: 400 }
      );
    }

    // Validate reward type
    const validRewardTypes = [
      "DISCOUNT_PERCENTAGE",
      "DISCOUNT_FIXED",
      "FREE_PRODUCT",
      "SPIN_WHEEL",
      "MYSTERY_REWARD",
    ];
    if (!validRewardTypes.includes(rewardType)) {
      return NextResponse.json(
        { error: `Invalid reward type. Must be one of: ${validRewardTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const reward = await prisma.loyaltyReward.create({
      data: {
        programId: program.id,
        name,
        description,
        pointsRequired,
        rewardType,
        rewardValue,
        productId,
        sortOrder,
        isActive,
      },
    });

    console.log(`[TAP API] Created loyalty reward: ${reward.name}`);

    return NextResponse.json({
      success: true,
      reward,
    });
  } catch (error: any) {
    console.error("[TAP API] Create reward error:", error);
    return NextResponse.json(
      { error: "Failed to create reward" },
      { status: 500 }
    );
  }
}
