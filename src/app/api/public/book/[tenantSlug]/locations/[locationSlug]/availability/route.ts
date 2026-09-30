// ============================================================================
// GET /api/public/book/[tenantSlug]/locations/[locationSlug]/availability
//
// Returns bookable time slots for a given date + party size.
//
// Query params:
//   ?date=YYYY-MM-DD    (required)
//   ?partySize=N        (required, 1..bookingMaxPartySize)
//
// Response: { success, slots: [{ startsAt, label, remaining }, ...] }
// Empty array = nothing available that day (page shows "Try another date").
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computeAvailability } from "@/lib/booking/availability";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; locationSlug: string }> }
) {
  const { tenantSlug, locationSlug } = await params;
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const partySizeRaw = searchParams.get("partySize");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { success: false, error: "Invalid date (expected YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  const partySize = parseInt(partySizeRaw || "0", 10);
  if (!partySize || partySize < 1 || partySize > 50) {
    return NextResponse.json(
      { success: false, error: "Invalid partySize (1..50)" },
      { status: 400 }
    );
  }

  // Resolve location via slug pair so we don't accidentally expose the UUID
  // until necessary.
  const location = await prisma.location.findFirst({
    where: {
      publicBookingSlug: locationSlug,
      status: "ACTIVE",
      publicBookingEnabled: true,
      tenant: { slug: tenantSlug, publicBookingEnabled: true },
    },
    select: { id: true },
  }).catch(() => null);

  if (!location) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  try {
    const slots = await computeAvailability({
      locationId: location.id,
      date,
      partySize,
    });
    return NextResponse.json({
      success: true,
      date,
      partySize,
      slots,
    }, {
      headers: {
        // Short cache — booking state changes second-by-second. 30s is enough
        // to absorb a burst from one user scrolling through dates.
        "Cache-Control": "public, s-maxage=30",
      },
    });
  } catch (err: any) {
    console.error("[public/book/availability] error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}
