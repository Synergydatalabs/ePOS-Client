// Public next-appointment board — for big screen in salon waiting area.
// Returns today's upcoming appointments so the screen can show who's
// being served now and who's next, without exposing PII unless the
// salon has explicitly opted in to showing customer names.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;

    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: {
        id: true,
        name: true,
        tenant: {
          select: {
            name: true,
            currency: true,
            businessType: true,
            settings: {
              select: {
                appointmentDisplayShowName: true,
              },
            },
          },
        },
      },
    });

    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    // Today's window (server-local) — we keep it simple and just look at
    // today + tomorrow on the off-chance the salon is open past midnight.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(startOfDay);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);

    const appointments = await prisma.order.findMany({
      where: {
        locationId,
        orderType: "APPOINTMENT",
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        OR: [
          // Either explicit appointmentDate is today/tomorrow, …
          {
            appointmentDate: {
              gte: startOfDay,
              lt: endOfTomorrow,
            },
          },
          // …or there's no explicit date but the order was created today
          // (walk-in appointment booked the same day).
          {
            appointmentDate: null,
            createdAt: { gte: startOfDay },
          },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        displayNumber: true,
        status: true,
        customerName: true,
        appointmentDate: true,
        appointmentTime: true,
        createdAt: true,
        items: {
          select: { productName: true },
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
      // Sort by explicit appointment time first, falling back to creation
      // time for walk-ins / same-day bookings without a slot.
      orderBy: [
        { appointmentDate: "asc" },
        { appointmentTime: "asc" },
        { createdAt: "asc" },
      ],
      take: 20,
    });

    const showName = location.tenant.settings?.appointmentDisplayShowName ?? false;

    const list = appointments.map((appt) => ({
      id: appt.id,
      displayNumber: appt.displayNumber,
      orderNumber: appt.orderNumber,
      status: appt.status,
      // Mask the name based on the salon's privacy setting. If the salon
      // hasn't opted in to showing names, return only the first name +
      // last initial (e.g. "Sarah M.") for the SOFT-private case below —
      // but if the toggle is off entirely we just omit the name.
      customerName: showName ? appt.customerName : null,
      appointmentTime: appt.appointmentTime,
      appointmentDate: appt.appointmentDate?.toISOString().slice(0, 10) ?? null,
      service: appt.items[0]?.productName ?? null,
    }));

    return NextResponse.json({
      success: true,
      location: {
        id: location.id,
        name: location.name,
        brandName: location.tenant.name,
      },
      privacy: {
        showName,
      },
      appointments: list,
      now: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[PUBLIC APPT DISPLAY] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
