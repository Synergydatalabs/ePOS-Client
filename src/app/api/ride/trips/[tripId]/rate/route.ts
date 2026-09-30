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
    const { rating, feedback } = await request.json();

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Rating must be 1-5" }, { status: 400 });
    }

    // Verify trip belongs to customer
    const trips: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, status FROM trips
       WHERE id = $1::uuid AND tenant_id = $2::uuid AND customer_email = $3`,
      tripId, session.tenantId, session.email
    );

    if (!trips.length) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    if (trips[0].status?.toLowerCase() !== "completed") {
      return NextResponse.json({ error: "Can only rate completed trips" }, { status: 400 });
    }

    // Update trip with rating
    await prisma.$queryRawUnsafe(
      `UPDATE trips SET customer_rating = $1, customer_feedback = $2, updated_at = NOW()
       WHERE id = $3::uuid AND tenant_id = $4::uuid`,
      rating, feedback || null, tripId, session.tenantId
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[RIDE] Rate trip error:", error);
    return NextResponse.json({ error: "Failed to submit rating" }, { status: 500 });
  }
}
