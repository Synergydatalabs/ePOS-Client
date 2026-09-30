import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/fares/[fareId] — Get fare rule details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; fareId: string }> }
) {
  try {
    const { tenantId, fareId } = await params;

    const fareRules: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM fare_rules WHERE id = $1 AND tenant_id = $2
    `, fareId, tenantId);

    if (fareRules.length === 0) {
      return NextResponse.json(
        { success: false, error: "Fare rule not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, fareRule: fareRules[0] });
  } catch (error) {
    console.error("Error getting fare rule:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get fare rule" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/fares/[fareId] — Update fare rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; fareId: string }> }
) {
  try {
    const { tenantId, fareId } = await params;
    const body = await request.json();

    const {
      name, vehicleType, baseFareCents, perKmCents, perMinCents,
      minimumFareCents, bookingFeeCents, cancellationFeeCents,
      waitingPerMinCents, surgeMultiplier,
      peakHoursStart, peakHoursEnd, peakSurgeMultiplier,
      nightSurgeMultiplier, nightStart, nightEnd, isActive,
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
    addField("base_fare_cents", baseFareCents);
    addField("per_km_cents", perKmCents);
    addField("per_min_cents", perMinCents);
    addField("minimum_fare_cents", minimumFareCents);
    addField("booking_fee_cents", bookingFeeCents);
    addField("cancellation_fee_cents", cancellationFeeCents);
    addField("waiting_per_min_cents", waitingPerMinCents);
    addField("surge_multiplier", surgeMultiplier);
    addField("peak_hours_start", peakHoursStart);
    addField("peak_hours_end", peakHoursEnd);
    addField("peak_surge_multiplier", peakSurgeMultiplier);
    addField("night_surge_multiplier", nightSurgeMultiplier);
    addField("night_start", nightStart);
    addField("night_end", nightEnd);
    addField("is_active", isActive);

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
      WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING *
    `, ...values, fareId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Fare rule not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, fareRule: updated[0] });
  } catch (error) {
    console.error("Error updating fare rule:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update fare rule" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/fares/[fareId] — Deactivate fare rule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; fareId: string }> }
) {
  try {
    const { tenantId, fareId } = await params;

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE fare_rules
      SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `, fareId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Fare rule not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, fareRule: updated[0] });
  } catch (error) {
    console.error("Error deleting fare rule:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to delete fare rule" },
      { status: 500 }
    );
  }
}
