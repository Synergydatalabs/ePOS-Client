import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getRideSession } from "@/lib/ride-auth";

export async function POST(request: NextRequest) {
  try {
    const session = await getRideSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { distanceKm, durationMinutes, vehicleType } = await request.json();

    if (!distanceKm || !durationMinutes) {
      return NextResponse.json({ error: "distanceKm and durationMinutes are required" }, { status: 400 });
    }

    // Get fare rules for this tenant + vehicle type
    const fareRules: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM fare_rules
       WHERE tenant_id = $1::uuid AND is_active = true
       AND ($2::text IS NULL OR vehicle_type = $2)
       ORDER BY is_default DESC, vehicle_type ASC`,
      session.tenantId,
      vehicleType || null
    );

    if (!fareRules.length) {
      // Fall back to default fare
      return NextResponse.json({
        success: true,
        estimates: [{
          vehicleType: vehicleType || "sedan",
          baseFare: 350,
          distanceFare: Math.round(distanceKm * 175),
          timeFare: Math.round(durationMinutes * 35),
          bookingFee: 200,
          subtotal: 350 + Math.round(distanceKm * 175) + Math.round(durationMinutes * 35) + 200,
          total: Math.max(700, 350 + Math.round(distanceKm * 175) + Math.round(durationMinutes * 35) + 200),
          currency: "CAD",
          estimatedMinutes: Math.round(durationMinutes),
        }],
      });
    }

    // Calculate estimates for each available vehicle type
    const estimates = fareRules.map((rule) => {
      const baseFare = rule.base_fare || 350;
      const perKm = rule.per_km_rate || 175;
      const perMin = rule.per_minute_rate || 35;
      const bookingFee = rule.booking_fee || 200;
      const minimumFare = rule.minimum_fare || 700;

      const distanceFare = Math.round(distanceKm * perKm);
      const timeFare = Math.round(durationMinutes * perMin);
      const subtotal = baseFare + distanceFare + timeFare + bookingFee;
      const total = Math.max(minimumFare, subtotal);

      return {
        fareRuleId: rule.id,
        vehicleType: rule.vehicle_type,
        name: rule.name,
        baseFare,
        distanceFare,
        timeFare,
        bookingFee,
        subtotal,
        total,
        minimumFare,
        currency: "CAD",
        estimatedMinutes: Math.round(durationMinutes),
        distanceKm: Number(distanceKm.toFixed(1)),
      };
    });

    return NextResponse.json({ success: true, estimates });
  } catch (error) {
    console.error("[RIDE] Estimate error:", error);
    return NextResponse.json({ error: "Failed to calculate fare" }, { status: 500 });
  }
}
