import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/drivers/[driverProfileId]/earnings — Get earnings with date range & daily breakdown
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; driverProfileId: string }> }
) {
  try {
    const { tenantId, driverProfileId } = await params;
    const { searchParams } = new URL(request.url);

    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Verify driver belongs to tenant
    const drivers: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, commission_type, commission_value FROM driver_profiles
      WHERE id = $1 AND tenant_id = $2
    `, driverProfileId, tenantId);

    if (drivers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 }
      );
    }

    let dateFilter = "";
    if (dateFrom) dateFilter += ` AND de.earning_date >= '${dateFrom}'`;
    if (dateTo) dateFilter += ` AND de.earning_date <= '${dateTo}'`;

    // Get earnings summary
    const summary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(de.fare_amount_cents), 0)::bigint AS total_fare_cents,
        COALESCE(SUM(de.commission_cents), 0)::bigint AS total_commission_cents,
        COALESCE(SUM(de.tip_cents), 0)::bigint AS total_tips_cents,
        COALESCE(SUM(de.bonus_cents), 0)::bigint AS total_bonus_cents,
        COALESCE(SUM(de.net_earning_cents), 0)::bigint AS total_net_earnings_cents,
        COUNT(*)::int AS total_entries
      FROM driver_earnings de
      WHERE de.driver_profile_id = $1 ${dateFilter}
    `, driverProfileId);

    // Get daily breakdown
    const dailyBreakdown = await prisma.$queryRawUnsafe(`
      SELECT
        de.earning_date,
        COUNT(*)::int AS trips,
        SUM(de.fare_amount_cents)::bigint AS fare_cents,
        SUM(de.commission_cents)::bigint AS commission_cents,
        SUM(de.tip_cents)::bigint AS tips_cents,
        SUM(de.bonus_cents)::bigint AS bonus_cents,
        SUM(de.net_earning_cents)::bigint AS net_cents
      FROM driver_earnings de
      WHERE de.driver_profile_id = $1 ${dateFilter}
      GROUP BY de.earning_date
      ORDER BY de.earning_date DESC
    `, driverProfileId);

    // Get individual earnings records
    const earnings = await prisma.$queryRawUnsafe(`
      SELECT de.*, t.trip_number, t.pickup_address, t.dropoff_address
      FROM driver_earnings de
      LEFT JOIN trips t ON de.trip_id = t.id
      WHERE de.driver_profile_id = $1 ${dateFilter}
      ORDER BY de.created_at DESC
      LIMIT 100
    `, driverProfileId);

    return NextResponse.json({
      success: true,
      driver: {
        id: drivers[0].id,
        commissionType: drivers[0].commission_type,
        commissionValue: drivers[0].commission_value,
      },
      summary: summary[0] || {},
      dailyBreakdown,
      earnings,
    });
  } catch (error) {
    console.error("Error getting driver earnings:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get driver earnings" },
      { status: 500 }
    );
  }
}
