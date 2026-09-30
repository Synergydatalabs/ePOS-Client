import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/reports/cab — Cab-specific reports
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const reportType = searchParams.get("type") || "overview"; // overview, daily, drivers, payments

    let dateFilter = "";
    if (dateFrom) dateFilter += ` AND t.created_at >= '${dateFrom}'`;
    if (dateTo) dateFilter += ` AND t.created_at <= '${dateTo}'`;

    // Overview stats
    const overview: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total_trips,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_trips,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_trips,
        COUNT(*) FILTER (WHERE status IN ('REQUESTED', 'SEARCHING', 'ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS'))::int AS active_trips,
        COUNT(*) FILTER (WHERE status = 'NO_DRIVERS')::int AS no_driver_trips,
        COALESCE(SUM(actual_fare_cents) FILTER (WHERE status = 'COMPLETED'), 0)::bigint AS total_revenue_cents,
        COALESCE(AVG(actual_fare_cents) FILTER (WHERE status = 'COMPLETED'), 0)::int AS avg_fare_cents,
        COALESCE(MAX(actual_fare_cents) FILTER (WHERE status = 'COMPLETED'), 0)::int AS max_fare_cents,
        COALESCE(MIN(actual_fare_cents) FILTER (WHERE status = 'COMPLETED'), 0)::int AS min_fare_cents
      FROM trips t
      WHERE t.tenant_id = $1::uuid ${dateFilter}
    `, tenantId);

    // Daily breakdown
    const dailyTrips = await prisma.$queryRawUnsafe(`
      SELECT
        DATE(t.created_at) AS date,
        COUNT(*)::int AS total_trips,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
        COALESCE(SUM(actual_fare_cents) FILTER (WHERE status = 'COMPLETED'), 0)::bigint AS revenue_cents
      FROM trips t
      WHERE t.tenant_id = $1::uuid ${dateFilter}
      GROUP BY DATE(t.created_at)
      ORDER BY DATE(t.created_at) DESC
      LIMIT 30
    `, tenantId);

    // Driver performance
    const driverPerformance = await prisma.$queryRawUnsafe(`
      SELECT
        dp.id AS driver_id,
        dp.driver_name,
        dp.avg_rating,
        dp.total_ratings,
        COUNT(t.id)::int AS total_trips,
        COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::int AS completed_trips,
        COUNT(t.id) FILTER (WHERE t.status = 'CANCELLED')::int AS cancelled_trips,
        COALESCE(SUM(t.actual_fare_cents) FILTER (WHERE t.status = 'COMPLETED'), 0)::bigint AS revenue_cents,
        CASE
          WHEN COUNT(t.id) > 0
          THEN ROUND(COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::numeric / COUNT(t.id) * 100, 1)
          ELSE 0
        END AS completion_rate
      FROM driver_profiles dp
      LEFT JOIN trips t ON t.driver_profile_id = dp.id ${dateFilter ? dateFilter.replace('AND t.', 'AND t.') : ''}
      WHERE dp.tenant_id = $1::uuid
      GROUP BY dp.id, dp.driver_name, dp.avg_rating, dp.total_ratings
      ORDER BY completed_trips DESC
      LIMIT 50
    `, tenantId);

    // Payment breakdown
    const paymentBreakdown = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(payment_method, 'UNKNOWN') AS payment_method,
        COUNT(*)::int AS trip_count,
        COALESCE(SUM(actual_fare_cents), 0)::bigint AS total_cents
      FROM trips t
      WHERE t.tenant_id = $1 AND t.status = 'COMPLETED' ${dateFilter}
      GROUP BY payment_method
      ORDER BY total_cents DESC
    `, tenantId);

    // Ride type breakdown
    const rideTypeBreakdown = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(ride_type, 'STANDARD') AS ride_type,
        COUNT(*)::int AS trip_count,
        COALESCE(SUM(actual_fare_cents) FILTER (WHERE status = 'COMPLETED'), 0)::bigint AS revenue_cents
      FROM trips t
      WHERE t.tenant_id = $1::uuid ${dateFilter}
      GROUP BY ride_type
      ORDER BY trip_count DESC
    `, tenantId);

    // Hourly distribution (for peak hour analysis)
    const hourlyDistribution = await prisma.$queryRawUnsafe(`
      SELECT
        EXTRACT(HOUR FROM t.created_at)::int AS hour,
        COUNT(*)::int AS trip_count
      FROM trips t
      WHERE t.tenant_id = $1::uuid ${dateFilter}
      GROUP BY EXTRACT(HOUR FROM t.created_at)
      ORDER BY hour
    `, tenantId);

    // Active driver stats
    const driverStats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total_drivers,
        COUNT(*) FILTER (WHERE is_active = true)::int AS active_drivers,
        COUNT(*) FILTER (WHERE duty_status = 'online')::int AS online_now,
        COUNT(*) FILTER (WHERE duty_status = 'busy')::int AS busy_now,
        COALESCE(AVG(avg_rating) FILTER (WHERE avg_rating > 0), 0)::numeric(3,2) AS avg_driver_rating
      FROM driver_profiles
      WHERE tenant_id = $1
    `, tenantId);

    return NextResponse.json({
      success: true,
      report: {
        overview: overview[0] || {},
        dailyTrips,
        driverPerformance,
        paymentBreakdown,
        rideTypeBreakdown,
        hourlyDistribution,
        driverStats: driverStats[0] || {},
        dateRange: {
          from: dateFrom || "all time",
          to: dateTo || "now",
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error generating cab report:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to generate cab report" },
      { status: 500 }
    );
  }
}
