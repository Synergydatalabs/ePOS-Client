// GET /api/public/book/[tenantSlug]/locations/[locationSlug]/services
//
// Returns the bookable service catalog for the salon appointment flow.
// A service = active, non-archived Product with prepTimeMinutes set
// (salons use prepTimeMinutes as service duration).
//
// Response: { success, services: [{ id, name, description, priceCents,
//                                    durationMinutes, currency }] }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const DEFAULT_DURATION = 30;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; locationSlug: string }> }
) {
  const { tenantSlug, locationSlug } = await params;

  // Resolve location — same public-booking gate as the reservation
  // endpoints. If the tenant hasn't opted in, nothing surfaces.
  const location = await prisma.location.findFirst({
    where: {
      publicBookingSlug: locationSlug,
      status: "ACTIVE",
      publicBookingEnabled: true,
      tenant: { slug: tenantSlug, publicBookingEnabled: true },
    },
    include: { tenant: { select: { id: true, currency: true } } },
  }).catch(() => null);
  if (!location) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const services = await prisma.product.findMany({
    where: {
      tenantId: location.tenant.id,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      description: true,
      basePrice: true,
      prepTimeMinutes: true,
      imageUrl: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(
    {
      success: true,
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        priceCents: s.basePrice,
        durationMinutes: s.prepTimeMinutes ?? DEFAULT_DURATION,
        imageUrl: s.imageUrl,
        currency: location.tenant.currency || "CAD",
      })),
    },
    {
      headers: {
        // Menu doesn't change often — cache aggressively.
        "Cache-Control": "public, s-maxage=300",
      },
    }
  );
}
