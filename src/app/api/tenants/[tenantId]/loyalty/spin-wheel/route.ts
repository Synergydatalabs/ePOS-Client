// GET /api/tenants/[tenantId]/loyalty/spin-wheel - Get spin wheel prizes
// POST /api/tenants/[tenantId]/loyalty/spin-wheel - Create spin wheel prize

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get spin wheel prizes
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

    const prizes = await prisma.spinWheelPrize.findMany({
      where: { programId: program.id },
      orderBy: { probability: "desc" },
    });

    // Validate probabilities sum to ~100
    const totalProbability = prizes.reduce((sum, p) => sum + p.probability, 0);

    return NextResponse.json({
      success: true,
      prizes,
      totalProbability,
      isValid: Math.abs(totalProbability - 100) < 1,
    });
  } catch (error: any) {
    console.error("[TAP API] Get spin wheel prizes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Create spin wheel prize
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
      probability,
      prizeType,
      prizeValue,
      color,
      isActive = true,
    } = body;

    if (!name || probability === undefined || !prizeType || prizeValue === undefined) {
      return NextResponse.json(
        { error: "Name, probability, prize type, and prize value are required" },
        { status: 400 }
      );
    }

    // Validate prize type
    const validPrizeTypes = [
      "DISCOUNT_PERCENTAGE",
      "DISCOUNT_FIXED",
      "FREE_PRODUCT",
      "SPIN_WHEEL",
      "MYSTERY_REWARD",
    ];
    if (!validPrizeTypes.includes(prizeType)) {
      return NextResponse.json(
        { error: `Invalid prize type. Must be one of: ${validPrizeTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const prize = await prisma.spinWheelPrize.create({
      data: {
        programId: program.id,
        name,
        probability,
        prizeType,
        prizeValue,
        color,
        isActive,
      },
    });

    console.log(`[TAP API] Created spin wheel prize: ${prize.name}`);

    return NextResponse.json({
      success: true,
      prize,
    });
  } catch (error: any) {
    console.error("[TAP API] Create spin wheel prize error:", error);
    return NextResponse.json(
      { error: "Failed to create prize" },
      { status: 500 }
    );
  }
}
