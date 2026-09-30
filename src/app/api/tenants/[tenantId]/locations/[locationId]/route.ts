// GET /api/tenants/[tenantId]/locations/[locationId] - Get location
// PUT /api/tenants/[tenantId]/locations/[locationId] - Update location
// DELETE /api/tenants/[tenantId]/locations/[locationId] - Delete location

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get location details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      include: {
        _count: {
          select: {
            tables: true,
            kitchenStations: true,
            orders: true,
          },
        },
      },
    });

    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      location,
    });
  } catch (error: any) {
    console.error("[TAP API] Get location error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update location
export async function PUT(
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
    const { name, address, city, province, postalCode, country, phone, isDefault, status } = body;

    // Find existing location
    const existing = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    // If setting as default, unset other defaults
    if (isDefault && !existing.isDefault) {
      await prisma.location.updateMany({
        where: { tenantId, isDefault: true, id: { not: locationId } },
        data: { isDefault: false },
      });
    }

    const location = await prisma.location.update({
      where: { id: locationId },
      data: {
        name: name?.trim() || existing.name,
        address: address !== undefined ? (address?.trim() || null) : existing.address,
        city: city !== undefined ? (city?.trim() || null) : existing.city,
        province: province !== undefined ? (province?.trim() || null) : existing.province,
        postalCode: postalCode !== undefined ? (postalCode?.trim() || null) : existing.postalCode,
        country: country || existing.country,
        phone: phone !== undefined ? (phone?.trim() || null) : existing.phone,
        isDefault: isDefault !== undefined ? isDefault : existing.isDefault,
        status: status || existing.status,
      },
    });

    console.log(`[TAP API] Updated location: ${location.name}`);

    return NextResponse.json({
      success: true,
      location,
    });
  } catch (error: any) {
    console.error("[TAP API] Update location error:", error);
    return NextResponse.json(
      { error: "Failed to update location" },
      { status: 500 }
    );
  }
}

// DELETE - Delete location
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;

    const validation = await validateRequest(request, tenantId, "TENANT_OWNER");
    if (!validation.success) {
      return validation.response;
    }

    // Find existing location
    const existing = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      include: {
        _count: {
          select: {
            orders: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    // Don't allow deleting the only location
    const locationCount = await prisma.location.count({
      where: { tenantId },
    });

    if (locationCount <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the only location" },
        { status: 400 }
      );
    }

    // Check for active orders
    if (existing._count.orders > 0) {
      return NextResponse.json(
        { error: "Cannot delete location with existing orders" },
        { status: 400 }
      );
    }

    await prisma.location.delete({
      where: { id: locationId },
    });

    // If deleted location was default, make another one default
    if (existing.isDefault) {
      const firstLocation = await prisma.location.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
      });
      if (firstLocation) {
        await prisma.location.update({
          where: { id: firstLocation.id },
          data: { isDefault: true },
        });
      }
    }

    console.log(`[TAP API] Deleted location: ${existing.name}`);

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[TAP API] Delete location error:", error);
    return NextResponse.json(
      { error: "Failed to delete location" },
      { status: 500 }
    );
  }
}
