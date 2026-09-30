import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/trips — List trips with filters and pagination
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status");
    const driverId = searchParams.get("driverId");
    const customerId = searchParams.get("customerId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let whereClause = `WHERE t.tenant_id = '${tenantId}'`;
    if (status) whereClause += ` AND t.status = '${status}'`;
    if (driverId) whereClause += ` AND t.driver_profile_id = '${driverId}'`;
    if (customerId) whereClause += ` AND t.customer_id = '${customerId}'`;
    if (dateFrom) whereClause += ` AND t.created_at >= '${dateFrom}'`;
    if (dateTo) whereClause += ` AND t.created_at <= '${dateTo}'`;

    const trips = await prisma.$queryRawUnsafe(`
      SELECT t.*,
        dp.license_number AS driver_license,
        dp.duty_status AS driver_duty_status,
        v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model, v.color AS vehicle_color
      FROM trips t
      LEFT JOIN driver_profiles dp ON t.driver_profile_id = dp.id
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total FROM trips t ${whereClause}
    `);

    return NextResponse.json({
      success: true,
      trips,
      pagination: {
        total: countResult[0]?.total || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error listing trips:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list trips" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/trips — Create a new trip
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const {
      pickupLat,
      pickupLng,
      pickupAddress,
      dropoffLat,
      dropoffLng,
      dropoffAddress,
      customerName,
      customerPhone,
      customerId,
      rideType,
      paymentMethod,
      scheduledAt,
      notes,
      estimatedFareCents,
      vehicleType,
    } = body;

    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng || !customerName || !customerPhone) {
      return NextResponse.json(
        { success: false, error: "pickupLat, pickupLng, dropoffLat, dropoffLng, customerName, and customerPhone are required" },
        { status: 400 }
      );
    }

    const tripId = crypto.randomUUID();
    const tripNumber = `TRP-${Date.now().toString(36).toUpperCase()}`;
    const status = scheduledAt ? "REQUESTED" : "REQUESTED";

    const trip: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO trips (
        id, tenant_id, trip_number, customer_id, customer_name, customer_phone,
        pickup_lat, pickup_lng, pickup_address,
        dropoff_lat, dropoff_lng, dropoff_address,
        ride_type, vehicle_type, payment_method, status,
        estimated_fare_cents, scheduled_at, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, NOW(), NOW()
      )
      RETURNING *
    `,
      tripId, tenantId, tripNumber, customerId || null, customerName, customerPhone,
      pickupLat, pickupLng, pickupAddress || null,
      dropoffLat, dropoffLng, dropoffAddress || null,
      rideType || "STANDARD", vehicleType || "SEDAN", paymentMethod || "CASH", status,
      estimatedFareCents || null, scheduledAt ? new Date(scheduledAt) : null, notes || null
    );

    // Insert initial status log
    await prisma.$queryRawUnsafe(`
      INSERT INTO trip_status_log (id, trip_id, status, notes, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, crypto.randomUUID(), tripId, "REQUESTED", "Trip created");

    return NextResponse.json({ success: true, trip: trip[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating trip:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create trip" },
      { status: 500 }
    );
  }
}
