// GET /api/tenants/[tenantId]/locations/[locationId]/tables/[tableId] - Get table
// PUT /api/tenants/[tenantId]/locations/[locationId]/tables/[tableId] - Update table
// DELETE /api/tenants/[tenantId]/locations/[locationId]/tables/[tableId] - Delete table
// POST /api/tenants/[tenantId]/locations/[locationId]/tables/[tableId] - Actions (regenerate QR, start session, etc.)

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import QRCode from "qrcode";
import { nanoid } from "nanoid";

type Params = { tenantId: string; locationId: string; tableId: string };

function resolveBaseUrl(
  request: NextRequest,
  customDomain: string | null | undefined
): string {
  if (customDomain) return `https://${customDomain}`;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

// GET - Get single table with current order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, locationId, tableId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const table = await prisma.table.findFirst({
      where: { id: tableId, locationId },
      include: {
        location: { select: { id: true, name: true, tenantId: true } },
        orders: {
          where: {
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
          include: {
            items: {
              include: {
                modifiers: true,
                allergenNotes: { include: { allergen: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        sessions: {
          where: {
            status: { in: ["ACTIVE", "ORDERING", "DINING", "PAYMENT_PENDING"] },
          },
          include: {
            guests: {
              select: {
                id: true,
                guestName: true,
                isHost: true,
                joinedAt: true,
                cartItems: {
                  include: {
                    product: { select: { id: true, name: true, imageUrl: true } },
                  },
                },
              },
            },
            orders: {
              select: {
                id: true,
                orderNumber: true,
                total: true,
                status: true,
              },
            },
            requests: {
              where: { status: { in: ["PENDING", "ACKNOWLEDGED"] } },
              orderBy: { createdAt: "desc" },
            },
          },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!table || table.location.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Table not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      table: {
        ...table,
        currentOrder: table.orders[0] || null,
        orderHistory: table.orders.slice(1),
        currentSession: table.sessions[0] || null,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get table error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update table (name, capacity, status)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, locationId, tableId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { tableNumber: rawTableNumber, name, capacity, status } = body;

    // tableNumber column is a VARCHAR (so "T-12" or "Bar-3" work), but the
    // form sends an integer. Coerce before any Prisma query — otherwise
    // Prisma 5 rejects the call with "Expected StringFilter or String,
    // provided Int" before we even reach the DB.
    const tableNumber =
      rawTableNumber !== undefined && rawTableNumber !== null
        ? String(rawTableNumber)
        : undefined;

    // Check table exists
    const existing = await prisma.table.findFirst({
      where: { id: tableId, locationId },
      include: {
        location: { select: { tenantId: true } },
      },
    });

    if (!existing || existing.location.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Table not found" },
        { status: 404 }
      );
    }

    // Check for duplicate table number if changing
    if (tableNumber !== undefined && tableNumber !== existing.tableNumber) {
      const duplicate = await prisma.table.findFirst({
        where: { locationId, tableNumber, id: { not: tableId } },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "Table with this number already exists" },
          { status: 409 }
        );
      }
    }

    // Validate status
    if (status) {
      const validStatuses = ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
          { status: 400 }
        );
      }
    }

    const table = await prisma.table.update({
      where: { id: tableId },
      data: {
        ...(tableNumber !== undefined && { tableNumber }),
        ...(name !== undefined && { name: name?.trim() || `Table ${tableNumber || existing.tableNumber}` }),
        ...(capacity !== undefined && { capacity }),
        ...(status !== undefined && { status: status as any }),
      },
    });

    console.log(`[TAP API] Updated table: ${table.name} status: ${table.status}`);

    return NextResponse.json({
      success: true,
      table,
    });
  } catch (error: any) {
    console.error("[TAP API] Update table error:", error);
    return NextResponse.json(
      { error: "Failed to update table" },
      { status: 500 }
    );
  }
}

// DELETE - Delete table
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, locationId, tableId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const table = await prisma.table.findFirst({
      where: { id: tableId, locationId },
      include: {
        location: { select: { tenantId: true } },
        _count: {
          select: {
            orders: {
              where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
            },
          },
        },
      },
    });

    if (!table || table.location.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Table not found" },
        { status: 404 }
      );
    }

    // Check for active orders
    if (table._count.orders > 0) {
      return NextResponse.json(
        { error: "Cannot delete table with active orders" },
        { status: 409 }
      );
    }

    await prisma.table.delete({
      where: { id: tableId },
    });

    console.log(`[TAP API] Deleted table: ${table.name}`);

    return NextResponse.json({
      success: true,
      message: "Table deleted",
    });
  } catch (error: any) {
    console.error("[TAP API] Delete table error:", error);
    return NextResponse.json(
      { error: "Failed to delete table" },
      { status: 500 }
    );
  }
}

// POST - Table actions (regenerate QR, start session, end session)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId, locationId, tableId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { action } = body;

    const table = await prisma.table.findFirst({
      where: { id: tableId, locationId },
      include: {
        location: {
          select: {
            tenantId: true,
            name: true,
            // customDomain lives on TenantSettings, not Tenant itself.
            tenant: {
              select: {
                settings: { select: { customDomain: true } },
              },
            },
          },
        },
        sessions: {
          where: {
            status: { in: ["ACTIVE", "ORDERING", "DINING", "PAYMENT_PENDING"] },
          },
          take: 1,
        },
      },
    });

    if (!table || table.location.tenantId !== tenantId) {
      return NextResponse.json(
        { error: "Table not found" },
        { status: 404 }
      );
    }

    // Action: Regenerate QR code
    if (action === "regenerate_qr") {
      const qrCode = nanoid(12);
      const baseUrl = resolveBaseUrl(
        request,
        table.location.tenant?.settings?.customDomain
      );
      const qrUrl = `${baseUrl}/table/${qrCode}`;
      const qrCodeUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 300,
      });

      const updatedTable = await prisma.table.update({
        where: { id: tableId },
        data: { qrCode, qrCodeUrl },
      });

      console.log(`[TAP API] Regenerated QR for table: ${table.name}`);

      return NextResponse.json({
        success: true,
        table: updatedTable,
        message: "QR code regenerated",
      });
    }

    // Action: Start new session (manual by staff)
    if (action === "start_session") {
      const { guestCount = 1 } = body;

      if (table.sessions.length > 0) {
        return NextResponse.json(
          { error: "Table already has an active session" },
          { status: 400 }
        );
      }

      const session = await prisma.$transaction(async (tx) => {
        const newSession = await tx.tableSession.create({
          data: {
            tableId,
            locationId,
            guestCount,
            status: "ACTIVE",
          },
        });

        // Update table status
        await tx.table.update({
          where: { id: tableId },
          data: {
            status: "OCCUPIED",
            currentSessionId: newSession.id,
          },
        });

        return newSession;
      });

      console.log(`[TAP API] Started session for table: ${table.name}`);

      return NextResponse.json({
        success: true,
        session,
        message: "Session started",
      });
    }

    // Action: End session
    if (action === "end_session") {
      const currentSession = table.sessions[0];
      if (!currentSession) {
        return NextResponse.json(
          { error: "No active session to end" },
          { status: 400 }
        );
      }

      await prisma.$transaction(async (tx) => {
        // End session
        await tx.tableSession.update({
          where: { id: currentSession.id },
          data: {
            status: "COMPLETED",
            endedAt: new Date(),
          },
        });

        // Update table status
        await tx.table.update({
          where: { id: tableId },
          data: {
            status: "CLEANING",
            currentSessionId: null,
          },
        });

        // Delete any cart items for this session's guests
        await tx.guestCartItem.deleteMany({
          where: {
            guest: { sessionId: currentSession.id },
          },
        });
      });

      console.log(`[TAP API] Ended session for table: ${table.name}`);

      return NextResponse.json({
        success: true,
        message: "Session ended",
      });
    }

    // Action: Mark table available
    if (action === "mark_available") {
      await prisma.table.update({
        where: { id: tableId },
        data: { status: "AVAILABLE" },
      });

      return NextResponse.json({
        success: true,
        message: "Table marked as available",
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[TAP API] Table action error:", error);
    // Surface the actual error so the browser console shows something
    // more useful than a generic "Failed to perform action".
    return NextResponse.json(
      {
        error: error?.message || "Failed to perform action",
        code: error?.code || null,
        meta: error?.meta || null,
      },
      { status: 500 }
    );
  }
}
