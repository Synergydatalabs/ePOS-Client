// ============================================================================
// GET /api/.../locations/[locationId]/floor-view
//
// Returns the live floor view payload for a location:
//   - Default floor plan (canvas dimensions, BG image, grid)
//   - Sections (for color coding)
//   - Tables WITH live status + current server + seated_at + active order summary
//   - List of available servers (with their colors, for assignment dropdown)
//   - Active reservations for "next 2 hours" (so staff can plan seating)
//
// Polls every 5 seconds from the client (no WebSocket yet — Phase 5 may add).
// Lightweight enough for that polling cadence.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true, name: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    // Optional ?floorPlanId=... to switch floors; default = the default plan
    const url = new URL(request.url);
    const explicitFloorPlanId = url.searchParams.get("floorPlanId");

    const floorPlan = await prisma.floorPlan.findFirst({
      where: {
        locationId,
        isActive: true,
        ...(explicitFloorPlanId ? { id: explicitFloorPlanId } : { isDefault: true }),
      },
      include: {
        sections: { orderBy: { displayOrder: "asc" } },
      },
    });

    // If no default exists, grab first available
    let plan = floorPlan;
    if (!plan && !explicitFloorPlanId) {
      plan = await prisma.floorPlan.findFirst({
        where: { locationId, isActive: true },
        include: { sections: { orderBy: { displayOrder: "asc" } } },
      });
    }

    if (!plan) {
      return NextResponse.json({
        location,
        floorPlan: null,
        floorPlans: [],
        sections: [],
        tables: [],
        servers: [],
        reservations: [],
      });
    }

    // All floor plans (for switcher chips at top of staff view)
    const floorPlans = await prisma.floorPlan.findMany({
      where: { locationId, isActive: true },
      select: { id: true, name: true, floorNumber: true, isDefault: true },
      orderBy: [{ floorNumber: "asc" }, { displayOrder: "asc" }],
    });

    // Tables with current server + active order summary
    const tables = await prisma.table.findMany({
      where: { locationId, isActive: true, floorPlanId: plan.id },
      include: {
        currentServer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            color: true,
          },
        },
        sessions: {
          where: { status: { in: ["ACTIVE", "ORDERING", "DINING", "PAYMENT_PENDING"] } },
          orderBy: { startedAt: "desc" },
          take: 1,
          select: {
            id: true,
            guestCount: true,
            totalSpent: true,
            startedAt: true,
            status: true,
          },
        },
      },
      orderBy: { zIndex: "asc" },
    });

    // Available servers at this location (for assignment dropdown)
    const servers = await prisma.membership.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        role: { in: ["POS_STAFF", "POS_MANAGER", "POS_ADMIN", "TENANT_OWNER"] },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        color: true,
        role: true,
      },
      orderBy: { firstName: "asc" },
    });

    // Reservations for this location in the next 2 hours (or already arrived but not seated)
    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const reservations = await prisma.reservation.findMany({
      where: {
        locationId,
        status: { in: ["CONFIRMED", "ARRIVED"] },
        bookedFor: { lte: twoHoursFromNow },
      },
      select: {
        id: true,
        customerName: true,
        partySize: true,
        bookedFor: true,
        status: true,
        tableId: true,
        specialOccasion: true,
        notes: true,
      },
      orderBy: { bookedFor: "asc" },
      take: 50,
    });

    return NextResponse.json({
      location,
      floorPlan: {
        id: plan.id,
        name: plan.name,
        floorNumber: plan.floorNumber,
        canvasWidth: plan.canvasWidth,
        canvasHeight: plan.canvasHeight,
        gridSize: plan.gridSize,
        backgroundUrl: plan.backgroundUrl,
        backgroundOpacity: plan.backgroundOpacity,
      },
      floorPlans,
      sections: plan.sections,
      tables: tables.map((t) => ({
        id: t.id,
        tableNumber: t.tableNumber,
        displayLabel: t.displayLabel,
        capacity: t.capacity,
        shape: t.shape,
        customPolygon: t.customPolygon,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        zIndex: t.zIndex,
        sectionId: t.sectionId,
        isBookable: t.isBookable,
        status: t.status,
        seatedAt: t.seatedAt,
        guestCount: t.guestCount,
        lastStatusChangeAt: t.lastStatusChangeAt,
        currentServer: t.currentServer,
        activeSession: t.sessions[0]
          ? {
              id: t.sessions[0].id,
              guestCount: t.sessions[0].guestCount,
              totalSpentCents: t.sessions[0].totalSpent,
              startedAt: t.sessions[0].startedAt,
              status: t.sessions[0].status,
            }
          : null,
      })),
      servers,
      reservations,
      serverTime: now.toISOString(),
    });
  } catch (err: any) {
    console.error("[floor-view GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load floor view" },
      { status: 500 }
    );
  }
}
