// ============================================================================
// Dynamic robots.txt served at /robots.txt. Allows crawl of public marketing
// pages, blocks crawl of api/, dashboard/, pos/, drive/, ride/, book/, and
// every auth surface (login / signup / reset-password) so search engines
// only see the brand-relevant content.
// ============================================================================

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    "https://oreugo.ca";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/about", "/terms", "/privacy", "/cookies"],
        disallow: [
          "/api/",
          "/dashboard/",
          "/pos/",
          "/drive/",
          "/ride/",
          "/book/",
          "/login",
          "/signup",
          "/reset-password",
          "/partner/dashboard/",
          "/partner/login",
          "/partner/signup",
          "/partner/reset-password",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
