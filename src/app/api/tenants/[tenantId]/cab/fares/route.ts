import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/cab/fares — List all fare rules
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        id, tenant_id, name, vehicle_type, is_default,
        base_fare, minimum_fare, per_km_rate, per_minute_rate,
        booking_fee, waiting_rate_per_minute, free_waiting_minutes,
        long_distance_km, long_distance_rate,
        peak_multiplier, peak_hours, night_multiplier, night_start, night_end,
        weekend_multiplier, holiday_multiplier,
        cancellation_fee, free_cancel_minutes,
        tax_included, is_active, created_at, updated_at
      FROM fare_rules
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
    `, tenantId);

    const fareRules = rows.map((r: any) => {
      // Parse peak_hours JSONB for frontend-friendly start/end
      const peakHoursObj = typeof r.peak_hours === "string"
        ? (() => { try { return JSON.parse(r.peak_hours); } catch { return null; } })()
        : r.peak_hours;

      return {
        id: r.id,
        tenantId: r.tenant_id,
        name: r.name,
        vehicleType: r.vehicle_type,
        isDefault: r.is_default,
        baseFare: r.base_fare != null ? Number(r.base_fare) : 0,
        minimumFare: r.minimum_fare != null ? Number(r.minimum_fare) : 0,
        perKm: r.per_km_rate != null ? Number(r.per_km_rate) : 0,
        perKmRate: r.per_km_rate != null ? Number(r.per_km_rate) : 0,
        perMinute: r.per_minute_rate != null ? Number(r.per_minute_rate) : 0,
        perMinuteRate: r.per_minute_rate != null ? Number(r.per_minute_rate) : 0,
        bookingFee: r.booking_fee != null ? Number(r.booking_fee) : 0,
        waitingPerMinute: r.waiting_rate_per_minute != null ? Number(r.waiting_rate_per_minute) : 0,
        waitingRatePerMinute: r.waiting_rate_per_minute != null ? Number(r.waiting_rate_per_minute) : 0,
        freeWaitingMinutes: r.free_waiting_minutes,
        longDistanceKm: r.long_distance_km,
        longDistanceRate: r.long_distance_rate,
        peakHoursMultiplier: r.peak_multiplier != null ? Number(r.peak_multiplier) : 1.0,
        peakMultiplier: r.peak_multiplier != null ? Number(r.peak_multiplier) : 1.0,
        peakHoursStart: peakHoursObj?.start || null,
        peakHoursEnd: peakHoursObj?.end || null,
        peakHours: r.peak_hours,
        nightRateMultiplier: r.night_multiplier != null ? Number(r.night_multiplier) : 1.0,
        nightMultiplier: r.night_multiplier != null ? Number(r.night_multiplier) : 1.0,
        nightRateStart: r.night_start,
        nightRateEnd: r.night_end,
        nightStart: r.night_start,
        nightEnd: r.night_end,
        weekendMultiplier: r.weekend_multiplier != null ? Number(r.weekend_multiplier) : 1.0,
        holidayMultiplier: r.holiday_multiplier != null ? Number(r.holiday_multiplier) : 1.0,
        cancellationFee: r.cancellation_fee != null ? Number(r.cancellation_fee) : 0,
        freeCancelMinutes: r.free_cancel_minutes,
        taxIncluded: r.tax_included,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    return NextResponse.json({ success: true, fareRules });
  } catch (error: any) {
    console.error("[CAB] Error listing fare rules:", error);
    return NextResponse.json(
      { success: false, error: "Failed to list fare rules" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/cab/fares — Create a fare rule
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
      isDefault,
      baseFare,
      perKm,
      perMinute,
      waitingPerMinute,
      minimumFare,
      bookingFee,
      cancellationFee,
      peakHoursMultiplier,
      peakHoursStart,
      peakHoursEnd,
      nightRateMultiplier,
      nightRateStart,
      nightRateEnd,
      weekendMultiplier,
      holidayMultiplier,
    } = body;

    if (!name || !vehicleType) {
      return NextResponse.json(
        { success: false, error: "name and vehicleType are required" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();

    // Build peak_hours JSONB if start/end provided
    const peakHours =
      peakHoursStart && peakHoursEnd
        ? JSON.stringify({ start: peakHoursStart, end: peakHoursEnd })
        : null;

    const rows: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO fare_rules (
        id, tenant_id, name, vehicle_type, is_default,
        base_fare, minimum_fare, per_km_rate, per_minute_rate,
        booking_fee, waiting_rate_per_minute,
        peak_multiplier, peak_hours,
        night_multiplier, night_start, night_end,
        weekend_multiplier, holiday_multiplier,
        cancellation_fee,
        is_active, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11,
        $12, $13::jsonb,
        $14, $15, $16,
        $17, $18,
        $19,
        true, NOW(), NOW()
      )
      RETURNING *
    `,
      id,
      tenantId,
      name,
      vehicleType,
      isDefault ?? false,
      baseFare ?? 0,
      minimumFare ?? 0,
      perKm ?? 0,
      perMinute ?? 0,
      bookingFee ?? 0,
      waitingPerMinute ?? 0,
      peakHoursMultiplier ?? 1.0,
      peakHours,
      nightRateMultiplier ?? 1.0,
      nightRateStart ?? null,
      nightRateEnd ?? null,
      weekendMultiplier ?? 1.0,
      holidayMultiplier ?? 1.0,
      cancellationFee ?? 0
    );

    return NextResponse.json({ success: true, fareRule: rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error("[CAB] Error creating fare rule:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create fare rule" },
      { status: 500 }
    );
  }
}
