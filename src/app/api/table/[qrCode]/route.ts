// GET /api/table/[qrCode] - Public endpoint to get table info and join session
// POST /api/table/[qrCode] - Join table session as guest

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { nanoid } from "nanoid";

// GET - Get table info and menu (public endpoint)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;

    const table = await prisma.table.findUnique({
      where: { qrCode },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            tenant: {
              select: {
                id: true,
                name: true,
                currency: true,
                logoUrl: true,
                settings: {
                  select: {
                    taxEnabled: true,
                    taxRate: true,
                    taxLabel: true,
                    tax2Enabled: true,
                    tax2Rate: true,
                    tax2Label: true,
                    tipEnabled: true,
                    tipPresets: true,
                  },
                },
              },
            },
          },
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
              },
            },
            _count: {
              select: { orders: true },
            },
          },
          take: 1,
        },
      },
    });

    if (!table) {
      return NextResponse.json(
        { error: "Table not found" },
        { status: 404 }
      );
    }

    if (!table.isActive) {
      return NextResponse.json(
        { error: "Table is not active" },
        { status: 400 }
      );
    }

    // Get menu items for this tenant
    const categories = await prisma.category.findMany({
      where: {
        tenantId: table.location.tenant.id,
        isActive: true,
      },
      include: {
        products: {
          where: { isActive: true, isAvailable: true },
          include: {
            variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
            productModifierGroups: {
              include: {
                modifierGroup: {
                  include: {
                    modifiers: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
                  },
                },
              },
              orderBy: { sortOrder: "asc" },
            },
            productAllergens: {
              include: { allergen: true },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    const currentSession = table.sessions[0] || null;

    // Auto-mark AVAILABLE tables as OCCUPIED the moment a guest scans
    // the QR — staff need the immediate red marker on the admin view,
    // even before the guest types their name and submits the Join modal.
    //
    // We flip on status alone and ignore stale sessions: if a table is
    // labelled AVAILABLE in the DB but still has an orphan session
    // attached (happens when staff manually reset the status without
    // closing the session), the scan means someone is sitting there NOW
    // and OCCUPIED is the truthful state.
    //
    // RESERVED / CLEANING are left alone — staff set those intentionally.
    let effectiveStatus = table.status;
    if (table.status === "AVAILABLE") {
      await prisma.table.update({
        where: { id: table.id },
        data: { status: "OCCUPIED" },
      });
      effectiveStatus = "OCCUPIED";
    }

    return NextResponse.json({
      success: true,
      table: {
        id: table.id,
        tableNumber: table.tableNumber,
        name: table.name,
        capacity: table.capacity,
        status: effectiveStatus,
      },
      location: {
        id: table.location.id,
        name: table.location.name,
      },
      tenant: {
        id: table.location.tenant.id,
        name: table.location.tenant.name,
        currency: table.location.tenant.currency,
        logoUrl: table.location.tenant.logoUrl,
        settings: table.location.tenant.settings,
      },
      session: currentSession ? {
        id: currentSession.id,
        guestCount: currentSession.guestCount,
        status: currentSession.status,
        guests: currentSession.guests,
        orderCount: currentSession._count.orders,
        allowGroupOrdering: currentSession.allowGroupOrdering,
      } : null,
      menu: categories,
    });
  } catch (error: any) {
    console.error("[TAP API] Get table by QR error:", error);
    return NextResponse.json(
      { error: "Failed to get table" },
      { status: 500 }
    );
  }
}

// POST - Join table session as guest
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;
    const body = await request.json();
    const { guestName, guestToken: existingToken } = body;

    const table = await prisma.table.findUnique({
      where: { qrCode },
      include: {
        location: {
          select: {
            id: true,
            tenantId: true,
          },
        },
        sessions: {
          where: {
            status: { in: ["ACTIVE", "ORDERING", "DINING", "PAYMENT_PENDING"] },
          },
          include: {
            guests: true,
          },
          take: 1,
        },
      },
    });

    if (!table) {
      return NextResponse.json(
        { error: "Table not found" },
        { status: 404 }
      );
    }

    if (!table.isActive) {
      return NextResponse.json(
        { error: "Table is not active" },
        { status: 400 }
      );
    }

    // Check if guest already exists with this token
    if (existingToken) {
      const existingGuest = await prisma.tableGuest.findUnique({
        where: { guestToken: existingToken },
        include: {
          session: {
            select: {
              id: true,
              status: true,
              tableId: true,
            },
          },
          cartItems: {
            include: {
              product: { select: { id: true, name: true, basePrice: true, imageUrl: true } },
            },
          },
        },
      });

      if (existingGuest && existingGuest.session.tableId === table.id) {
        // Return existing guest
        return NextResponse.json({
          success: true,
          guest: {
            id: existingGuest.id,
            guestName: existingGuest.guestName,
            guestToken: existingGuest.guestToken,
            isHost: existingGuest.isHost,
            cartItems: existingGuest.cartItems,
          },
          sessionId: existingGuest.session.id,
          isReturning: true,
        });
      }
    }

    let session = table.sessions[0];
    let isHost = false;

    // If no active session, create one
    if (!session) {
      session = await prisma.$transaction(async (tx) => {
        const newSession = await tx.tableSession.create({
          data: {
            tableId: table.id,
            locationId: table.location.id,
            guestCount: 1,
            status: "ACTIVE",
            allowGroupOrdering: true,
          },
          include: { guests: true },
        });

        // Update table status
        await tx.table.update({
          where: { id: table.id },
          data: {
            status: "OCCUPIED",
            currentSessionId: newSession.id,
          },
        });

        return newSession;
      });
      isHost = true;
    }

    // Create guest token
    const guestToken = nanoid(24);

    // Create guest
    const guest = await prisma.tableGuest.create({
      data: {
        sessionId: session.id,
        guestName: guestName || `Guest ${session.guests.length + 1}`,
        guestToken,
        isHost,
      },
    });

    // Update guest count
    await prisma.tableSession.update({
      where: { id: session.id },
      data: {
        guestCount: session.guests.length + 1,
        lastActivityAt: new Date(),
      },
    });

    console.log(`[TAP API] Guest joined table ${table.tableNumber}: ${guest.guestName}`);

    return NextResponse.json({
      success: true,
      guest: {
        id: guest.id,
        guestName: guest.guestName,
        guestToken: guest.guestToken,
        isHost: guest.isHost,
        cartItems: [],
      },
      sessionId: session.id,
      isReturning: false,
    });
  } catch (error: any) {
    console.error("[TAP API] Join table error:", error);
    return NextResponse.json(
      { error: "Failed to join table" },
      { status: 500 }
    );
  }
}
