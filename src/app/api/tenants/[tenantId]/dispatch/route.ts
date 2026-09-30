import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/dispatch — Live dispatch board
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Get active trips (not completed or cancelled)
    const activeTrips = await prisma.$queryRawUnsafe(`
      SELECT t.*,
        dp.driver_name, dp.license_number AS driver_license,
        dp.duty_status AS driver_duty_status,
        v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model, v.color AS vehicle_color,
        dl.lat AS driver_lat, dl.lng AS driver_lng, dl.heading AS driver_heading
      FROM trips t
      LEFT JOIN driver_profiles dp ON t.driver_profile_id = dp.id
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      LEFT JOIN driver_locations dl ON dp.id = dl.driver_profile_id
      WHERE t.tenant_id = $1
        AND t.status NOT IN ('COMPLETED', 'CANCELLED')
      ORDER BY
        CASE t.status
          WHEN 'REQUESTED' THEN 1
          WHEN 'SEARCHING' THEN 2
          WHEN 'NO_DRIVERS' THEN 3
          WHEN 'ASSIGNED' THEN 4
          WHEN 'DRIVER_EN_ROUTE' THEN 5
          WHEN 'DRIVER_ARRIVED' THEN 6
          WHEN 'IN_PROGRESS' THEN 7
        END,
        t.created_at ASC
    `, tenantId);

    // Get available online drivers with locations
    const availableDrivers = await prisma.$queryRawUnsafe(`
      SELECT dp.id, dp.driver_name, dp.license_number, dp.avg_rating, dp.duty_status,
        v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model,
        v.color AS vehicle_color, v.vehicle_type,
        dl.lat, dl.lng, dl.heading, dl.speed, dl.updated_at AS location_updated_at
      FROM driver_profiles dp
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      LEFT JOIN driver_locations dl ON dp.id = dl.driver_profile_id
      WHERE dp.tenant_id = $1
        AND dp.is_active = true
        AND dp.duty_status = 'online'
        AND dp.id NOT IN (
          SELECT driver_profile_id FROM trips
          WHERE driver_profile_id IS NOT NULL
            AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
        )
      ORDER BY dp.avg_rating DESC
    `, tenantId);

    // Pending dispatch queue entries
    const pendingDispatches = await prisma.$queryRawUnsafe(`
      SELECT dq.*, t.trip_number, dp.driver_name
      FROM dispatch_queue dq
      JOIN trips t ON dq.trip_id = t.id
      LEFT JOIN driver_profiles dp ON dq.driver_profile_id = dp.id
      WHERE t.tenant_id = $1 AND dq.status = 'PENDING'
      ORDER BY dq.created_at ASC
    `, tenantId);

    return NextResponse.json({
      success: true,
      activeTrips,
      availableDrivers,
      pendingDispatches,
      summary: {
        activeTripsCount: (activeTrips as any[]).length,
        availableDriversCount: (availableDrivers as any[]).length,
        pendingDispatchesCount: (pendingDispatches as any[]).length,
      },
    });
  } catch (error) {
    console.error("Error getting dispatch board:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get dispatch board" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/dispatch — Trigger auto-dispatch for a trip
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const { tripId, radiusKm } = body;

    if (!tripId) {
      return NextResponse.json(
        { success: false, error: "tripId is required" },
        { status: 400 }
      );
    }

    // Get trip details
    const trips: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM trips WHERE id = $1 AND tenant_id = $2
    `, tripId, tenantId);

    if (trips.length === 0) {
      return NextResponse.json(
        { success: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    const trip = trips[0];
    const dispatchableStatuses = ["REQUESTED", "SEARCHING", "NO_DRIVERS"];
    if (!dispatchableStatuses.includes(trip.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot dispatch trip with status ${trip.status}` },
        { status: 400 }
      );
    }

    const searchRadiusKm = radiusKm || 10;

    // Find nearest available drivers using Haversine
    const nearbyDrivers: any[] = await prisma.$queryRawUnsafe(`
      SELECT dp.id, dp.driver_name, dp.avg_rating,
        dl.lat, dl.lng,
        v.vehicle_type,
        (6371 * acos(
          cos(radians($1)) * cos(radians(dl.lat)) *
          cos(radians(dl.lng) - radians($2)) +
          sin(radians($1)) * sin(radians(dl.lat))
        )) AS distance_km
      FROM driver_profiles dp
      JOIN driver_locations dl ON dp.id = dl.driver_profile_id
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      WHERE dp.tenant_id = $3
        AND dp.is_active = true
        AND dp.duty_status = 'online'
        AND dp.id NOT IN (
          SELECT driver_profile_id FROM trips
          WHERE driver_profile_id IS NOT NULL
            AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
        )
        AND dl.lat != 0 AND dl.lng != 0
      HAVING (6371 * acos(
        cos(radians($1)) * cos(radians(dl.lat)) *
        cos(radians(dl.lng) - radians($2)) +
        sin(radians($1)) * sin(radians(dl.lat))
      )) <= $4
      ORDER BY distance_km ASC
      LIMIT 5
    `, trip.pickup_lat, trip.pickup_lng, tenantId, searchRadiusKm);

    if (nearbyDrivers.length === 0) {
      // Update trip status to NO_DRIVERS
      await prisma.$queryRawUnsafe(`
        UPDATE trips SET status = 'NO_DRIVERS', updated_at = NOW()
        WHERE id = $1
      `, tripId);

      await prisma.$queryRawUnsafe(`
        INSERT INTO trip_status_log (id, trip_id, status, notes, created_at)
        VALUES ($1, $2, 'NO_DRIVERS', 'Auto-dispatch found no available drivers', NOW())
      `, crypto.randomUUID(), tripId);

      return NextResponse.json({
        success: true,
        dispatched: false,
        message: "No available drivers found nearby",
        driversSearched: 0,
      });
    }

    // Update trip to SEARCHING
    await prisma.$queryRawUnsafe(`
      UPDATE trips SET status = 'SEARCHING', updated_at = NOW()
      WHERE id = $1
    `, tripId);

    // Create dispatch queue entries for nearest drivers
    const dispatchEntries = [];
    for (const driver of nearbyDrivers) {
      const dispatchId = crypto.randomUUID();
      await prisma.$queryRawUnsafe(`
        INSERT INTO dispatch_queue (
          id, trip_id, driver_profile_id, status, dispatch_type,
          distance_km, created_at, expires_at
        ) VALUES ($1, $2, $3, 'PENDING', 'AUTO', $4, NOW(), NOW() + INTERVAL '30 seconds')
      `, dispatchId, tripId, driver.id, driver.distance_km);

      dispatchEntries.push({
        dispatchId,
        driverId: driver.id,
        driverName: driver.driver_name,
        distanceKm: Math.round(driver.distance_km * 100) / 100,
      });
    }

    await prisma.$queryRawUnsafe(`
      INSERT INTO trip_status_log (id, trip_id, status, notes, created_at)
      VALUES ($1, $2, 'SEARCHING', $3, NOW())
    `, crypto.randomUUID(), tripId, `Auto-dispatch sent to ${nearbyDrivers.length} driver(s)`);

    return NextResponse.json({
      success: true,
      dispatched: true,
      driversNotified: dispatchEntries,
      searchRadiusKm,
    });
  } catch (error) {
    console.error("Error auto-dispatching:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to auto-dispatch" },
      { status: 500 }
    );
  }
}
