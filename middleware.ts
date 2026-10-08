// Host-based routing for the multi-tenant deployment.
//
// 2026-10-07 — Indian Beans landing site. Updated with explicit
// landing-path allow-list after the initial version was too greedy
// and tried to rewrite /signin, /partner/*, etc.
//
// All tenant portals + the hub itself run on this single Next.js
// process (port 4003). ALB forwards every host — hub.synergydatalabs.com,
// app.oreugo.ca, indianbeans.com, etc — to the same target group. This
// middleware looks at the incoming Host header and rewrites a small
// allow-list of marketing paths to the correct /public/sites/<slug>/
// folder; EVERY other path falls through to Next.js, which keeps the
// portal, API, payment flows, auth etc working as if the request had
// hit the main host.
//
// Adding a new landed tenant later:
//   1. Drop their static files under /public/sites/<slug>/
//   2. Register the host(s) + landing paths in LANDING_SITES below
//   3. Deploy. Zero other changes.

import { NextRequest, NextResponse } from "next/server";

interface LandingSite {
  slug: string; // folder name under /public/sites/
  hosts: string[]; // lowercased hostnames, no port
  // Paths to rewrite to this site's static files. Any path NOT in this
  // list falls through to Next.js. "/" always maps to index.html; every
  // other entry maps to "<path>.html" unless it already has an extension.
  // "/assets/*" is handled implicitly by the asset-prefix check.
  pages: string[];
}

const LANDING_SITES: LandingSite[] = [
  {
    slug: "indianbeans",
    hosts: ["indianbeans.com", "www.indianbeans.com"],
    pages: [
      "/",
      "/index",
      "/about",
      "/features",
      "/pricing",
      "/solutions",
      "/integrations",
      "/contact",
      "/faq",
      "/privacy",
      "/terms",
      "/refunds",
      "/cookies",
      "/security",
      "/404",
    ],
  },
];

// Static files (CSS/JS/images/sitemap) that live inside each site's
// folder and should also be rewritten.
const STATIC_FILE_PREFIXES = ["/assets/"];
const STATIC_FILE_PATHS = new Set(["/robots.txt", "/sitemap.xml", "/favicon.ico"]);

function findSiteForHost(host: string): LandingSite | null {
  for (const site of LANDING_SITES) {
    if (site.hosts.includes(host)) return site;
  }
  return null;
}

// 2026-10-07: on a white-label tenant's apex, Oreugo's own marketing
// landing (/partner) and its legal pages (/partner/about,
// /partner/cookies, /partner/privacy, etc) should NOT be reachable —
// they would show Oreugo-branded content to Indian Beans customers.
// Redirect each to the tenant's own equivalent instead. Auth routes
// (/partner/login, /partner/signup, /partner/reset-password,
// /partner/dashboard, /partner/supplier, ...) are intentionally NOT in
// this map so they continue to serve.
const OREUGO_LANDING_REDIRECTS: Record<string, string> = {
  "/partner":          "/",
  "/partner/":         "/",
  "/partner/about":    "/about",
  "/partner/cookies":  "/cookies",
  "/partner/privacy":  "/privacy",
};

export function middleware(request: NextRequest) {
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  const site = findSiteForHost(host);
  if (!site) return NextResponse.next();

  const path = request.nextUrl.pathname;

  // 0) Oreugo-exclusive marketing/legal paths → redirect to this
  //    tenant's own equivalent before any rewrite logic runs.
  const redirectTarget = OREUGO_LANDING_REDIRECTS[path];
  if (redirectTarget) {
    const url = request.nextUrl.clone();
    url.pathname = redirectTarget;
    return NextResponse.redirect(url, 308);
  }

  // 1) Known marketing page in the allow-list → rewrite to the HTML
  const pageSet = new Set(site.pages);
  if (pageSet.has(path) || pageSet.has(path.replace(/\.html$/, ""))) {
    const url = request.nextUrl.clone();
    let target: string;
    if (path === "/" || path === "") {
      target = "/index.html";
    } else if (path.endsWith(".html")) {
      target = path;
    } else {
      target = `${path}.html`;
    }
    url.pathname = `/sites/${site.slug}${target}`;
    return NextResponse.rewrite(url);
  }

  // 2) Static assets under the site's folder (CSS, JS, images)
  if (STATIC_FILE_PREFIXES.some((p) => path.startsWith(p)) || STATIC_FILE_PATHS.has(path)) {
    const url = request.nextUrl.clone();
    url.pathname = `/sites/${site.slug}${path}`;
    return NextResponse.rewrite(url);
  }

  // 3) Everything else — API, /signin, /partner/*, /pay/*, /l/*,
  //    /dashboard/*, /admin/*, etc — falls through untouched so the
  //    normal Next.js route handles it. This is why visiting
  //    indianbeans.com/partner/login or /signin still works for sign-in.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
