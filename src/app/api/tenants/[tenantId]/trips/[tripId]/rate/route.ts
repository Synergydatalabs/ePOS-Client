import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/tenants/[tenantId]/trips/[tripId]/rate — Submit a trip rating
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; tripId: string }> }
) {
  try {
    const { tenantId, tripId } = await params;
    const body = await request.json();

    const { raterType, raterId, rating, feedback, tags } = body;

    if (!raterType || !rating) {
      return NextResponse.json(
        { success: false, error: "raterType and rating are required" },
        { status: 400 }
      );
    }

    if (!["CUSTOMER", "DRIVER"].includes(raterType)) {
      return NextResponse.json(
        { success: false, error: "raterType must be CUSTOMER or DRIVER" },
        { status: 400 }
      );
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { success: false, error: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    // Verify trip exists and is completed
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

    if (trips[0].status !== "COMPLETED") {
      return NextResponse.json(
        { success: false, error: "Can only rate completed trips" },
        { status: 400 }
      );
    }

    // Check for existing rating from same rater type
    const existing: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM trip_ratings
      WHERE trip_id = $1 AND rater_type = $2
    `, tripId, raterType);

    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: "Rating already submitted for this trip" },
        { status: 409 }
      );
    }

    const ratingId = crypto.randomUUID();
    const ratingRecord: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO trip_ratings (id, trip_id, rater_type, rater_id, rating, feedback, tags, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `, ratingId, tripId, raterType, raterId || null, rating, feedback || null,
      tags ? JSON.stringify(tags) : null
    );

    // Update driver average rating if rated by customer
    if (raterType === "CUSTOMER" && trips[0].driver_profile_id) {
      await prisma.$queryRawUnsafe(`
        UPDATE driver_profiles
        SET avg_rating = (
          SELECT AVG(tr.rating)::numeric(3,2)
          FROM trip_ratings tr
          JOIN trips t ON tr.trip_id = t.id
          WHERE t.driver_profile_id = $1 AND tr.rater_type = 'CUSTOMER'
        ),
        total_ratings = (
          SELECT COUNT(*)::int
          FROM trip_ratings tr
          JOIN trips t ON tr.trip_id = t.id
          WHERE t.driver_profile_id = $1 AND tr.rater_type = 'CUSTOMER'
        ),
        updated_at = NOW()
        WHERE id = $1
      `, trips[0].driver_profile_id);
    }

    return NextResponse.json({ success: true, rating: ratingRecord[0] }, { status: 201 });
  } catch (error) {
    console.error("Error submitting rating:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to submit rating" },
      { status: 500 }
    );
  }
}
