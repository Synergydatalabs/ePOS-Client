import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/fares — List fare rules
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const vehicleType = searchParams.get("vehicleType");
    const isActive = searchParams.get("isActive");

    let whereClause = `WHERE tenant_id = $1`;
    if (vehicleType) whereClause += ` AND vehicle_type = '${vehicleType}'`;
    if (isActive !== null && isActive !== undefined && isActive !== "") {
      whereClause += ` AND is_active = ${isActive === "true"}`;
    }

    const fareRules = await prisma.$queryRawUnsafe(`
      SELECT * FROM fare_rules
      ${whereClause}
      ORDER BY vehicle_type ASC, created_at DESC
    `, tenantId);

    return NextResponse.json({ success: true, fareRules });
  } catch (error) {
    console.error("Error listing fare rules:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list fare rules" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/fares — Create fare rule
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const {
      name,
      vehicleType,
      baseFareCents,
      perKmCents,
      perMinCents,
      minimumFareCents,
      bookingFeeCents,
      cancellationFeeCents,
      waitingPerMinCents,
      surgeMultiplier,
      peakHoursStart,
      peakHoursEnd,
      peakSurgeMultiplier,
      nightSurgeMultiplier,
      nightStart,
      nightEnd,
    } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: "name is required" },
        { status: 400 }
      );
    }

    const fareId = crypto.randomUUID();

    const fareRule: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO fare_rules (
        id, tenant_id, name, vehicle_type,
        base_fare_cents, per_km_cents, per_min_cents,
        minimum_fare_cents, booking_fee_cents, cancellation_fee_cents,
        waiting_per_min_cents, surge_multiplier,
        peak_hours_start, peak_hours_end, peak_surge_multiplier,
        night_surge_multiplier, night_start, night_end,
        is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10,
        $11, $12,
        $13, $14, $15,
        $16, $17, $18,
        true, NOW(), NOW()
      )
      RETURNING *
    `,
      fareId, tenantId, name, vehicleType || "ALL",
      baseFareCents || 500, perKmCents || 200, perMinCents || 30,
      minimumFareCents || 800, bookingFeeCents || 200, cancellationFeeCents || 500,
      waitingPerMinCents || 50, surgeMultiplier || 1.0,
      peakHoursStart || null, peakHoursEnd || null, peakSurgeMultiplier || 1.0,
      nightSurgeMultiplier || 1.0, nightStart || null, nightEnd || null
    );

    return NextResponse.json({ success: true, fareRule: fareRule[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating fare rule:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create fare rule" },
      { status: 500 }
    );
  }
}
