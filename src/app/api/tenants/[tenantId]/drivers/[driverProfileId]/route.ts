import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/drivers/[driverProfileId] — Get driver details with stats
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; driverProfileId: string }> }
) {
  try {
    const { tenantId, driverProfileId } = await params;

    const drivers: any[] = await prisma.$queryRawUnsafe(`
      SELECT dp.*,
        v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model,
        v.year AS vehicle_year, v.color AS vehicle_color, v.vehicle_type, v.capacity AS vehicle_capacity,
        dl.lat AS current_lat, dl.lng AS current_lng,
        dl.heading AS current_heading, dl.speed AS current_speed,
        dl.updated_at AS location_updated_at
      FROM driver_profiles dp
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      LEFT JOIN driver_locations dl ON dp.id = dl.driver_profile_id
      WHERE dp.id = $1 AND dp.tenant_id = $2
    `, driverProfileId, tenantId);

    if (drivers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    // Get stats
    const stats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total_trips,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_trips,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_trips,
        COALESCE(SUM(actual_fare_cents) FILTER (WHERE status = 'COMPLETED'), 0)::bigint AS total_revenue_cents,
        COALESCE(AVG(actual_fare_cents) FILTER (WHERE status = 'COMPLETED'), 0)::int AS avg_fare_cents
      FROM trips
      WHERE driver_profile_id = $1
    `, driverProfileId);

    // Get active trip (if any)
    const activeTrips: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM trips
      WHERE driver_profile_id = $1
        AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
      ORDER BY created_at DESC
      LIMIT 1
    `, driverProfileId);

    // Get recent trips
    const recentTrips = await prisma.$queryRawUnsafe(`
      SELECT id, trip_number, status, pickup_address, dropoff_address,
        actual_fare_cents, created_at, completed_at
      FROM trips
      WHERE driver_profile_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, driverProfileId);

    return NextResponse.json({
      success: true,
      driver: drivers[0],
      stats: stats[0] || {},
      activeTrip: activeTrips.length > 0 ? activeTrips[0] : null,
      recentTrips,
    });
  } catch (error) {
    console.error("Error getting driver:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get driver" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/drivers/[driverProfileId] — Update driver profile
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; driverProfileId: string }> }
) {
  try {
    const { tenantId, driverProfileId } = await params;
    const body = await request.json();

    const {
      driverName, driverPhone, driverEmail,
      licenseNumber, licenseExpiry, vehicleId,
      commissionType, commissionValue, isActive,
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

    addField("driver_name", driverName);
    addField("driver_phone", driverPhone);
    addField("driver_email", driverEmail);
    addField("license_number", licenseNumber);
    addField("license_expiry", licenseExpiry ? new Date(licenseExpiry) : undefined);
    addField("vehicle_id", vehicleId);
    addField("commission_type", commissionType);
    addField("commission_value", commissionValue);
    addField("is_active", isActive);

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = NOW()`);

    // If vehicleId being changed, verify it belongs to tenant
    if (vehicleId) {
      const vehicles: any[] = await prisma.$queryRawUnsafe(`
        SELECT id FROM vehicles WHERE id = $1 AND tenant_id = $2
      `, vehicleId, tenantId);

      if (vehicles.length === 0) {
        return NextResponse.json(
          { success: false, error: "Vehicle not found" },
          { status: 404 }
        );
      }
    }

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE driver_profiles
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING *
    `, ...values, driverProfileId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, driver: updated[0] });
  } catch (error) {
    console.error("Error updating driver:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update driver" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/drivers/[driverProfileId] — Deactivate driver
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; driverProfileId: string }> }
) {
  try {
    const { tenantId, driverProfileId } = await params;

    // Check for active trips
    const activeTrips: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM trips
      WHERE driver_profile_id = $1
        AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
    `, driverProfileId);

    if (activeTrips.length > 0) {
      return NextResponse.json(
        { success: false, error: "Cannot deactivate driver with active trips" },
        { status: 400 }
      );
    }

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE driver_profiles
      SET is_active = false, duty_status = 'offline', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `, driverProfileId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, driver: updated[0] });
  } catch (error) {
    console.error("Error deactivating driver:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to deactivate driver" },
      { status: 500 }
    );
  }
}
