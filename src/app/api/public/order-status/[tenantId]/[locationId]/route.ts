// Public order status board — for big screen at POS counter
// Shows customers which orders are PREPARING vs READY for pickup

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;

    // Validate location
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true, name: true, tenant: { select: { name: true, currency: true } } },
    });

    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    // Get active orders from today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: {
        locationId,
        createdAt: { gte: startOfDay },
        status: { in: ["CONFIRMED", "PREPARING", "READY", "SERVED"] },
        orderType: { not: "APPOINTMENT" },
      },
      select: {
        id: true,
        orderNumber: true,
        displayNumber: true,
        orderType: true,
        status: true,
        customerName: true,
        createdAt: true,
      },
      orderBy: { displayNumber: "asc" },
      take: 40,
    });

    // Split into preparing vs ready
    const preparing = orders.filter((o) =>
      ["CONFIRMED", "PREPARING"].includes(o.status)
    );
    const ready = orders.filter((o) => ["READY", "SERVED"].includes(o.status));

    return NextResponse.json({
      success: true,
      location: {
        id: location.id,
        name: location.name,
        brandName: location.tenant.name,
      },
      preparing,
      ready,
      now: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[PUBLIC ORDER STATUS] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
