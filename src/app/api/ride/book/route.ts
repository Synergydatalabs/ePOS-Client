import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRideSession } from "@/lib/ride-auth";

export async function POST(request: NextRequest) {
  try {
    const session = await getRideSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      pickupAddress, pickupLat, pickupLng,
      dropoffAddress, dropoffLat, dropoffLng,
      vehicleType, fareRuleId,
      estimatedDistanceKm, estimatedDurationMinutes, estimatedFare,
      paymentMethod, rideType, passengerCount, notes,
    } = body;

    if (!pickupAddress || !pickupLat || !pickupLng || !dropoffAddress || !dropoffLat || !dropoffLng) {
      return NextResponse.json({ error: "Pickup and dropoff locations are required" }, { status: 400 });
    }

    // Generate trip number
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX(display_number), 0)::int + 1 AS next_num FROM trips WHERE tenant_id = $1::uuid`,
      session.tenantId
    );
    const displayNumber = countResult[0]?.next_num || 1;
    const tripNumber = `TR-${String(displayNumber).padStart(4, "0")}`;

    const tripId = crypto.randomUUID();

    const created: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO trips (
        id, tenant_id, trip_number, display_number,
        customer_name, customer_phone, customer_email, customer_membership_id,
        pickup_address, pickup_lat, pickup_lng, pickup_notes,
        dropoff_address, dropoff_lat, dropoff_lng,
        estimated_distance_km, estimated_duration_minutes, estimated_fare,
        fare_rule_id, ride_type, passenger_count,
        payment_method, status, dispatch_mode,
        requested_at, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4,
        $5, $6, $7, NULL,
        $8, $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17,
        $18::uuid, $19, $20,
        $21, 'SEARCHING', 'auto',
        NOW(), NOW(), NOW()
      ) RETURNING *`,
      tripId, session.tenantId, tripNumber, displayNumber,
      session.name, session.phone, session.email,
      pickupAddress, pickupLat, pickupLng, notes || null,
      dropoffAddress, dropoffLat, dropoffLng,
      estimatedDistanceKm || null, estimatedDurationMinutes || null, estimatedFare || 0,
      fareRuleId || null, rideType || "standard", passengerCount || 1,
      paymentMethod || "cash"
    );

    const t = created[0];

    // Log status
    await prisma.$queryRawUnsafe(
      `INSERT INTO trip_status_log (trip_id, from_status, to_status, changed_by, notes)
       VALUES ($1::uuid, NULL, 'SEARCHING', 'customer', 'Ride requested by customer')`,
      tripId
    );

    // Increment customer trip count
    await prisma.$queryRawUnsafe(
      `UPDATE ride_customers SET total_trips = total_trips + 1, updated_at = NOW() WHERE id = $1::uuid`,
      session.customerId
    );

    return NextResponse.json({
      success: true,
      trip: {
        id: t.id,
        tripNumber: t.trip_number,
        status: "searching",
        pickupAddress: t.pickup_address,
        dropoffAddress: t.dropoff_address,
        estimatedFare: t.estimated_fare,
        estimatedDuration: t.estimated_duration_minutes,
        rideType: t.ride_type,
        paymentMethod: t.payment_method,
        createdAt: t.created_at,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("[RIDE] Book error:", error);
    return NextResponse.json({ error: "Failed to book ride" }, { status: 500 });
  }
}
