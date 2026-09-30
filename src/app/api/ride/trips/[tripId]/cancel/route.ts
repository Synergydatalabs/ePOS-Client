import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRideSession } from "@/lib/ride-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  try {
    const session = await getRideSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tripId } = await params;
    const { reason } = await request.json();

    // Verify trip belongs to customer and is cancellable
    const trips: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, status FROM trips
       WHERE id = $1::uuid AND tenant_id = $2::uuid AND customer_email = $3`,
      tripId, session.tenantId, session.email
    );

    if (!trips.length) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    const status = trips[0].status?.toLowerCase();
    if (!["searching", "assigned"].includes(status)) {
      return NextResponse.json({ error: "This trip cannot be cancelled" }, { status: 400 });
    }

    // Cancel the trip
    await prisma.$queryRawUnsafe(
      `UPDATE trips SET status = 'CANCELLED', cancel_reason = $1, cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $2::uuid AND tenant_id = $3::uuid`,
      reason || "Cancelled by customer", tripId, session.tenantId
    );

    // Log status change
    await prisma.$queryRawUnsafe(
      `INSERT INTO trip_status_logs (id, trip_id, status, changed_by, note, created_at)
       VALUES (gen_random_uuid(), $1::uuid, 'CANCELLED', 'customer', $2, NOW())`,
      tripId, reason || "Cancelled by customer"
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[RIDE] Cancel trip error:", error);
    return NextResponse.json({ error: "Failed to cancel trip" }, { status: 500 });
  }
}
