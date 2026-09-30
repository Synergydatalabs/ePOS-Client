// ============================================================================
// Server layout for the partner landing route (/partner OR partner-domain "/").
// Provides per-page SEO metadata + the JSON-LD Organization schema that
// search engines use to render a brand-rich snippet.
// ============================================================================

import type { Metadata } from "next";
import { headers } from "next/headers";
import { buildPartnerMetadata } from "@/lib/partner-metadata";
import { resolveTenant } from "@/lib/tenant-resolver";

export async function generateMetadata(): Promise<Metadata> {
  return buildPartnerMetadata({
    pageTitle: "Modern POS, Payments & Reservations",
    pageDescription:
      "Run your business on one platform. Built for restaurants, cafés, salons, and retail — tap, scan, and you're live. No setup fee, cancel anytime.",
    pathname: "/",
  });
}

export default async function PartnerRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Pull the resolved brand so the JSON-LD reflects the actual tenant being
  // served (Oreugo on oreugo.ca, iTAP on itap.zashx.com, etc.).
  const hdrs = await headers();
  const host = hdrs.get("host") || "";
  const resolved = await resolveTenant(host).catch(() => null);
  const brandName =
    resolved?.branding?.brandName || resolved?.name || "iTAP";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brandName,
    url: baseUrl,
    logo: `${baseUrl}/images/logo/pl/oreugo_wordmark_black.png`,
    description:
      "All-in-one POS, payments, and reservations platform for restaurants, cafés, salons, and retail.",
    sameAs: [
      "https://www.instagram.com/oreugo.pos",
      "https://www.linkedin.com/company/oreugo/",
      "https://www.facebook.com/share/1B9ezFDbdm/",
    ],
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+1-226-500-0381",
      contactType: "Customer Service",
      email: "info@oreugo.ca",
      areaServed: "CA",
      availableLanguage: ["English"],
    },
  };

  return (
    <>
      {/* JSON-LD Organization schema — picked up by Google for the brand
          card in search results. Inert <script> tag is fine in a server
          layout and won't double-execute on client navigation. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
    </>
  );
}
