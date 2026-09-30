// GET /api/tenants/[tenantId]/kitchen/load-rules - Get kitchen load rules
// POST /api/tenants/[tenantId]/kitchen/load-rules - Create/Update load rules
// GET /api/tenants/[tenantId]/kitchen/load-rules/status - Get current kitchen load status

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get kitchen load rules
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
    const locationId = searchParams.get("locationId");

    const where: any = { tenantId };
    if (locationId) {
      where.locationId = locationId;
    }

    const rules = await prisma.kitchenLoadRule.findMany({
      where,
      include: {
        location: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      success: true,
      rules,
    });
  } catch (error: any) {
    console.error("[TAP API] Get kitchen load rules error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Create or update kitchen load rule
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
      locationId,
      maxActiveOrders = 20,
      maxItemsInQueue = 50,
      pausePromotions = true,
      hideSlowItems = false,
      showWaitTime = true,
      customMessage,
      isActive = true,
    } = body;

    if (!locationId) {
      return NextResponse.json(
        { error: "Location ID is required" },
        { status: 400 }
      );
    }

    // Verify location belongs to tenant
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
    });

    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    // Upsert rule (one per location)
    const rule = await prisma.kitchenLoadRule.upsert({
      where: {
        tenantId_locationId: { tenantId, locationId },
      },
      create: {
        tenantId,
        locationId,
        maxActiveOrders,
        maxItemsInQueue,
        pausePromotions,
        hideSlowItems,
        showWaitTime,
        customMessage,
        isActive,
      },
      update: {
        maxActiveOrders,
        maxItemsInQueue,
        pausePromotions,
        hideSlowItems,
        showWaitTime,
        customMessage,
        isActive,
      },
    });

    console.log(`[TAP API] Kitchen load rule saved for location: ${location.name}`);

    return NextResponse.json({
      success: true,
      rule,
    });
  } catch (error: any) {
    console.error("[TAP API] Save kitchen load rule error:", error);
    return NextResponse.json(
      { error: "Failed to save rule" },
      { status: 500 }
    );
  }
}
