import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRideSession } from "@/lib/ride-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> }
) {
  try {
    const session = await getRideSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tripId } = await params;

    const trips: any[] = await prisma.$queryRawUnsafe(
      `SELECT t.*,
              CONCAT_WS(' ', m.first_name, m.last_name) AS driver_name,
              dp.rating AS driver_rating_avg, dp.photo_url AS driver_photo,
              v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model,
              v.color AS vehicle_color, v.vehicle_type
       FROM trips t
       LEFT JOIN driver_profiles dp ON t.driver_profile_id = dp.id
       LEFT JOIN memberships m ON dp.membership_id = m.id
       LEFT JOIN vehicles v ON t.vehicle_id = v.id
       WHERE t.id = $1::uuid AND t.tenant_id = $2::uuid AND t.customer_email = $3`,
      tripId, session.tenantId, session.email
    );

    if (!trips.length) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    const t = trips[0];

    return NextResponse.json({
      success: true,
      trip: {
        id: t.id,
        tripNumber: t.trip_number,
        status: t.status?.toLowerCase(),
        pickupAddress: t.pickup_address,
        pickupLat: t.pickup_lat ? Number(t.pickup_lat) : null,
        pickupLng: t.pickup_lng ? Number(t.pickup_lng) : null,
        dropoffAddress: t.dropoff_address,
        dropoffLat: t.dropoff_lat ? Number(t.dropoff_lat) : null,
        dropoffLng: t.dropoff_lng ? Number(t.dropoff_lng) : null,
        distance: t.actual_distance_km ? Number(t.actual_distance_km) : t.estimated_distance_km ? Number(t.estimated_distance_km) : null,
        duration: t.actual_duration_minutes || t.estimated_duration_minutes || null,
        fare: t.total ? Number(t.total) : t.estimated_fare ? Number(t.estimated_fare) : null,
        baseFare: t.base_fare,
        distanceFare: t.distance_fare,
        timeFare: t.time_fare,
        bookingFee: t.booking_fee,
        surcharge: t.surcharge,
        tip: t.tip_amount,
        currency: t.currency || "CAD",
        paymentMethod: t.payment_method || "cash",
        rideType: t.ride_type,
        passengerCount: t.passenger_count,
        driverName: t.driver_name || null,
        driverPhoto: t.driver_photo || null,
        driverRating: t.driver_rating_avg ? Number(t.driver_rating_avg) : null,
        vehiclePlate: t.plate_number || null,
        vehicle: t.vehicle_make ? `${t.vehicle_color || ""} ${t.vehicle_make} ${t.vehicle_model}`.trim() : null,
        vehicleType: t.vehicle_type || null,
        customerRating: t.customer_rating,
        customerFeedback: t.customer_feedback,
        requestedAt: t.requested_at,
        assignedAt: t.assigned_at,
        startedAt: t.started_at,
        completedAt: t.completed_at,
        cancelledAt: t.cancelled_at,
        cancelReason: t.cancel_reason,
        createdAt: t.created_at,
      },
    });
  } catch (error) {
    console.error("[RIDE] Trip detail error:", error);
    return NextResponse.json({ error: "Failed to load trip" }, { status: 500 });
  }
}
