// ============================================================================
// Shared metadata builder for every PUBLIC partner-facing page (landing,
// auth, legal). One server-side helper so all of them stay in lockstep:
//
//   - Page title is always "<Page> | <Brand>" using the resolved tenant brand
//     from the request host (works for itap.zashx.com AND partner domains
//     like oreugo.ca).
//   - Description, OG, and Twitter cards are populated for link previews.
//   - Canonical URL points at the actual request URL (host-aware).
//   - robots.index = true for public marketing pages, false for auth pages
//     so search engines don't index login/signup/reset.
//   - Favicon prefers the partner-uploaded one (DB), then a partner-folder
//     fallback, then the root favicon.
//
// Called from each /partner/<route>/layout.tsx — those layouts are SERVER
// components (the pages themselves stay "use client"), which is why we can
// export generateMetadata from them.
// ============================================================================

import { headers } from "next/headers";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant-resolver";

export interface PartnerMetadataInput {
  /** Title fragment, e.g. "Login" — brand name is appended automatically. */
  pageTitle: string;
  /** Plain-text description, 140-160 chars ideal for search snippets. */
  pageDescription: string;
  /**
   * URL path RELATIVE to the partner-site root (no /partner prefix even on
   * standard domain). e.g. "/" for landing, "/login", "/about". Used for
   * canonical + OG URL only — Next routing is unaffected.
   */
  pathname: string;
  /** Set to false on auth pages — login/signup/reset shouldn't be indexed. */
  index?: boolean;
  /** Optional OG image override (defaults to the partner brand image). */
  ogImage?: string;
}

const PARTNER_FAVICON_DEFAULT = "/images/logo/pl/fvi.png";
const DEFAULT_OG_IMAGE = "/images/home/homepage.png";

export async function buildPartnerMetadata(
  input: PartnerMetadataInput
): Promise<Metadata> {
  const hdrs = await headers();
  const host = hdrs.get("host") || "";

  const resolved = await resolveTenant(host).catch(() => null);
  const brandName =
    resolved?.branding?.brandName || resolved?.name || "iTAP";

  // Detect whether we're on a partner-mapped domain (e.g. oreugo.ca) vs the
  // platform default. On a partner domain the public routes live at the root
  // ("/", "/login"); on the platform we serve them under /partner/...
  const isPartnerDomain =
    !!resolved &&
    host !== "itap.zashx.com" &&
    !host.startsWith("localhost");
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;
  const canonicalPath = isPartnerDomain
    ? input.pathname
    : `/partner${input.pathname === "/" ? "" : input.pathname}`;
  const canonical = `${baseUrl}${canonicalPath}`;

  const ogImage = input.ogImage || DEFAULT_OG_IMAGE;
  const fullTitle = `${input.pageTitle} | ${brandName}`;
  const indexable = input.index !== false;

  return {
    title: fullTitle,
    description: input.pageDescription,
    metadataBase: new URL(baseUrl),
    alternates: { canonical },
    openGraph: {
      title: fullTitle,
      description: input.pageDescription,
      url: canonical,
      siteName: brandName,
      type: "website",
      locale: "en_CA",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${brandName} — modern point of sale`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: input.pageDescription,
      images: [ogImage],
    },
    icons: {
      icon:
        resolved?.branding?.brandFaviconUrl ||
        PARTNER_FAVICON_DEFAULT,
    },
    robots: {
      index: indexable,
      follow: true,
      googleBot: {
        index: indexable,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}
