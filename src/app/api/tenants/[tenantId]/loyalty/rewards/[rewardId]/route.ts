// PUT    /api/tenants/[tenantId]/loyalty/rewards/[rewardId] — edit reward
// DELETE /api/tenants/[tenantId]/loyalty/rewards/[rewardId] — remove reward

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const REWARD_TYPES = [
  "DISCOUNT_PERCENTAGE",
  "DISCOUNT_FIXED",
  "FREE_PRODUCT",
  "SPIN_WHEEL",
  "MYSTERY_REWARD",
] as const;

type Params = { params: Promise<{ tenantId: string; rewardId: string }> };

// Confirm the reward belongs to this tenant's loyalty program before any
// mutation — prevents cross-tenant edits via forged reward IDs.
async function assertRewardBelongsToTenant(rewardId: string, tenantId: string) {
  const reward = await prisma.loyaltyReward.findUnique({
    where: { id: rewardId },
    select: { id: true, program: { select: { tenantId: true } } },
  });
  if (!reward || reward.program.tenantId !== tenantId) return null;
  return reward;
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, rewardId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const exists = await assertRewardBelongsToTenant(rewardId, tenantId);
    if (!exists) {
      return NextResponse.json({ error: "Reward not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      name,
      description,
      pointsRequired,
      rewardType,
      rewardValue,
      productId,
      isActive,
      sortOrder,
    } = body;

    if (rewardType && !REWARD_TYPES.includes(rewardType)) {
      return NextResponse.json(
        { error: `Invalid rewardType` },
        { status: 400 }
      );
    }

    const reward = await prisma.loyaltyReward.update({
      where: { id: rewardId },
      data: {
        ...(name !== undefined && { name: String(name).slice(0, 100) }),
        ...(description !== undefined && {
          description: description ? String(description).slice(0, 255) : null,
        }),
        ...(pointsRequired !== undefined && {
          pointsRequired: Math.max(1, Math.floor(Number(pointsRequired) || 1)),
        }),
        ...(rewardType !== undefined && { rewardType }),
        ...(rewardValue !== undefined && {
          rewardValue: Math.max(0, Math.floor(Number(rewardValue) || 0)),
        }),
        ...(productId !== undefined && { productId: productId || null }),
        ...(isActive !== undefined && { isActive: !!isActive }),
        ...(sortOrder !== undefined && {
          sortOrder: Math.floor(Number(sortOrder) || 0),
        }),
      },
    });

    return NextResponse.json({ success: true, reward });
  } catch (error: any) {
    console.error("[loyalty reward] PUT error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to update reward",
        code: error?.code || null,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, rewardId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const exists = await assertRewardBelongsToTenant(rewardId, tenantId);
    if (!exists) {
      return NextResponse.json({ error: "Reward not found" }, { status: 404 });
    }

    // If any customer has already redeemed this reward, keep the audit trail
    // by soft-deleting (mark inactive) rather than hard-deleting. Prevents
    // orphaned RewardRedemption rows and preserves reporting integrity.
    const redemptionCount = await prisma.rewardRedemption.count({
      where: { rewardId },
    });

    if (redemptionCount > 0) {
      const reward = await prisma.loyaltyReward.update({
        where: { id: rewardId },
        data: { isActive: false },
      });
      return NextResponse.json({
        success: true,
        deactivated: true,
        reward,
        message: `Reward archived (had ${redemptionCount} historical redemptions)`,
      });
    }

    await prisma.loyaltyReward.delete({ where: { id: rewardId } });
    return NextResponse.json({ success: true, deleted: true });
  } catch (error: any) {
    console.error("[loyalty reward] DELETE error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to delete reward",
        code: error?.code || null,
      },
      { status: 500 }
    );
  }
}
