import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/trips/[tripId]/dispatch — Get dispatch queue for this trip
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; tripId: string }> }
) {
  try {
    const { tenantId, tripId } = await params;

    // Verify trip belongs to tenant
    const trips: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM trips WHERE id = $1 AND tenant_id = $2
    `, tripId, tenantId);

    if (trips.length === 0) {
      return NextResponse.json(
        { success: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    const queue = await prisma.$queryRawUnsafe(`
      SELECT dq.*,
        dp.license_number AS driver_license,
        dp.avg_rating AS driver_rating,
        v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model
      FROM dispatch_queue dq
      LEFT JOIN driver_profiles dp ON dq.driver_profile_id = dp.id
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      WHERE dq.trip_id = $1
      ORDER BY dq.created_at ASC
    `, tripId);

    return NextResponse.json({ success: true, queue });
  } catch (error) {
    console.error("Error getting dispatch queue:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get dispatch queue" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/trips/[tripId]/dispatch — Manually dispatch to a specific driver
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; tripId: string }> }
) {
  try {
    const { tenantId, tripId } = await params;
    const body = await request.json();

    const { driverProfileId } = body;

    if (!driverProfileId) {
      return NextResponse.json(
        { success: false, error: "driverProfileId is required" },
        { status: 400 }
      );
    }

    // Verify trip exists and is in a dispatchable state
    const trips: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, status FROM trips WHERE id = $1 AND tenant_id = $2
    `, tripId, tenantId);

    if (trips.length === 0) {
      return NextResponse.json(
        { success: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    const dispatchableStatuses = ["REQUESTED", "SEARCHING", "NO_DRIVERS"];
    if (!dispatchableStatuses.includes(trips[0].status)) {
      return NextResponse.json(
        { success: false, error: `Cannot dispatch trip with status ${trips[0].status}` },
        { status: 400 }
      );
    }

    // Verify driver exists, belongs to tenant, and is online
    const drivers: any[] = await prisma.$queryRawUnsafe(`
      SELECT dp.id, dp.duty_status, dp.is_active
      FROM driver_profiles dp
      WHERE dp.id = $1 AND dp.tenant_id = $2
    `, driverProfileId, tenantId);

    if (drivers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    if (!drivers[0].is_active) {
      return NextResponse.json(
        { success: false, error: "Driver is not active" },
        { status: 400 }
      );
    }

    if (drivers[0].duty_status !== "online") {
      return NextResponse.json(
        { success: false, error: "Driver is not online" },
        { status: 400 }
      );
    }

    // Check if driver already has an active trip
    const activeTrips: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM trips
      WHERE driver_profile_id = $1
        AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
    `, driverProfileId);

    if (activeTrips.length > 0) {
      return NextResponse.json(
        { success: false, error: "Driver already has an active trip" },
        { status: 400 }
      );
    }

    // Create dispatch queue entry
    const dispatchId = crypto.randomUUID();
    await prisma.$queryRawUnsafe(`
      INSERT INTO dispatch_queue (id, trip_id, driver_profile_id, status, dispatch_type, created_at)
      VALUES ($1, $2, $3, 'PENDING', 'MANUAL', NOW())
    `, dispatchId, tripId, driverProfileId);

    // Assign driver to trip
    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE trips
      SET driver_profile_id = $1, status = 'ASSIGNED', updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3
      RETURNING *
    `, driverProfileId, tripId, tenantId);

    // Log status change
    await prisma.$queryRawUnsafe(`
      INSERT INTO trip_status_log (id, trip_id, status, notes, created_at)
      VALUES ($1, $2, 'ASSIGNED', $3, NOW())
    `, crypto.randomUUID(), tripId, `Manually dispatched to driver ${driverProfileId}`);

    // Update dispatch queue entry
    await prisma.$queryRawUnsafe(`
      UPDATE dispatch_queue SET status = 'ACCEPTED', responded_at = NOW()
      WHERE id = $1
    `, dispatchId);

    return NextResponse.json({
      success: true,
      trip: updated[0],
      dispatchId,
    }, { status: 201 });
  } catch (error) {
    console.error("Error dispatching trip:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to dispatch trip" },
      { status: 500 }
    );
  }
}
