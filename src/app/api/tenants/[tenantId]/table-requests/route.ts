// GET /api/tenants/[tenantId]/table-requests - List all pending requests
// PUT /api/tenants/[tenantId]/table-requests - Update request status

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - List all pending requests
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
    const includeCompleted = searchParams.get("includeCompleted") === "true";

    // Get locations for this tenant
    const locations = await prisma.location.findMany({
      where: { tenantId },
      select: { id: true },
    });
    const locationIds = locations.map((l) => l.id);

    // Build where clause
    const where: any = {
      session: {
        locationId: locationId && locationIds.includes(locationId)
          ? locationId
          : { in: locationIds },
      },
    };

    if (status) {
      where.status = status;
    } else if (!includeCompleted) {
      where.status = { in: ["PENDING", "ACKNOWLEDGED"] };
    }

    const requests = await prisma.tableRequest.findMany({
      where,
      include: {
        session: {
          include: {
            table: {
              select: { id: true, tableNumber: true, name: true },
            },
            guests: {
              select: { id: true, guestName: true },
              take: 5,
            },
          },
        },
      },
      orderBy: [
        { status: "asc" }, // PENDING first
        { createdAt: "asc" }, // Oldest first
      ],
    });

    // Enrich with wait time
    const enrichedRequests = requests.map((req) => ({
      ...req,
      waitTimeMinutes: Math.round(
        (Date.now() - new Date(req.createdAt).getTime()) / 60000
      ),
    }));

    // Summary
    const summary = {
      total: requests.length,
      pending: requests.filter((r) => r.status === "PENDING").length,
      acknowledged: requests.filter((r) => r.status === "ACKNOWLEDGED").length,
      byType: {
        WATER: requests.filter((r) => r.type === "WATER" && r.status !== "COMPLETED").length,
        HELP: requests.filter((r) => r.type === "HELP" && r.status !== "COMPLETED").length,
        BILL: requests.filter((r) => r.type === "BILL" && r.status !== "COMPLETED").length,
        REFILL: requests.filter((r) => r.type === "REFILL" && r.status !== "COMPLETED").length,
        NAPKINS: requests.filter((r) => r.type === "NAPKINS" && r.status !== "COMPLETED").length,
        CUSTOM: requests.filter((r) => r.type === "CUSTOM" && r.status !== "COMPLETED").length,
      },
    };

    return NextResponse.json({
      success: true,
      requests: enrichedRequests,
      summary,
    });
  } catch (error: any) {
    console.error("[TAP API] List table requests error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update request status
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
    const { requestId, status, note } = body;

    if (!requestId || !status) {
      return NextResponse.json(
        { error: "Request ID and status are required" },
        { status: 400 }
      );
    }

    // Validate status
    const validStatuses = ["ACKNOWLEDGED", "COMPLETED", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Find request and verify it belongs to this tenant
    const tableRequest = await prisma.tableRequest.findFirst({
      where: { id: requestId },
      include: {
        session: {
          include: {
            table: { select: { tableNumber: true } },
            location: { select: { tenantId: true } },
          },
        },
      },
    });

    if (!tableRequest || tableRequest.session.location.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    const updateData: any = {
      status,
      respondedById: validation.membership?.id,
    };

    if (status === "ACKNOWLEDGED") {
      updateData.acknowledgedAt = new Date();
    } else if (status === "COMPLETED" || status === "CANCELLED") {
      updateData.completedAt = new Date();
    }

    if (note) {
      updateData.note = note;
    }

    const updated = await prisma.tableRequest.update({
      where: { id: requestId },
      data: updateData,
    });

    // Mark related notification as resolved
    await prisma.staffNotification.updateMany({
      where: { requestId },
      data: { status: status === "COMPLETED" ? "RESOLVED" : "ACKNOWLEDGED" },
    });

    console.log(
      `[TAP API] Table request ${status.toLowerCase()}: ${tableRequest.type} for table ${tableRequest.session.table.tableNumber}`
    );

    return NextResponse.json({
      success: true,
      request: updated,
    });
  } catch (error: any) {
    console.error("[TAP API] Update table request error:", error);
    return NextResponse.json(
      { error: "Failed to update request" },
      { status: 500 }
    );
  }
}
