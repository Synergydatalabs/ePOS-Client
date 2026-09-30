// ============================================================================
// GET /api/public/book/[tenantSlug]/locations/[locationSlug]
//
// Public location detail for the booking page. Bundles everything the
// detail page needs in one round-trip:
//   - Location info (address, hours, party-size limits, lead time)
//   - Up to 12 photos for the gallery
//   - Virtual-tour slug (so the page can link to /api/public/tour/[slug])
//   - List of upcoming special-date overrides (so calendar shows closures)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; locationSlug: string }> }
) {
  const { tenantSlug, locationSlug } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: {
      id: true,
      name: true,
      timezone: true,
      // Phase E R3: needed so the /book page can branch between
      // BookingFlow (restaurant reservations) and SalonBookingFlow
      // (appointment booking).
      businessType: true,
      publicBookingEnabled: true,
      settings: {
        select: {
          brandName: true,
          brandLogoUrl: true,
          brandPrimaryColor: true,
          brandAccentColor: true,
          bookingAdvanceDays: true,
        },
      },
    },
  }).catch(() => null);

  if (!tenant || !tenant.publicBookingEnabled) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const location = await prisma.location.findFirst({
    where: {
      tenantId: tenant.id,
      publicBookingSlug: locationSlug,
      status: "ACTIVE",
      publicBookingEnabled: true,
    },
    include: {
      mediaItems: {
        where: { mediaType: "PHOTO", isActive: true },
        orderBy: [{ isCover: "desc" }, { displayOrder: "asc" }],
        take: 12,
        select: {
          id: true,
          publicUrl: true,
          thumbnailUrl: true,
          caption: true,
          altText: true,
        },
      },
    },
  }).catch(() => null);

  if (!location) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  // Upcoming special dates (next 90 days) so the date picker can disable closures
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(today.getDate() + 90);

  const specialDates = await prisma.specialDate.findMany({
    where: {
      locationId: location.id,
      date: { gte: today, lt: horizon },
    },
    select: {
      date: true,
      label: true,
      blockReservations: true,
      blockOnline: true,
      customOpenTime: true,
      customCloseTime: true,
      publicMessage: true,
    },
    orderBy: { date: "asc" },
  });

  // Check for a 360 panorama (presence flag, not full data — page will lazy-load /api/public/tour/<slug>)
  const has360 = await prisma.mediaItem.count({
    where: {
      locationId: location.id,
      mediaType: "PANORAMA_360",
      isActive: true,
    },
  }) > 0;

  return NextResponse.json({
    success: true,
    tenant: {
      id: tenant.id,
      name: tenant.settings?.brandName || tenant.name,
      businessType: tenant.businessType,
      logoUrl: tenant.settings?.brandLogoUrl,
      brandPrimaryColor: tenant.settings?.brandPrimaryColor,
      brandAccentColor: tenant.settings?.brandAccentColor,
      timezone: tenant.timezone,
      advanceDays: tenant.settings?.bookingAdvanceDays ?? 30,
    },
    location: {
      id: location.id,
      name: location.name,
      address: location.address,
      city: location.city,
      province: location.province,
      postalCode: location.postalCode,
      phone: location.phone,
      bookingSlug: location.publicBookingSlug,
      tourSlug: location.publicTourSlug,
      operatingHours: location.operatingHours ?? null,
      bookingLeadMinutes: location.bookingLeadMinutes,
      bookingSlotMinutes: location.bookingSlotMinutes,
      bookingMaxPartySize: location.bookingMaxPartySize,
      has360Tour: has360,
      photos: location.mediaItems.map((m) => ({
        id: m.id,
        url: m.publicUrl,
        thumbnailUrl: m.thumbnailUrl,
        caption: m.caption,
        altText: m.altText,
      })),
    },
    specialDates: specialDates.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      label: s.label,
      blocked: s.blockReservations || s.blockOnline,
      customHours:
        s.customOpenTime && s.customCloseTime
          ? { open: s.customOpenTime, close: s.customCloseTime }
          : null,
      publicMessage: s.publicMessage,
    })),
  }, {
    headers: {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    },
  });
}
