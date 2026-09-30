// POST /api/tenants/[tenantId]/locations - Create location
// GET /api/tenants/[tenantId]/locations - List locations

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Create location
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
    const { name, address, city, province, postalCode, country, phone, isDefault } = body;

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Location name is required" },
        { status: 400 }
      );
    }

    // If this is the first location or marked as default, handle default status
    const existingLocations = await prisma.location.count({
      where: { tenantId },
    });

    const shouldBeDefault = isDefault || existingLocations === 0;

    // If setting as default, unset other defaults
    if (shouldBeDefault) {
      await prisma.location.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const location = await prisma.location.create({
      data: {
        tenantId,
        name: name.trim(),
        address: address?.trim() || null,
        city: city?.trim() || null,
        province: province?.trim() || null,
        postalCode: postalCode?.trim() || null,
        country: country || "CA",
        phone: phone?.trim() || null,
        isDefault: shouldBeDefault,
      },
    });

    console.log(`[TAP API] Created location: ${location.name} for tenant ${tenantId}`);

    return NextResponse.json({
      success: true,
      location,
    });
  } catch (error: any) {
    console.error("[TAP API] Create location error:", error);
    return NextResponse.json(
      { error: "Failed to create location" },
      { status: 500 }
    );
  }
}

// GET - List locations
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const locations = await prisma.location.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: {
            tables: true,
            kitchenStations: true,
            orders: true,
          },
        },
      },
      orderBy: [
        { isDefault: "desc" },
        { name: "asc" },
      ],
    });

    return NextResponse.json({
      success: true,
      locations,
    });
  } catch (error: any) {
    console.error("[TAP API] List locations error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
