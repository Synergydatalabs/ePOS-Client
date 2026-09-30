// GET /api/tenants/[tenantId]/notifications - List staff notifications
// POST /api/tenants/[tenantId]/notifications - Create notification (internal use)
// PUT /api/tenants/[tenantId]/notifications - Bulk update (mark read, acknowledge)

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - List notifications
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

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const limit = parseInt(searchParams.get("limit") || "50");

    // Get locations for this tenant
    const locations = await prisma.location.findMany({
      where: { tenantId },
      select: { id: true },
    });
    const locationIds = locations.map((l) => l.id);

    const where: any = { locationId: { in: locationIds } };
    if (locationId && locationIds.includes(locationId)) {
      where.locationId = locationId;
    }
    if (status) {
      where.status = status;
    }
    if (type) {
      where.type = type;
    }
    if (unreadOnly) {
      where.status = "UNREAD";
    }

    const notifications = await prisma.staffNotification.findMany({
      where,
      include: {
        location: { select: { id: true, name: true } },
      },
      orderBy: [
        { priority: "desc" },
        { createdAt: "desc" },
      ],
      take: limit,
    });

    // Get counts
    const counts = await prisma.staffNotification.groupBy({
      by: ["status"],
      where: { locationId: { in: locationIds } },
      _count: true,
    });

    const countMap: any = {
      total: notifications.length,
      unread: 0,
      read: 0,
      acknowledged: 0,
      resolved: 0,
    };
    counts.forEach((c) => {
      countMap[c.status.toLowerCase()] = c._count;
    });

    return NextResponse.json({
      success: true,
      notifications,
      counts: countMap,
    });
  } catch (error: any) {
    console.error("[TAP API] List notifications error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Bulk update notifications
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { notificationIds, action, status } = body;

    if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json(
        { error: "Notification IDs are required" },
        { status: 400 }
      );
    }

    // Verify notifications belong to this tenant's locations
    const locations = await prisma.location.findMany({
      where: { tenantId },
      select: { id: true },
    });
    const locationIds = locations.map((l) => l.id);

    const validNotifications = await prisma.staffNotification.findMany({
      where: {
        id: { in: notificationIds },
        locationId: { in: locationIds },
      },
      select: { id: true },
    });
    const validIds = validNotifications.map((n) => n.id);

    if (validIds.length === 0) {
      return NextResponse.json(
        { error: "No valid notifications found" },
        { status: 404 }
      );
    }

    const updateData: any = {};

    if (action === "mark_read" || status === "READ") {
      updateData.status = "READ";
      updateData.readAt = new Date();
      updateData.readById = validation.membership?.id;
    } else if (action === "acknowledge" || status === "ACKNOWLEDGED") {
      updateData.status = "ACKNOWLEDGED";
      updateData.readAt = updateData.readAt || new Date();
    } else if (action === "resolve" || status === "RESOLVED") {
      updateData.status = "RESOLVED";
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "Invalid action or status" },
        { status: 400 }
      );
    }

    await prisma.staffNotification.updateMany({
      where: { id: { in: validIds } },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      updated: validIds.length,
    });
  } catch (error: any) {
    console.error("[TAP API] Update notifications error:", error);
    return NextResponse.json(
      { error: "Failed to update notifications" },
      { status: 500 }
    );
  }
}
