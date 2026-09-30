import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";
import { resolveTenant } from "@/lib/tenant-resolver";

const inter = Inter({ subsets: ["latin"] });
// Phase 7 (2026-05-18): Poppins is the typeface used by the partner-facing
// landing + admin styling. Loaded as a CSS variable so we can opt in per
// route rather than overriding Inter globally.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

// PHASE 7a (2026-05-18): per-request metadata so partner domains get their
// brand name in the <title> from the very first paint (no FOUC where it
// reads "iTAP" for a second before JS swaps it).
//
// generateMetadata runs on the server and can read request headers.
// resolveTenant() is cached in-memory (5 min) so repeated lookups are cheap.
export async function generateMetadata(): Promise<Metadata> {
  const hdrs = await headers();
  const host = hdrs.get("host") || "";

  const resolved = await resolveTenant(host).catch(() => null);

  // Phase F #6o (2026-08-28): host-aware metadata for the hub platform.
  // hub.synergydatalabs.com (and any synergydatalabs.com subdomain) is the
  // multi-tenant platform host — no single tenant "owns" it, so the tenant
  // resolver returns null. Fall through to hub-branded OG tags rather than
  // the legacy iTap POS defaults. Oreugo + other partner domains fall back
  // to their own resolved tenant branding; the last-resort default (unknown
  // host with no resolved tenant) also picks up hub branding now that
  // iTap is retired.
  const isHubHost = /(^|\.)synergydatalabs\.com$/i.test(host);

  const brandName = resolved?.branding?.brandName
    || resolved?.name
    || (isHubHost ? "hub" : "hub");
  const tagline = resolved
    ? "Business Portal"
    : isHubHost
    ? "Software marketplace for business"
    : "Software marketplace for business";
  const description = resolved
    ? `${brandName} — manage reservations, payments, and your business.`
    : "Discover, install, and pay for business software. One account, one bill, one platform.";

  const title = `${brandName} | ${tagline}`;
  const siteName = resolved ? brandName : "hub by Synergy Data Labs";
  // OG image path — 512×512 hub icon works cleanly on WhatsApp / iMessage
  // (they crop to square anyway). For proper 1.91:1 Facebook/LinkedIn
  // previews a dedicated 1200×630 og-banner.jpg is on the todo list.
  const ogImage = resolved?.branding?.brandLogoUrl
    || (isHubHost ? "/images/logo/hub-icon.jpg" : "/images/logo/hub-icon.jpg");

  return {
    title,
    description,
    icons: {
      icon: resolved?.branding?.brandFaviconUrl
        || (isHubHost ? "/images/logo/hub-icon.jpg" : "/images/logo/hub-icon.jpg"),
    },
    openGraph: {
      title,
      description,
      siteName,
      url: `https://${host}`,
      type: "website",
      images: [{ url: ogImage, width: 512, height: 512, alt: `${brandName} — ${tagline}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={poppins.variable}>
      <head>
        {process.env.NODE_ENV === 'production' && (
          <script dangerouslySetInnerHTML={{ __html: `(function(){var n=function(){};var m=['log','debug','info','table','trace','dir','dirxml','group','groupCollapsed','groupEnd','clear','count','countReset','time','timeLog','timeEnd','timeStamp','profile','profileEnd','assert'];for(var i=0;i<m.length;i++){console[m[i]]=n;}})();`}} />
        )}
      </head>
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        <Providers>
          {children}
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
