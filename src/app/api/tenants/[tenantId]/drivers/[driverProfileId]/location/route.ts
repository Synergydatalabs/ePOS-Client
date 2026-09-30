import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/drivers/[driverProfileId]/location — Get latest location
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; driverProfileId: string }> }
) {
  try {
    const { tenantId, driverProfileId } = await params;

    // Verify driver belongs to tenant
    const drivers: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM driver_profiles WHERE id = $1 AND tenant_id = $2
    `, driverProfileId, tenantId);

    if (drivers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    const locations: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM driver_locations
      WHERE driver_profile_id = $1
      ORDER BY updated_at DESC
      LIMIT 1
    `, driverProfileId);

    if (locations.length === 0) {
      return NextResponse.json(
        { success: false, error: "No location data available" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      location: locations[0],
    });
  } catch (error) {
    console.error("Error getting driver location:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get driver location" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/drivers/[driverProfileId]/location — Update driver GPS location
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; driverProfileId: string }> }
) {
  try {
    const { tenantId, driverProfileId } = await params;
    const body = await request.json();

    const { lat, lng, heading, speed, accuracy } = body;

    if (lat === undefined || lng === undefined) {
      return NextResponse.json(
        { success: false, error: "lat and lng are required" },
        { status: 400 }
      );
    }

    // Validate coordinates
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json(
        { success: false, error: "Invalid coordinates" },
        { status: 400 }
      );
    }

    // Verify driver belongs to tenant
    const drivers: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM driver_profiles WHERE id = $1 AND tenant_id = $2
    `, driverProfileId, tenantId);

    if (drivers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    // Upsert driver location
    const location: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO driver_locations (id, driver_profile_id, lat, lng, heading, speed, accuracy, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (driver_profile_id)
      DO UPDATE SET
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        heading = EXCLUDED.heading,
        speed = EXCLUDED.speed,
        accuracy = EXCLUDED.accuracy,
        updated_at = NOW()
      RETURNING *
    `, crypto.randomUUID(), driverProfileId, lat, lng, heading || 0, speed || 0, accuracy || 0);

    return NextResponse.json({
      success: true,
      location: location[0],
    });
  } catch (error) {
    console.error("Error updating driver location:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update driver location" },
      { status: 500 }
    );
  }
}
