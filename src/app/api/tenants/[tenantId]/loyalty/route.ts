// GET /api/tenants/[tenantId]/loyalty - Get loyalty program
// POST /api/tenants/[tenantId]/loyalty - Create/Update loyalty program

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get loyalty program
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
      include: {
        rewards: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        },
        spinWheelPrizes: {
          where: { isActive: true },
          orderBy: { probability: "desc" },
        },
        _count: {
          select: { customers: true },
        },
      },
    });

    if (!program) {
      return NextResponse.json({
        success: true,
        program: null,
        message: "No loyalty program configured",
      });
    }

    // Get some customer stats
    const stats = await prisma.customerLoyalty.aggregate({
      where: { programId: program.id },
      _sum: { totalPoints: true, lifetimePoints: true, totalSpent: true },
      _avg: { visitCount: true },
    });

    return NextResponse.json({
      success: true,
      program: {
        ...program,
        stats: {
          totalCustomers: program._count.customers,
          totalPointsOutstanding: stats._sum?.totalPoints || 0,
          totalLifetimePoints: stats._sum?.lifetimePoints || 0,
          totalCustomerSpend: stats._sum?.totalSpent || 0,
          avgVisitsPerCustomer: Math.round(stats._avg?.visitCount || 0),
        },
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get loyalty program error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Create or update loyalty program
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
      pointsPerDollar = 1,
      pointsPerVisit = 0,
      streakEnabled = false,
      streakDays = 7,
      streakBonus = 50,
      isActive = true,
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Program name is required" },
        { status: 400 }
      );
    }

    const program = await prisma.loyaltyProgram.upsert({
      where: { tenantId },
      create: {
        tenantId,
        name,
        pointsPerDollar,
        pointsPerVisit,
        streakEnabled,
        streakDays,
        streakBonus,
        isActive,
      },
      update: {
        name,
        pointsPerDollar,
        pointsPerVisit,
        streakEnabled,
        streakDays,
        streakBonus,
        isActive,
      },
    });

    console.log(`[TAP API] Loyalty program saved: ${program.name}`);

    return NextResponse.json({
      success: true,
      program,
    });
  } catch (error: any) {
    console.error("[TAP API] Save loyalty program error:", error);
    return NextResponse.json(
      { error: "Failed to save program" },
      { status: 500 }
    );
  }
}
