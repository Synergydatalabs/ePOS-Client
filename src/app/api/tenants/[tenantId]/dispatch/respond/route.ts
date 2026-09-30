import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/tenants/[tenantId]/dispatch/respond — Driver responds to dispatch request
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const { dispatchId, accepted } = body;

    if (!dispatchId || accepted === undefined) {
      return NextResponse.json(
        { success: false, error: "dispatchId and accepted are required" },
        { status: 400 }
      );
    }

    // Get dispatch entry
    const dispatches: any[] = await prisma.$queryRawUnsafe(`
      SELECT dq.*, t.tenant_id, t.status AS trip_status
      FROM dispatch_queue dq
      JOIN trips t ON dq.trip_id = t.id
      WHERE dq.id = $1 AND t.tenant_id = $2
    `, dispatchId, tenantId);

    if (dispatches.length === 0) {
      return NextResponse.json(
        { success: false, error: "Dispatch entry not found" },
        { status: 404 }
      );
    }

    const dispatch = dispatches[0];

    if (dispatch.status !== "PENDING") {
      return NextResponse.json(
        { success: false, error: `Dispatch already ${dispatch.status}` },
        { status: 400 }
      );
    }

    // Check if dispatch has expired
    if (dispatch.expires_at && new Date(dispatch.expires_at) < new Date()) {
      await prisma.$queryRawUnsafe(`
        UPDATE dispatch_queue SET status = 'EXPIRED', responded_at = NOW()
        WHERE id = $1
      `, dispatchId);

      return NextResponse.json(
        { success: false, error: "Dispatch request has expired" },
        { status: 400 }
      );
    }

    if (accepted) {
      // Check if trip is still available (not already assigned)
      const tripCheck: any[] = await prisma.$queryRawUnsafe(`
        SELECT status FROM trips WHERE id = $1
      `, dispatch.trip_id);

      if (tripCheck.length === 0 || !["SEARCHING", "REQUESTED", "NO_DRIVERS"].includes(tripCheck[0].status)) {
        await prisma.$queryRawUnsafe(`
          UPDATE dispatch_queue SET status = 'MISSED', responded_at = NOW()
          WHERE id = $1
        `, dispatchId);

        return NextResponse.json(
          { success: false, error: "Trip is no longer available" },
          { status: 400 }
        );
      }

      // Accept: update dispatch entry
      await prisma.$queryRawUnsafe(`
        UPDATE dispatch_queue SET status = 'ACCEPTED', responded_at = NOW()
        WHERE id = $1
      `, dispatchId);

      // Reject all other pending dispatches for this trip
      await prisma.$queryRawUnsafe(`
        UPDATE dispatch_queue
        SET status = 'CANCELLED', responded_at = NOW()
        WHERE trip_id = $1 AND id != $2 AND status = 'PENDING'
      `, dispatch.trip_id, dispatchId);

      // Assign driver to trip
      const updated: any[] = await prisma.$queryRawUnsafe(`
        UPDATE trips
        SET driver_profile_id = $1, status = 'ASSIGNED', updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `, dispatch.driver_profile_id, dispatch.trip_id);

      // Update driver duty status to busy
      await prisma.$queryRawUnsafe(`
        UPDATE driver_profiles SET duty_status = 'busy', updated_at = NOW()
        WHERE id = $1
      `, dispatch.driver_profile_id);

      // Log status change
      await prisma.$queryRawUnsafe(`
        INSERT INTO trip_status_log (id, trip_id, status, notes, created_at)
        VALUES ($1, $2, 'ASSIGNED', $3, NOW())
      `, crypto.randomUUID(), dispatch.trip_id, `Driver accepted dispatch ${dispatchId}`);

      return NextResponse.json({
        success: true,
        accepted: true,
        trip: updated[0],
      });
    } else {
      // Decline: update dispatch entry
      await prisma.$queryRawUnsafe(`
        UPDATE dispatch_queue SET status = 'DECLINED', responded_at = NOW()
        WHERE id = $1
      `, dispatchId);

      // Check if all dispatches for this trip are resolved
      const pendingCount: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS pending
        FROM dispatch_queue
        WHERE trip_id = $1 AND status = 'PENDING'
      `, dispatch.trip_id);

      if (pendingCount[0].pending === 0) {
        // No more pending dispatches — mark trip as NO_DRIVERS
        await prisma.$queryRawUnsafe(`
          UPDATE trips SET status = 'NO_DRIVERS', updated_at = NOW()
          WHERE id = $1
        `, dispatch.trip_id);

        await prisma.$queryRawUnsafe(`
          INSERT INTO trip_status_log (id, trip_id, status, notes, created_at)
          VALUES ($1, $2, 'NO_DRIVERS', 'All dispatched drivers declined', NOW())
        `, crypto.randomUUID(), dispatch.trip_id);
      }

      return NextResponse.json({
        success: true,
        accepted: false,
        remainingPending: pendingCount[0].pending,
      });
    }
  } catch (error) {
    console.error("Error responding to dispatch:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to respond to dispatch" },
      { status: 500 }
    );
  }
}
