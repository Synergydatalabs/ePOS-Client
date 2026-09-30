import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/tracking — Get all online driver locations for map display
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const dutyStatus = searchParams.get("dutyStatus"); // optional filter

    let statusFilter = `AND dp.duty_status IN ('online', 'busy')`;
    if (dutyStatus) {
      statusFilter = `AND dp.duty_status = '${dutyStatus}'`;
    }

    const drivers = await prisma.$queryRawUnsafe(`
      SELECT
        dp.id AS driver_profile_id,
        dl.lat,
        dl.lng,
        dl.heading,
        dl.speed,
        dp.driver_name,
        dp.duty_status AS status,
        dp.avg_rating,
        v.plate_number AS vehicle_plate,
        v.vehicle_type,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        v.color AS vehicle_color,
        dl.updated_at AS location_updated_at,
        (SELECT t.id FROM trips t
         WHERE t.driver_profile_id = dp.id
           AND t.status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
         ORDER BY t.created_at DESC LIMIT 1
        ) AS active_trip_id
      FROM driver_profiles dp
      JOIN driver_locations dl ON dp.id = dl.driver_profile_id
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      WHERE dp.tenant_id = $1
        AND dp.is_active = true
        ${statusFilter}
        AND dl.lat != 0 AND dl.lng != 0
      ORDER BY dp.driver_name ASC
    `, tenantId);

    return NextResponse.json({
      success: true,
      drivers,
      count: (drivers as any[]).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting tracking data:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get tracking data" },
      { status: 500 }
    );
  }
}
