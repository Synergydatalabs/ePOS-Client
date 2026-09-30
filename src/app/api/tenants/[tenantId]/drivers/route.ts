import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/drivers — List all drivers with profiles, status, vehicle
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("dutyStatus");
    const isActive = searchParams.get("isActive");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let whereClause = `WHERE dp.tenant_id = $1`;
    if (status) whereClause += ` AND dp.duty_status = '${status}'`;
    if (isActive !== null && isActive !== undefined && isActive !== "") {
      whereClause += ` AND dp.is_active = ${isActive === "true"}`;
    }

    const drivers = await prisma.$queryRawUnsafe(`
      SELECT dp.*,
        v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model,
        v.year AS vehicle_year, v.color AS vehicle_color, v.vehicle_type,
        dl.lat AS current_lat, dl.lng AS current_lng,
        dl.heading AS current_heading, dl.updated_at AS location_updated_at,
        (SELECT COUNT(*)::int FROM trips t WHERE t.driver_profile_id = dp.id AND t.status = 'COMPLETED') AS total_trips,
        (SELECT COUNT(*)::int FROM trips t WHERE t.driver_profile_id = dp.id
          AND t.status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')) AS active_trips
      FROM driver_profiles dp
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      LEFT JOIN driver_locations dl ON dp.id = dl.driver_profile_id
      ${whereClause}
      ORDER BY dp.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, tenantId);

    const countResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total FROM driver_profiles dp ${whereClause}
    `, tenantId);

    return NextResponse.json({
      success: true,
      drivers,
      pagination: {
        total: countResult[0]?.total || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error listing drivers:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list drivers" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/drivers — Create driver profile
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const {
      membershipId,
      driverName,
      driverPhone,
      driverEmail,
      licenseNumber,
      licenseExpiry,
      vehicleId,
      commissionType,
      commissionValue,
    } = body;

    if (!licenseNumber || !driverName) {
      return NextResponse.json(
        { success: false, error: "driverName and licenseNumber are required" },
        { status: 400 }
      );
    }

    // Check for duplicate license number within tenant
    const existing: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM driver_profiles
      WHERE tenant_id = $1 AND license_number = $2
    `, tenantId, licenseNumber);

    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: "A driver with this license number already exists" },
        { status: 409 }
      );
    }

    // If vehicleId provided, verify it belongs to tenant
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

    const driverProfileId = crypto.randomUUID();

    const driver: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO driver_profiles (
        id, tenant_id, membership_id, driver_name, driver_phone, driver_email,
        license_number, license_expiry, vehicle_id,
        commission_type, commission_value,
        duty_status, is_active, avg_rating, total_ratings,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11,
        'offline', true, 0, 0,
        NOW(), NOW()
      )
      RETURNING *
    `,
      driverProfileId, tenantId, membershipId || null, driverName, driverPhone || null, driverEmail || null,
      licenseNumber, licenseExpiry ? new Date(licenseExpiry) : null, vehicleId || null,
      commissionType || "PERCENTAGE", commissionValue ?? 80
    );

    // Initialize driver location record
    await prisma.$queryRawUnsafe(`
      INSERT INTO driver_locations (id, driver_profile_id, lat, lng, heading, speed, accuracy, updated_at)
      VALUES ($1, $2, 0, 0, 0, 0, 0, NOW())
    `, crypto.randomUUID(), driverProfileId);

    return NextResponse.json({ success: true, driver: driver[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating driver:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create driver" },
      { status: 500 }
    );
  }
}
