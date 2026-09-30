import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/trips/[tripId] — Get trip details with driver, vehicle, status log
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; tripId: string }> }
) {
  try {
    const { tenantId, tripId } = await params;

    const trips: any[] = await prisma.$queryRawUnsafe(`
      SELECT t.*,
        dp.id AS driver_profile_id, dp.license_number, dp.duty_status,
        dp.commission_type, dp.commission_value, dp.avg_rating AS driver_avg_rating,
        v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model,
        v.year AS vehicle_year, v.color AS vehicle_color, v.capacity AS vehicle_capacity,
        v.vehicle_type
      FROM trips t
      LEFT JOIN driver_profiles dp ON t.driver_profile_id = dp.id
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      WHERE t.id = $1 AND t.tenant_id = $2
    `, tripId, tenantId);

    if (trips.length === 0) {
      return NextResponse.json(
        { success: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    const statusLog = await prisma.$queryRawUnsafe(`
      SELECT * FROM trip_status_log
      WHERE trip_id = $1
      ORDER BY created_at ASC
    `, tripId);

    const dispatchHistory = await prisma.$queryRawUnsafe(`
      SELECT dq.*, dp.license_number AS driver_license
      FROM dispatch_queue dq
      LEFT JOIN driver_profiles dp ON dq.driver_profile_id = dp.id
      WHERE dq.trip_id = $1
      ORDER BY dq.created_at ASC
    `, tripId);

    const ratings = await prisma.$queryRawUnsafe(`
      SELECT * FROM trip_ratings
      WHERE trip_id = $1
    `, tripId);

    return NextResponse.json({
      success: true,
      trip: trips[0],
      statusLog,
      dispatchHistory,
      ratings,
    });
  } catch (error) {
    console.error("Error getting trip:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get trip" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/trips/[tripId] — Admin update trip
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; tripId: string }> }
) {
  try {
    const { tenantId, tripId } = await params;
    const body = await request.json();

    const {
      pickupLat, pickupLng, pickupAddress,
      dropoffLat, dropoffLng, dropoffAddress,
      customerName, customerPhone,
      rideType, vehicleType, paymentMethod,
      estimatedFareCents, notes, scheduledAt,
    } = body;

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const addField = (column: string, value: any) => {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    };

    addField("pickup_lat", pickupLat);
    addField("pickup_lng", pickupLng);
    addField("pickup_address", pickupAddress);
    addField("dropoff_lat", dropoffLat);
    addField("dropoff_lng", dropoffLng);
    addField("dropoff_address", dropoffAddress);
    addField("customer_name", customerName);
    addField("customer_phone", customerPhone);
    addField("ride_type", rideType);
    addField("vehicle_type", vehicleType);
    addField("payment_method", paymentMethod);
    addField("estimated_fare_cents", estimatedFareCents);
    addField("notes", notes);
    addField("scheduled_at", scheduledAt ? new Date(scheduledAt) : undefined);

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = NOW()`);

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE trips
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING *
    `, ...values, tripId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, trip: updated[0] });
  } catch (error) {
    console.error("Error updating trip:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update trip" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/trips/[tripId] — Cancel trip
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; tripId: string }> }
) {
  try {
    const { tenantId, tripId } = await params;

    const existing: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, status FROM trips WHERE id = $1 AND tenant_id = $2
    `, tripId, tenantId);

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    const nonCancellable = ["COMPLETED", "CANCELLED"];
    if (nonCancellable.includes(existing[0].status)) {
      return NextResponse.json(
        { success: false, error: `Cannot cancel trip with status ${existing[0].status}` },
        { status: 400 }
      );
    }

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE trips
      SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `, tripId, tenantId);

    await prisma.$queryRawUnsafe(`
      INSERT INTO trip_status_log (id, trip_id, status, notes, created_at)
      VALUES ($1, $2, 'CANCELLED', 'Trip cancelled', NOW())
    `, crypto.randomUUID(), tripId);

    return NextResponse.json({ success: true, trip: updated[0] });
  } catch (error) {
    console.error("Error cancelling trip:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to cancel trip" },
      { status: 500 }
    );
  }
}
