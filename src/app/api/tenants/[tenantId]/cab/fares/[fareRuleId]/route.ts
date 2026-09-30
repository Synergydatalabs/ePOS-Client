import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// PUT /api/tenants/[tenantId]/cab/fares/[fareRuleId] — Update a fare rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; fareRuleId: string }> }
) {
  try {
    const { tenantId, fareRuleId } = await params;
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

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const addField = (column: string, value: any) => {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    };

    addField("name", name);
    addField("vehicle_type", vehicleType);
    addField("is_default", isDefault);
    addField("base_fare", baseFare);
    addField("minimum_fare", minimumFare);
    addField("per_km_rate", perKm);
    addField("per_minute_rate", perMinute);
    addField("booking_fee", bookingFee);
    addField("waiting_rate_per_minute", waitingPerMinute);
    addField("cancellation_fee", cancellationFee);
    addField("peak_multiplier", peakHoursMultiplier);
    addField("night_multiplier", nightRateMultiplier);
    addField("night_start", nightRateStart);
    addField("night_end", nightRateEnd);
    addField("weekend_multiplier", weekendMultiplier);
    addField("holiday_multiplier", holidayMultiplier);

    // Handle peak_hours JSONB separately
    if (peakHoursStart !== undefined && peakHoursEnd !== undefined) {
      setClauses.push(`peak_hours = $${paramIndex}::jsonb`);
      values.push(JSON.stringify({ start: peakHoursStart, end: peakHoursEnd }));
      paramIndex++;
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = NOW()`);

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE fare_rules
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex}::uuid AND tenant_id = $${paramIndex + 1}::uuid
      RETURNING *
    `, ...values, fareRuleId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Fare rule not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, fareRule: updated[0] });
  } catch (error: any) {
    console.error("[CAB] Error updating fare rule:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update fare rule" },
      { status: 500 }
    );
  }
}
