import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/tenants/[tenantId]/drivers/[driverProfileId]/status — Go online/offline/break
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; driverProfileId: string }> }
) {
  try {
    const { tenantId, driverProfileId } = await params;
    const body = await request.json();

    const { dutyStatus } = body;

    if (!dutyStatus) {
      return NextResponse.json(
        { success: false, error: "dutyStatus is required" },
        { status: 400 }
      );
    }

    const validStatuses = ["online", "offline", "break"];
    if (!validStatuses.includes(dutyStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid dutyStatus: ${dutyStatus}. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify driver exists and is active
    const drivers: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, is_active, duty_status FROM driver_profiles
      WHERE id = $1 AND tenant_id = $2
    `, driverProfileId, tenantId);

    if (drivers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    if (!drivers[0].is_active) {
      return NextResponse.json(
        { success: false, error: "Driver is deactivated" },
        { status: 400 }
      );
    }

    // If going offline, check for active trips
    if (dutyStatus === "offline") {
      const activeTrips: any[] = await prisma.$queryRawUnsafe(`
        SELECT id FROM trips
        WHERE driver_profile_id = $1
          AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
      `, driverProfileId);

      if (activeTrips.length > 0) {
        return NextResponse.json(
          { success: false, error: "Cannot go offline with active trips. Complete or cancel active trips first." },
          { status: 400 }
        );
      }
    }

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE driver_profiles
      SET duty_status = $1, updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3
      RETURNING *
    `, dutyStatus, driverProfileId, tenantId);

    return NextResponse.json({
      success: true,
      driver: updated[0],
      previousStatus: drivers[0].duty_status,
    });
  } catch (error) {
    console.error("Error updating driver status:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update driver status" },
      { status: 500 }
    );
  }
}
