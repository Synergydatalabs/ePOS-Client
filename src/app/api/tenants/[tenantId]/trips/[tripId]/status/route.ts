import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Valid state transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  REQUESTED: ["SEARCHING", "ASSIGNED", "CANCELLED", "NO_DRIVERS"],
  SEARCHING: ["ASSIGNED", "CANCELLED", "NO_DRIVERS"],
  ASSIGNED: ["DRIVER_EN_ROUTE", "CANCELLED"],
  DRIVER_EN_ROUTE: ["DRIVER_ARRIVED", "CANCELLED"],
  DRIVER_ARRIVED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_DRIVERS: ["SEARCHING", "ASSIGNED", "CANCELLED"],
};

// POST /api/tenants/[tenantId]/trips/[tripId]/status — Update trip status
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; tripId: string }> }
) {
  try {
    const { tenantId, tripId } = await params;
    const body = await request.json();

    const { newStatus, notes, lat, lng } = body;

    if (!newStatus) {
      return NextResponse.json(
        { success: false, error: "newStatus is required" },
        { status: 400 }
      );
    }

    const validStatuses = [
      "REQUESTED", "SEARCHING", "ASSIGNED", "DRIVER_EN_ROUTE",
      "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_DRIVERS",
    ];

    if (!validStatuses.includes(newStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid status: ${newStatus}` },
        { status: 400 }
      );
    }

    // Get current trip
    const trips: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, status, driver_profile_id FROM trips
      WHERE id = $1 AND tenant_id = $2
    `, tripId, tenantId);

    if (trips.length === 0) {
      return NextResponse.json(
        { success: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    const currentStatus = trips[0].status;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed || !allowed.includes(newStatus)) {
      return NextResponse.json(
        { success: false, error: `Cannot transition from ${currentStatus} to ${newStatus}` },
        { status: 400 }
      );
    }

    // Build additional update fields based on the new status
    let extraSets = "";
    const extraValues: any[] = [];
    let extraParamIdx = 4; // $1=status, $2=tripId, $3=tenantId

    if (newStatus === "COMPLETED") {
      extraSets += `, completed_at = NOW()`;
    } else if (newStatus === "CANCELLED") {
      extraSets += `, cancelled_at = NOW()`;
    } else if (newStatus === "IN_PROGRESS") {
      extraSets += `, started_at = NOW()`;
    } else if (newStatus === "DRIVER_ARRIVED") {
      extraSets += `, driver_arrived_at = NOW()`;
    }

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE trips
      SET status = $1, updated_at = NOW() ${extraSets}
      WHERE id = $2 AND tenant_id = $3
      RETURNING *
    `, newStatus, tripId, tenantId);

    // Insert status log entry
    await prisma.$queryRawUnsafe(`
      INSERT INTO trip_status_log (id, trip_id, status, notes, lat, lng, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, crypto.randomUUID(), tripId, newStatus, notes || null, lat || null, lng || null);

    // If trip completed, update driver duty status and record earnings
    if (newStatus === "COMPLETED" && trips[0].driver_profile_id) {
      await prisma.$queryRawUnsafe(`
        UPDATE driver_profiles SET duty_status = 'online', updated_at = NOW()
        WHERE id = $1
      `, trips[0].driver_profile_id);
    }

    return NextResponse.json({ success: true, trip: updated[0] });
  } catch (error) {
    console.error("Error updating trip status:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update trip status" },
      { status: 500 }
    );
  }
}
