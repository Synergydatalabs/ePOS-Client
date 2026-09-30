// ============================================================================
// GET /api/public/book/[tenantSlug]
//
// Public tenant lookup for the booking landing page. Returns just enough
// for the page header + location chooser; no auth required.
//
// Response shape kept tight — no admin fields, no internal IDs except where
// the page needs them to navigate. Cached at the edge for 5 min since
// tenant metadata changes infrequently.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string }> }
) {
  const { tenantSlug } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      businessType: true,
      timezone: true,
      currency: true,
      logoUrl: true,
      publicBookingEnabled: true,
      bookingTagline: true,
      // From TenantSettings — used for branding the booking page
      settings: {
        select: {
          brandName: true,
          brandLogoUrl: true,
          brandPrimaryColor: true,
          brandAccentColor: true,
          bookingAdvanceDays: true,
        },
      },
      locations: {
        where: {
          status: "ACTIVE",
          publicBookingEnabled: true,
        },
        select: {
          id: true,
          name: true,
          city: true,
          address: true,
          publicBookingSlug: true,
          publicTourSlug: true,
          // First photo as a thumbnail for the location card
          mediaItems: {
            where: { mediaType: "PHOTO", isActive: true },
            orderBy: [{ isCover: "desc" }, { displayOrder: "asc" }],
            take: 1,
            select: { publicUrl: true, thumbnailUrl: true },
          },
        },
        orderBy: { isDefault: "desc" },
      },
    },
  }).catch(() => null);

  if (!tenant) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  if (!tenant.publicBookingEnabled) {
    return NextResponse.json(
      { success: false, error: "Online booking is not enabled for this business." },
      { status: 404 }
    );
  }

  const bookableLocations = tenant.locations.filter((l) => l.publicBookingSlug);

  return NextResponse.json({
    success: true,
    tenant: {
      id: tenant.id,                       // needed for downstream calls
      name: tenant.settings?.brandName || tenant.name,
      slug: tenant.slug,
      businessType: tenant.businessType,
      timezone: tenant.timezone,
      currency: tenant.currency,
      logoUrl: tenant.settings?.brandLogoUrl || tenant.logoUrl,
      tagline: tenant.bookingTagline,
      brandPrimaryColor: tenant.settings?.brandPrimaryColor,
      brandAccentColor: tenant.settings?.brandAccentColor,
      advanceDays: tenant.settings?.bookingAdvanceDays ?? 30,
    },
    locations: bookableLocations.map((l) => ({
      id: l.id,
      name: l.name,
      city: l.city,
      address: l.address,
      bookingSlug: l.publicBookingSlug,
      tourSlug: l.publicTourSlug,
      thumbnailUrl: l.mediaItems[0]?.thumbnailUrl ?? l.mediaItems[0]?.publicUrl ?? null,
    })),
  }, {
    headers: {
      // Aggressive caching — tenant + location metadata is stable. Booking
      // logic doesn't read this, just the page header / chooser.
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
