// POST /api/tenants/[tenantId]/locations/[locationId]/stations - Create kitchen station
// GET /api/tenants/[tenantId]/locations/[locationId]/stations - List kitchen stations

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Create kitchen station
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { name, displayOrder, productIds = [] } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Station name is required" },
        { status: 400 }
      );
    }

    // Validate location
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
    });

    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    // Get max display order if not provided
    let finalDisplayOrder = displayOrder;
    if (finalDisplayOrder === undefined) {
      const maxOrder = await prisma.kitchenStation.aggregate({
        where: { locationId },
        _max: { displayOrder: true },
      });
      finalDisplayOrder = (maxOrder._max.displayOrder || 0) + 1;
    }

    const station = await prisma.kitchenStation.create({
      data: {
        locationId,
        name: name.trim(),
        displayOrder: finalDisplayOrder,
        stationProducts: productIds.length
          ? {
              create: productIds.map((productId: string) => ({
                productId,
              })),
            }
          : undefined,
      },
      include: {
        stationProducts: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
        _count: { select: { kitchenQueue: true } },
      },
    });

    console.log(`[TAP API] Created kitchen station: ${station.name} at ${location.name}`);

    return NextResponse.json({
      success: true,
      station,
    });
  } catch (error: any) {
    console.error("[TAP API] Create station error:", error);
    return NextResponse.json(
      { error: "Failed to create station" },
      { status: 500 }
    );
  }
}

// GET - List kitchen stations
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    // Validate location
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
    });

    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    const stations = await prisma.kitchenStation.findMany({
      where: { locationId },
      include: {
        stationProducts: {
          include: {
            product: { select: { id: true, name: true, categoryId: true } },
          },
        },
        _count: {
          select: {
            kitchenQueue: {
              where: {
                status: { in: ["PENDING", "IN_PROGRESS"] },
              },
            },
          },
        },
      },
      orderBy: { displayOrder: "asc" },
    });

    return NextResponse.json({
      success: true,
      stations: stations.map((s) => ({
        ...s,
        activeOrders: s._count.kitchenQueue,
      })),
    });
  } catch (error: any) {
    console.error("[TAP API] List stations error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
