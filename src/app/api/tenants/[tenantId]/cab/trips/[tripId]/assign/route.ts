// POST /api/tenants/[tenantId]/cab/trips/[tripId]/assign — Assign driver to trip

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; tripId: string }> }
) {
  try {
    const { tenantId, tripId } = await params;
    const body = await request.json();
    const { driverId } = body;

    if (!driverId) {
      return NextResponse.json(
        { error: "driverId is required" },
        { status: 400 }
      );
    }

    // Verify trip exists and belongs to tenant
    const trips: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, status FROM trips WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      tripId,
      tenantId
    );

    if (!trips.length) {
      return NextResponse.json(
        { error: "Trip not found" },
        { status: 404 }
      );
    }

    const currentStatus = trips[0].status;

    // Get driver's vehicle_id
    const drivers: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, vehicle_id, duty_status FROM driver_profiles WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      driverId,
      tenantId
    );

    if (!drivers.length) {
      return NextResponse.json(
        { error: "Driver not found in this tenant" },
        { status: 404 }
      );
    }

    const vehicleId = drivers[0].vehicle_id;

    // Assign driver to trip
    await prisma.$queryRawUnsafe(
      `UPDATE trips
       SET driver_profile_id = $3::uuid,
           vehicle_id = $4::uuid,
           status = 'ASSIGNED',
           assigned_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      tripId,
      tenantId,
      driverId,
      vehicleId
    );

    // Update driver status
    await prisma.$queryRawUnsafe(
      `UPDATE driver_profiles
       SET duty_status = 'on_trip',
           is_available = false,
           updated_at = NOW()
       WHERE id = $1::uuid`,
      driverId
    );

    // Log status change
    await prisma.$queryRawUnsafe(
      `INSERT INTO trip_status_log (trip_id, from_status, to_status, changed_by, notes)
       VALUES ($1::uuid, $2, 'ASSIGNED', 'admin', 'Driver manually assigned')`,
      tripId,
      currentStatus
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[CAB] Assign driver error:", error);
    return NextResponse.json(
      { error: "Failed to assign driver" },
      { status: 500 }
    );
  }
}
