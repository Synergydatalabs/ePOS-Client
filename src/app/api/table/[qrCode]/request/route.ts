// GET /api/table/[qrCode]/request - Get session requests
// POST /api/table/[qrCode]/request - Create new request (call waiter, water, bill, etc.)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Helper to validate guest token
async function validateGuest(request: NextRequest, qrCode: string) {
  const guestToken = request.headers.get("x-guest-token");

  if (!guestToken) {
    return { success: false, error: "Guest token required", status: 401 };
  }

  const table = await prisma.table.findUnique({
    where: { qrCode },
    include: {
      location: { select: { id: true, tenantId: true } },
    },
  });

  if (!table || !table.isActive) {
    return { success: false, error: "Table not found", status: 404 };
  }

  const guest = await prisma.tableGuest.findUnique({
    where: { guestToken },
    include: {
      session: true,
    },
  });

  if (!guest || guest.session.tableId !== table.id) {
    return { success: false, error: "Invalid guest token", status: 401 };
  }

  return { success: true, guest, table };
}

// GET - Get all requests for this session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;
    const validation = await validateGuest(request, qrCode);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const requests = await prisma.tableRequest.findMany({
      where: { sessionId: validation.guest!.session.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      requests,
    });
  } catch (error: any) {
    console.error("[TAP API] Get requests error:", error);
    return NextResponse.json(
      { error: "Failed to get requests" },
      { status: 500 }
    );
  }
}

// POST - Create new request
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;
    const validation = await validateGuest(request, qrCode);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const { guest, table } = validation;
    const body = await request.json();
    const { type, note } = body;

    // Validate request type
    const validTypes = ["WATER", "HELP", "BILL", "REFILL", "NAPKINS", "CUSTOM"];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid request type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Check for existing pending request of same type
    const existingRequest = await prisma.tableRequest.findFirst({
      where: {
        sessionId: guest!.session.id,
        type,
        status: { in: ["PENDING", "ACKNOWLEDGED"] },
      },
    });

    if (existingRequest) {
      return NextResponse.json({
        success: true,
        request: existingRequest,
        message: "Request already pending",
        alreadyExists: true,
      });
    }

    // Create request
    const tableRequest = await prisma.tableRequest.create({
      data: {
        sessionId: guest!.session.id,
        guestId: guest!.id,
        type,
        status: "PENDING",
        note: note || null,
      },
    });

    // Create staff notification
    const notificationTitle = type === "BILL" ? "Bill Requested" :
      type === "WATER" ? "Water Requested" :
      type === "HELP" ? "Help Requested" :
      type === "REFILL" ? "Refill Requested" :
      type === "NAPKINS" ? "Napkins Requested" : "Request";

    await prisma.staffNotification.create({
      data: {
        locationId: table!.location.id,
        type: "TABLE_REQUEST",
        title: notificationTitle,
        message: `Table ${table!.tableNumber}: ${notificationTitle}${note ? ` - ${note}` : ""}`,
        priority: type === "BILL" ? "HIGH" : "NORMAL",
        tableId: table!.id,
        sessionId: guest!.session.id,
        requestId: tableRequest.id,
        targetRoles: ["POS_STAFF", "POS_MANAGER"],
      },
    });

    // Update session activity
    await prisma.tableSession.update({
      where: { id: guest!.session.id },
      data: { lastActivityAt: new Date() },
    });

    console.log(`[TAP API] Request created: ${type} for table ${table!.tableNumber}`);

    return NextResponse.json({
      success: true,
      request: tableRequest,
    });
  } catch (error: any) {
    console.error("[TAP API] Create request error:", error);
    return NextResponse.json(
      { error: "Failed to create request" },
      { status: 500 }
    );
  }
}
