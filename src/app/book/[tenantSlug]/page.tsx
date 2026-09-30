// ============================================================================
// /book/[tenantSlug] — landing page (location chooser)
//
// Server component — fetches tenant + locations on the server for SEO + speed.
// If the tenant has only ONE location, we auto-redirect into the detail
// page; the chooser only appears when there are 2+ bookable locations.
// ============================================================================

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react/dist/iconify.js";
import BookingHeader from "@/components/booking/BookingHeader";
import BookingFooter from "@/components/booking/BookingFooter";

interface TenantData {
  success: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
    logoUrl?: string | null;
    tagline?: string | null;
    brandPrimaryColor?: string | null;
    brandAccentColor?: string | null;
  };
  locations: Array<{
    id: string;
    name: string;
    city?: string | null;
    address?: string | null;
    bookingSlug: string;
    tourSlug?: string | null;
    thumbnailUrl?: string | null;
  }>;
}

async function getTenantData(slug: string): Promise<TenantData | null> {
  // Use an absolute URL when running on server — Next requires it.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://itap.zashx.com"
      : "http://localhost:3000");
  try {
    const res = await fetch(`${base}/api/public/book/${slug}`, {
      next: { revalidate: 60 }, // 60s ISR for landing
    });
    if (!res.ok) return null;
    return (await res.json()) as TenantData;
  } catch (err) {
    console.error("[/book landing] fetch failed:", err);
    return null;
  }
}

export default async function BookingLandingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const data = await getTenantData(tenantSlug);

  if (!data || !data.success) return notFound();

  const { tenant, locations } = data;

  // Auto-jump if only one bookable location
  if (locations.length === 1) {
    redirect(`/book/${tenantSlug}/${locations[0].bookingSlug}`);
  }

  return (
    <>
      <BookingHeader
        tenantName={tenant.name}
        logoUrl={tenant.logoUrl}
        brandPrimaryColor={tenant.brandPrimaryColor}
      />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
            Book a table at {tenant.name}
          </h1>
          {tenant.tagline && (
            <p className="text-gray-600 text-lg">{tenant.tagline}</p>
          )}
          {locations.length > 1 && (
            <p className="text-gray-500 text-sm mt-2">
              Choose a location to continue
            </p>
          )}
        </div>

        {locations.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <Icon icon="solar:moon-sleep-bold" className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No locations are accepting online bookings right now.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {locations.map((loc) => (
              <Link
                key={loc.id}
                href={`/book/${tenantSlug}/${loc.bookingSlug}`}
                className="group bg-white rounded-2xl overflow-hidden border border-gray-200 hover:border-gray-300 hover:shadow-lg transition-all"
              >
                <div className="aspect-[4/3] bg-gray-100 relative overflow-hidden">
                  {loc.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={loc.thumbnailUrl}
                      alt={loc.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <Icon icon="solar:gallery-bold" className="w-12 h-12" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="font-semibold text-gray-900 text-lg mb-1">
                    {loc.name}
                  </h3>
                  {(loc.address || loc.city) && (
                    <p className="text-sm text-gray-500 leading-relaxed">
                      {[loc.address, loc.city].filter(Boolean).join(", ")}
                    </p>
                  )}
                  <div
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600"
                    style={tenant.brandPrimaryColor ? { color: tenant.brandPrimaryColor } : {}}
                  >
                    Book here
                    <Icon icon="solar:arrow-right-bold" className="w-4 h-4" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <BookingFooter />
    </>
  );
}
