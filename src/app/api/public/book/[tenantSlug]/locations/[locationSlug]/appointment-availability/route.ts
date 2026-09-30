// GET /api/public/book/[tenantSlug]/locations/[locationSlug]/appointment-availability
//
// Public wrapper around computeAvailability(). Same engine that powers
// the POS-side slot picker, exposed for the salon customer flow. The
// tenantSlug + locationSlug + publicBookingEnabled gate replaces the
// per-tenant auth check.
//
// Query params:
//   ?date=YYYY-MM-DD                       required
//   ?serviceIds=<uuid>,<uuid>              required (>= 1)
//   ?technicianId=<uuid>                   optional (else "no preference")

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computeAvailability } from "@/lib/appointment-availability";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; locationSlug: string }> }
) {
  const { tenantSlug, locationSlug } = await params;
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const serviceIds = (searchParams.get("serviceIds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const technicianId = searchParams.get("technicianId") || undefined;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { success: false, error: "Invalid date (expected YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  if (serviceIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "At least one serviceId is required" },
      { status: 400 }
    );
  }

  const location = await prisma.location.findFirst({
    where: {
      publicBookingSlug: locationSlug,
      status: "ACTIVE",
      publicBookingEnabled: true,
      tenant: { slug: tenantSlug, publicBookingEnabled: true },
    },
    select: { id: true, tenantId: true },
  }).catch(() => null);
  if (!location) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  try {
    const result = await computeAvailability({
      tenantId: location.tenantId,
      locationId: location.id,
      date,
      serviceProductIds: serviceIds,
      technicianId,
    });
    return NextResponse.json(
      { success: true, ...result },
      {
        headers: {
          // Short cache — bookings change often.
          "Cache-Control": "public, s-maxage=30",
        },
      }
    );
  } catch (err: any) {
    console.error("[public/book/appointment-availability] error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}
