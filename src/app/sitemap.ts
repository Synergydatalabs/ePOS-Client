// ============================================================================
// Dynamic sitemap served at /sitemap.xml. Next 15 generates it automatically
// from this default export. Lists every PUBLIC route that should be crawlable
// — auth pages (login/signup/reset) are deliberately omitted to keep search
// results focused on marketing surfaces.
//
// We hardcode the canonical partner domain (oreugo.ca) for the URL prefix —
// for multi-tenant sitemaps in the future, fork this per host using
// `headers()` and resolveTenant().
// ============================================================================

import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    "https://oreugo.ca";
  const now = new Date();

  const routes: Array<{
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  }> = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" },
    { path: "/about", priority: 0.7, changeFrequency: "monthly" },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
    { path: "/cookies", priority: 0.3, changeFrequency: "yearly" },
  ];

  return routes.map((r) => ({
    url: `${baseUrl}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
