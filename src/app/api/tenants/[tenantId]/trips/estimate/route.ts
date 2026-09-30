import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/tenants/[tenantId]/trips/estimate — Get fare estimate
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const { pickupLat, pickupLng, dropoffLat, dropoffLng, vehicleType } = body;

    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      return NextResponse.json(
        { success: false, error: "pickupLat, pickupLng, dropoffLat, dropoffLng are required" },
        { status: 400 }
      );
    }

    // Calculate distance using Haversine formula (in km)
    const R = 6371; // Earth radius in km
    const dLat = ((dropoffLat - pickupLat) * Math.PI) / 180;
    const dLng = ((dropoffLng - pickupLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((pickupLat * Math.PI) / 180) *
        Math.cos((dropoffLat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = R * c;

    // Estimate duration (avg 30 km/h city speed)
    const estimatedMinutes = Math.ceil((distanceKm / 30) * 60);

    // Get fare rules for this tenant and vehicle type
    const fareRules: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM fare_rules
      WHERE tenant_id = $1
        AND (vehicle_type = $2 OR vehicle_type IS NULL OR vehicle_type = 'ALL')
        AND is_active = true
      ORDER BY
        CASE WHEN vehicle_type = $2 THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 1
    `, tenantId, vehicleType || "SEDAN");

    let baseFareCents = 500; // default $5.00
    let perKmCents = 200;    // default $2.00/km
    let perMinCents = 30;    // default $0.30/min
    let minimumFareCents = 800; // default $8.00
    let bookingFeeCents = 200;  // default $2.00

    if (fareRules.length > 0) {
      const rule = fareRules[0];
      baseFareCents = rule.base_fare_cents ?? baseFareCents;
      perKmCents = rule.per_km_cents ?? perKmCents;
      perMinCents = rule.per_min_cents ?? perMinCents;
      minimumFareCents = rule.minimum_fare_cents ?? minimumFareCents;
      bookingFeeCents = rule.booking_fee_cents ?? bookingFeeCents;
    }

    // Check for zone surcharges
    let surchargesCents = 0;
    const zones: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM zones
      WHERE tenant_id = $1 AND is_active = true
        AND zone_type = 'SURCHARGE'
    `, tenantId);

    // Apply zone surcharges if pickup or dropoff is in a surcharge zone
    // Simplified: check if point is within zone boundary (would need PostGIS for real implementation)
    for (const zone of zones) {
      if (zone.surcharge_cents) {
        // In production, use ST_Contains with PostGIS geometry
        surchargesCents += zone.surcharge_cents;
      }
    }

    // Calculate fare
    const distanceFareCents = Math.round(distanceKm * perKmCents);
    const timeFareCents = Math.round(estimatedMinutes * perMinCents);
    let totalFareCents = baseFareCents + distanceFareCents + timeFareCents + bookingFeeCents + surchargesCents;

    // Apply minimum fare
    if (totalFareCents < minimumFareCents) {
      totalFareCents = minimumFareCents;
    }

    // Provide a range (low -10%, high +20%)
    const lowEstimateCents = Math.round(totalFareCents * 0.9);
    const highEstimateCents = Math.round(totalFareCents * 1.2);

    return NextResponse.json({
      success: true,
      estimate: {
        distanceKm: Math.round(distanceKm * 100) / 100,
        estimatedMinutes,
        baseFareCents,
        distanceFareCents,
        timeFareCents,
        bookingFeeCents,
        surchargesCents,
        totalFareCents,
        lowEstimateCents,
        highEstimateCents,
        currency: "USD",
        fareRuleApplied: fareRules.length > 0 ? fareRules[0].id : null,
      },
    });
  } catch (error) {
    console.error("Error calculating fare estimate:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to calculate fare estimate" },
      { status: 500 }
    );
  }
}
