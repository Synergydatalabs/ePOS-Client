// ============================================================================
// /book/[tenantSlug]/[locationSlug]
//
// Location detail + booking form. Server component fetches location data
// up-front for SEO and instant first paint; the BookingFlow child is a
// client component for the interactive form.
// ============================================================================

import { notFound } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react/dist/iconify.js";
import prisma from "@/lib/prisma";
import BookingHeader from "@/components/booking/BookingHeader";
import BookingFooter from "@/components/booking/BookingFooter";
import BookingFlow from "@/components/booking/BookingFlow";
import SalonBookingFlow from "@/components/booking/SalonBookingFlow";
import PhotoGallery from "@/components/booking/PhotoGallery";

interface DetailData {
  success: boolean;
  tenant: {
    id: string;
    name: string;
    // Phase E R3: drives which flow renders (salon → SalonBookingFlow,
    // restaurant → BookingFlow).
    businessType?: string | null;
    logoUrl?: string | null;
    brandPrimaryColor?: string | null;
    brandAccentColor?: string | null;
    advanceDays: number;
  };
  location: {
    id: string;
    name: string;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    phone?: string | null;
    bookingSlug: string;
    tourSlug?: string | null;
    has360Tour: boolean;
    bookingMaxPartySize: number;
    photos: Array<{ id: string; url: string; thumbnailUrl?: string | null; caption?: string | null; altText?: string | null }>;
  };
  specialDates: Array<{ date: string; label: string; blocked: boolean; publicMessage?: string | null }>;
}

async function getDetail(tenantSlug: string, locationSlug: string): Promise<DetailData | null> {
  // Go directly to Prisma instead of self-fetching /api/public/book/...
  // The old HTTP round-trip made the page depend on NEXT_PUBLIC_APP_URL
  // resolving from inside the same EC2 instance — which quietly broke
  // whenever the partner domain (oreugo.ca) was used and Node fell back
  // to https://itap.zashx.com. Same query as the API endpoint, minus
  // the extra hop.
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: {
        id: true,
        name: true,
        timezone: true,
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
    });
    if (!tenant || !tenant.publicBookingEnabled) {
      console.warn(
        `[book detail] 404 — tenant "${tenantSlug}" ${tenant ? "has publicBookingEnabled=false" : "not found"}`
      );
      return null;
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
    });
    if (!location) {
      // Diagnose which specific gate failed so pm2 logs make the fix
      // obvious ("wrong slug" vs "disabled" vs "not ACTIVE").
      const raw = await prisma.location.findFirst({
        where: { tenantId: tenant.id, publicBookingSlug: locationSlug },
        select: { id: true, status: true, publicBookingEnabled: true },
      });
      console.warn(
        `[book detail] 404 — location "${locationSlug}" for tenant "${tenantSlug}": ` +
          (raw
            ? `found (status=${raw.status}, publicBookingEnabled=${raw.publicBookingEnabled})`
            : "not found (slug mismatch)")
      );
      return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(today.getDate() + 90);
    const specialDates = await prisma.specialDate.findMany({
      where: { locationId: location.id, date: { gte: today, lt: horizon } },
      select: {
        date: true,
        label: true,
        blockReservations: true,
        blockOnline: true,
        publicMessage: true,
      },
      orderBy: { date: "asc" },
    });

    return {
      success: true,
      tenant: {
        id: tenant.id,
        name: tenant.settings?.brandName || tenant.name,
        businessType: tenant.businessType,
        logoUrl: tenant.settings?.brandLogoUrl,
        brandPrimaryColor: tenant.settings?.brandPrimaryColor,
        brandAccentColor: tenant.settings?.brandAccentColor,
        advanceDays: tenant.settings?.bookingAdvanceDays ?? 30,
      },
      location: {
        id: location.id,
        name: location.name,
        address: location.address,
        city: location.city,
        province: location.province,
        phone: location.phone,
        bookingSlug: location.publicBookingSlug!,
        tourSlug: location.publicTourSlug,
        has360Tour: false,
        bookingMaxPartySize: location.bookingMaxPartySize,
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
        publicMessage: s.publicMessage,
      })),
    };
  } catch (err) {
    console.error("[book detail] prisma error:", err);
    return null;
  }
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; locationSlug: string }>;
}) {
  const { tenantSlug, locationSlug } = await params;
  const data = await getDetail(tenantSlug, locationSlug);
  if (!data || !data.success) return notFound();

  const { tenant, location, specialDates } = data;

  return (
    <>
      <BookingHeader
        tenantName={tenant.name}
        logoUrl={tenant.logoUrl}
        brandPrimaryColor={tenant.brandPrimaryColor}
        backHref={`/book/${tenantSlug}`}
        backLabel="Back to locations"
      />

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* LEFT: photos + info */}
          <div className="lg:col-span-3 space-y-6">
            {/* Hero / title */}
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {location.name}
              </h1>
              {(location.address || location.city) && (
                <p className="text-gray-600 flex items-center gap-1.5">
                  <Icon icon="solar:map-point-bold" className="w-4 h-4 text-gray-400" />
                  {[location.address, location.city, location.province].filter(Boolean).join(", ")}
                </p>
              )}
              {location.phone && (
                <p className="text-gray-500 text-sm flex items-center gap-1.5 mt-1">
                  <Icon icon="solar:phone-bold" className="w-4 h-4 text-gray-400" />
                  <a href={`tel:${location.phone}`} className="hover:text-gray-800">
                    {location.phone}
                  </a>
                </p>
              )}
            </div>

            {/* Photo gallery */}
            {location.photos.length > 0 && (
              <PhotoGallery photos={location.photos} />
            )}

            {/* Quick action chips: 360 tour, etc */}
            {(location.has360Tour && location.tourSlug) && (
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/tour/${location.tourSlug}`}
                  target="_blank"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full text-sm font-medium text-gray-700 hover:border-gray-400 hover:shadow-sm transition-all"
                >
                  <Icon icon="solar:vr-bold" className="w-4 h-4 text-indigo-600" />
                  Take a 360° tour
                </Link>
              </div>
            )}
          </div>

          {/* RIGHT: booking form — salon uses appointment flow, all
              other business types use the reservation flow. */}
          <div className="lg:col-span-2">
            <div className="lg:sticky lg:top-20">
              {tenant.businessType === "salon" ? (
                <SalonBookingFlow
                  tenantSlug={tenantSlug}
                  locationSlug={locationSlug}
                  tenantName={tenant.name}
                  locationName={location.name}
                />
              ) : (
                <BookingFlow
                  tenantSlug={tenantSlug}
                  locationSlug={locationSlug}
                  locationName={location.name}
                  restaurantName={tenant.name}
                  maxPartySize={location.bookingMaxPartySize}
                  advanceDays={tenant.advanceDays}
                  specialDates={specialDates}
                  brandPrimaryColor={tenant.brandPrimaryColor}
                />
              )}
            </div>
          </div>
        </div>
      </main>

      <BookingFooter />
    </>
  );
}
