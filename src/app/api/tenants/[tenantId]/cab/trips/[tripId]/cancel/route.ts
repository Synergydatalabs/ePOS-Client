// POST /api/tenants/[tenantId]/cab/trips/[tripId]/cancel — Cancel a trip

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; tripId: string }> }
) {
  try {
    const { tenantId, tripId } = await params;
    const body = await request.json();
    const { reason } = body;

    // Get current trip (need status + driver_profile_id)
    const trips: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, status, driver_profile_id FROM trips WHERE id = $1::uuid AND tenant_id = $2::uuid`,
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
    const driverProfileId = trips[0].driver_profile_id;

    if (currentStatus === "CANCELLED" || currentStatus === "COMPLETED") {
      return NextResponse.json(
        { error: `Trip is already ${currentStatus.toLowerCase()}` },
        { status: 400 }
      );
    }

    // Cancel the trip
    await prisma.$queryRawUnsafe(
      `UPDATE trips
       SET status = 'CANCELLED',
           cancel_reason = $3,
           cancelled_by = 'admin',
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      tripId,
      tenantId,
      reason || null
    );

    // If trip had a driver, free them up
    if (driverProfileId) {
      await prisma.$queryRawUnsafe(
        `UPDATE driver_profiles
         SET duty_status = 'online',
             is_available = true,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        driverProfileId
      );
    }

    // Log status change
    await prisma.$queryRawUnsafe(
      `INSERT INTO trip_status_log (trip_id, from_status, to_status, changed_by, notes)
       VALUES ($1::uuid, $2, 'CANCELLED', 'admin', $3)`,
      tripId,
      currentStatus,
      reason || 'Trip cancelled by admin'
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[CAB] Cancel trip error:", error);
    return NextResponse.json(
      { error: "Failed to cancel trip" },
      { status: 500 }
    );
  }
}
