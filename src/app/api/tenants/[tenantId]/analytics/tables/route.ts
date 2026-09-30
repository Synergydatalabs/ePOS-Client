// GET /api/tenants/[tenantId]/analytics/tables - Get table analytics

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get table analytics
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30");
    const locationId = searchParams.get("locationId");

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get locations for this tenant
    const locations = await prisma.location.findMany({
      where: { tenantId },
      select: { id: true },
    });
    const locationIds = locationId
      ? [locationId]
      : locations.map((l) => l.id);

    // Get session analytics
    const sessions = await prisma.tableSession.findMany({
      where: {
        locationId: { in: locationIds },
        startedAt: { gte: startDate },
      },
      select: {
        id: true,
        tableId: true,
        guestCount: true,
        totalSpent: true,
        status: true,
        startedAt: true,
        endedAt: true,
        table: { select: { tableNumber: true, name: true } },
      },
    });

    // Calculate metrics
    const completedSessions = sessions.filter((s) => s.status === "COMPLETED");
    const totalRevenue = completedSessions.reduce((sum, s) => sum + s.totalSpent, 0);
    const totalGuests = sessions.reduce((sum, s) => sum + s.guestCount, 0);
    const avgSpendPerSession =
      completedSessions.length > 0
        ? totalRevenue / completedSessions.length
        : 0;
    const avgSpendPerGuest = totalGuests > 0 ? totalRevenue / totalGuests : 0;

    // Session duration analytics
    const sessionDurations = completedSessions
      .filter((s) => s.endedAt)
      .map((s) => {
        const duration =
          (new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime()) /
          60000;
        return duration;
      });
    const avgSessionDuration =
      sessionDurations.length > 0
        ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length
        : 0;

    // Table performance
    const tableStats: Record<
      string,
      { tableNumber: string; sessions: number; revenue: number; guests: number }
    > = {};
    for (const session of completedSessions) {
      const key = session.tableId;
      if (!tableStats[key]) {
        tableStats[key] = {
          tableNumber: session.table.tableNumber,
          sessions: 0,
          revenue: 0,
          guests: 0,
        };
      }
      tableStats[key].sessions++;
      tableStats[key].revenue += session.totalSpent;
      tableStats[key].guests += session.guestCount;
    }

    const tablePerformance = Object.values(tableStats)
      .map((t) => ({
        ...t,
        avgRevenue: t.sessions > 0 ? Math.round(t.revenue / t.sessions) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Peak hours
    const hourlyData: Record<number, { sessions: number; revenue: number }> = {};
    for (const session of completedSessions) {
      const hour = new Date(session.startedAt).getHours();
      if (!hourlyData[hour]) {
        hourlyData[hour] = { sessions: 0, revenue: 0 };
      }
      hourlyData[hour].sessions++;
      hourlyData[hour].revenue += session.totalSpent;
    }

    const peakHours = Object.entries(hourlyData)
      .map(([hour, data]) => ({
        hour: parseInt(hour),
        ...data,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 5);

    return NextResponse.json({
      success: true,
      analytics: {
        summary: {
          totalSessions: sessions.length,
          completedSessions: completedSessions.length,
          totalRevenue,
          totalGuests,
          avgSpendPerSession: Math.round(avgSpendPerSession),
          avgSpendPerGuest: Math.round(avgSpendPerGuest),
          avgSessionDurationMinutes: Math.round(avgSessionDuration),
        },
        tablePerformance: tablePerformance.slice(0, 10),
        peakHours,
        period: {
          days,
          startDate: startDate.toISOString(),
          endDate: new Date().toISOString(),
        },
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get table analytics error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
