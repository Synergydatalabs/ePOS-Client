import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRideSession } from "@/lib/ride-auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getRideSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const trips: any[] = await prisma.$queryRawUnsafe(
      `SELECT t.*,
              CONCAT_WS(' ', m.first_name, m.last_name) AS driver_name,
              v.plate_number, v.make AS vehicle_make, v.model AS vehicle_model, v.color AS vehicle_color
       FROM trips t
       LEFT JOIN driver_profiles dp ON t.driver_profile_id = dp.id
       LEFT JOIN memberships m ON dp.membership_id = m.id
       LEFT JOIN vehicles v ON t.vehicle_id = v.id
       WHERE t.tenant_id = $1::uuid AND t.customer_email = $2
       ORDER BY t.created_at DESC
       LIMIT 50`,
      session.tenantId, session.email
    );

    const mapped = trips.map((t) => ({
      id: t.id,
      tripNumber: t.trip_number,
      status: t.status?.toLowerCase(),
      pickupAddress: t.pickup_address,
      dropoffAddress: t.dropoff_address,
      distance: t.actual_distance_km ? Number(t.actual_distance_km) : t.estimated_distance_km ? Number(t.estimated_distance_km) : null,
      duration: t.actual_duration_minutes || t.estimated_duration_minutes || null,
      fare: t.total ? Number(t.total) : t.estimated_fare ? Number(t.estimated_fare) : null,
      currency: t.currency || "CAD",
      paymentMethod: t.payment_method || "cash",
      rideType: t.ride_type,
      driverName: t.driver_name || null,
      vehiclePlate: t.plate_number || null,
      vehicle: t.vehicle_make ? `${t.vehicle_color || ""} ${t.vehicle_make} ${t.vehicle_model}`.trim() : null,
      customerRating: t.customer_rating,
      driverRating: t.driver_rating,
      createdAt: t.created_at,
      completedAt: t.completed_at,
      cancelledAt: t.cancelled_at,
    }));

    return NextResponse.json({ success: true, trips: mapped });
  } catch (error) {
    console.error("[RIDE] Trips error:", error);
    return NextResponse.json({ error: "Failed to load trips" }, { status: 500 });
  }
}
