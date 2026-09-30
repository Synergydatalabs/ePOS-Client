// GET /api/tenants/[tenantId]/locations/[locationId]/stations/[stationId] - Get station
// PUT /api/tenants/[tenantId]/locations/[locationId]/stations/[stationId] - Update station
// DELETE /api/tenants/[tenantId]/locations/[locationId]/stations/[stationId] - Delete station

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { tenantId: string; locationId: string; stationId: string };

// GET - Get single station with products
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, locationId, stationId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const station = await prisma.kitchenStation.findFirst({
      where: { id: stationId, locationId },
      include: {
        location: { select: { id: true, name: true, tenantId: true } },
        stationProducts: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                categoryId: true,
                prepTimeMinutes: true,
              },
            },
          },
        },
      },
    });

    if (!station || station.location.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Station not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      station,
    });
  } catch (error: any) {
    console.error("[TAP API] Get station error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update station
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, locationId, stationId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { name, displayOrder, productIds } = body;

    // Check station exists and belongs to tenant
    const existing = await prisma.kitchenStation.findFirst({
      where: { id: stationId, locationId },
      include: {
        location: { select: { tenantId: true } },
      },
    });

    if (!existing || existing.location.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Station not found" },
        { status: 404 }
      );
    }

    const station = await prisma.$transaction(async (tx) => {
      // Update product assignments if provided
      if (productIds !== undefined) {
        await tx.stationProduct.deleteMany({
          where: { stationId },
        });

        if (productIds.length > 0) {
          await tx.stationProduct.createMany({
            data: productIds.map((productId: string) => ({
              stationId,
              productId,
            })),
          });
        }
      }

      return tx.kitchenStation.update({
        where: { id: stationId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(displayOrder !== undefined && { displayOrder }),
        },
        include: {
          stationProducts: {
            include: {
              product: { select: { id: true, name: true } },
            },
          },
        },
      });
    });

    console.log(`[TAP API] Updated kitchen station: ${station.name}`);

    return NextResponse.json({
      success: true,
      station,
    });
  } catch (error: any) {
    console.error("[TAP API] Update station error:", error);
    return NextResponse.json(
      { error: "Failed to update station" },
      { status: 500 }
    );
  }
}

// DELETE - Delete station
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, locationId, stationId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const station = await prisma.kitchenStation.findFirst({
      where: { id: stationId, locationId },
      include: {
        location: { select: { tenantId: true } },
        _count: {
          select: {
            kitchenQueue: {
              where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
            },
          },
        },
      },
    });

    if (!station || station.location.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Station not found" },
        { status: 404 }
      );
    }

    // Check for active orders
    if (station._count.kitchenQueue > 0) {
      return NextResponse.json(
        { error: "Cannot delete station with active orders" },
        { status: 409 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.stationProduct.deleteMany({ where: { stationId } });
      await tx.kitchenQueue.deleteMany({ where: { stationId } });
      await tx.kitchenStation.delete({ where: { id: stationId } });
    });

    console.log(`[TAP API] Deleted kitchen station: ${station.name}`);

    return NextResponse.json({
      success: true,
      message: "Station deleted",
    });
  } catch (error: any) {
    console.error("[TAP API] Delete station error:", error);
    return NextResponse.json(
      { error: "Failed to delete station" },
      { status: 500 }
    );
  }
}
