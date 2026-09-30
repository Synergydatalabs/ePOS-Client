import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const ACTIVE_STATUSES = [
  "REQUESTED",
  "SEARCHING",
  "ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
];

// GET /api/tenants/[tenantId]/cab/trips — List trips with filters
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const search = searchParams.get("search");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Build dynamic WHERE clause — $1 is always tenantId
    const conditions: string[] = ["t.tenant_id = $1::uuid"];

    if (status === "active") {
      conditions.push(
        `t.status IN (${ACTIVE_STATUSES.map((s) => `'${s}'`).join(", ")})`
      );
    } else if (status) {
      conditions.push(`t.status = '${status.toUpperCase()}'`);
    }

    if (from) {
      conditions.push(`t.created_at >= '${from}'`);
    }

    if (to) {
      conditions.push(`t.created_at <= '${to}'`);
    }

    if (search) {
      const escaped = search.replace(/'/g, "''");
      conditions.push(
        `(t.customer_name ILIKE '%${escaped}%' OR t.customer_phone ILIKE '%${escaped}%' OR t.trip_number ILIKE '%${escaped}%')`
      );
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const trips = await prisma.$queryRawUnsafe(
      `
      SELECT
        t.id, t.tenant_id, t.location_id, t.trip_number, t.display_number,
        t.customer_name, t.customer_phone, t.customer_email, t.customer_membership_id,
        t.driver_profile_id, t.vehicle_id,
        t.pickup_address, t.pickup_lat, t.pickup_lng, t.pickup_notes,
        t.dropoff_address, t.dropoff_lat, t.dropoff_lng, t.dropoff_notes,
        t.estimated_distance_km, t.actual_distance_km,
        t.estimated_duration_minutes, t.actual_duration_minutes,
        t.estimated_fare, t.base_fare, t.distance_fare, t.time_fare,
        t.waiting_fare, t.surcharge, t.surcharge_label, t.discount_amount,
        t.subtotal, t.tax_amount, t.tip_amount, t.total, t.currency,
        t.fare_rule_id, t.peak_multiplier,
        t.status, t.cancel_reason, t.cancelled_by,
        t.payment_method, t.payment_status, t.order_id,
        t.is_scheduled, t.scheduled_at,
        t.ride_type, t.passenger_count, t.luggage,
        t.promo_code, t.promo_discount,
        t.requested_at, t.assigned_at, t.driver_arrived_at,
        t.started_at, t.completed_at, t.cancelled_at,
        t.dispatch_attempts, t.dispatch_mode,
        t.customer_rating, t.customer_feedback,
        t.driver_rating, t.driver_feedback,
        t.created_at, t.updated_at,
        CONCAT_WS(' ', m.first_name, m.last_name) AS driver_name,
        v.plate_number AS vehicle_plate
      FROM trips t
      LEFT JOIN driver_profiles dp ON t.driver_profile_id = dp.id
      LEFT JOIN memberships m ON dp.membership_id = m.id
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
      `,
      tenantId
    );

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total FROM trips t ${whereClause}`,
      tenantId
    );

    const mapped = (trips as any[]).map((t: any) => ({
      id: t.id,
      tenantId: t.tenant_id,
      locationId: t.location_id,
      tripNumber: t.trip_number,
      displayNumber: t.display_number,
      customerName: t.customer_name,
      customerPhone: t.customer_phone,
      customerEmail: t.customer_email,
      customerMembershipId: t.customer_membership_id,
      driverProfileId: t.driver_profile_id,
      driverId: t.driver_profile_id,
      vehicleId: t.vehicle_id,
      pickupAddress: t.pickup_address,
      pickupLat: t.pickup_lat,
      pickupLng: t.pickup_lng,
      pickupNotes: t.pickup_notes,
      dropoffAddress: t.dropoff_address,
      dropoffLat: t.dropoff_lat,
      dropoffLng: t.dropoff_lng,
      dropoffNotes: t.dropoff_notes,
      estimatedDistanceKm: t.estimated_distance_km,
      actualDistanceKm: t.actual_distance_km,
      estimatedDurationMinutes: t.estimated_duration_minutes,
      actualDurationMinutes: t.actual_duration_minutes,
      // Simplified aliases for frontend
      distance: t.actual_distance_km != null
        ? Number(t.actual_distance_km)
        : t.estimated_distance_km != null
          ? Number(t.estimated_distance_km)
          : null,
      duration: t.actual_duration_minutes != null
        ? Number(t.actual_duration_minutes)
        : t.estimated_duration_minutes != null
          ? Number(t.estimated_duration_minutes)
          : null,
      fare: t.total != null ? Number(t.total) : t.estimated_fare != null ? Number(t.estimated_fare) : null,
      estimatedFare: t.estimated_fare,
      baseFare: t.base_fare,
      distanceFare: t.distance_fare,
      timeFare: t.time_fare,
      waitingFare: t.waiting_fare,
      surcharge: t.surcharge,
      surchargeLabel: t.surcharge_label,
      discountAmount: t.discount_amount,
      subtotal: t.subtotal,
      taxAmount: t.tax_amount,
      tipAmount: t.tip_amount,
      total: t.total,
      currency: t.currency,
      fareRuleId: t.fare_rule_id,
      peakMultiplier: t.peak_multiplier,
      status: t.status?.toLowerCase(),
      cancelReason: t.cancel_reason,
      cancelledBy: t.cancelled_by,
      paymentMethod: t.payment_method || "cash",
      paymentStatus: t.payment_status,
      orderId: t.order_id,
      isScheduled: t.is_scheduled,
      scheduledAt: t.scheduled_at,
      rideType: t.ride_type,
      passengerCount: t.passenger_count,
      luggage: t.luggage,
      promoCode: t.promo_code,
      promoDiscount: t.promo_discount,
      notes: t.pickup_notes || t.dropoff_notes || null,
      requestedAt: t.requested_at,
      assignedAt: t.assigned_at,
      driverArrivedAt: t.driver_arrived_at,
      startedAt: t.started_at,
      completedAt: t.completed_at,
      cancelledAt: t.cancelled_at,
      dispatchAttempts: t.dispatch_attempts,
      dispatchMode: t.dispatch_mode,
      customerRating: t.customer_rating,
      customerFeedback: t.customer_feedback,
      driverRating: t.driver_rating,
      driverFeedback: t.driver_feedback,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      driverName: t.driver_name,
      vehiclePlate: t.vehicle_plate,
    }));

    return NextResponse.json({
      success: true,
      trips: mapped,
      pagination: {
        total: countResult[0]?.total || 0,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    console.error("[CAB] Error listing trips:", error);
    return NextResponse.json(
      { error: "Failed to list trips" },
      { status: 500 }
    );
  }
}
