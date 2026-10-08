// Host-based routing for the multi-tenant deployment.
//
// 2026-10-07 — Indian Beans landing site.
//
// All tenant portals + the hub itself run on this single Next.js
// process (port 4003). ALB forwards every host — hub.synergydatalabs.com,
// app.oreugo.ca, indianbeans.com, etc — to the same target group. This
// middleware looks at the incoming Host header and routes:
//
//   • indianbeans.com / www.indianbeans.com  → static landing pages
//       under /public/sites/indianbeans/. The customer never sees that
//       path — a rewrite (not redirect) means URLs stay clean.
//
//   • Every other host (hub.synergydatalabs.com, oreugo.ca, app.*,
//     etc) → falls through to Next.js routes exactly as before.
//
//   • Shared infra (/_next/*, /api/*, /pay/*, /l/*) always goes to
//     Next.js, even on a landing-site host. That way the payment-link
//     and iframe flows keep working no matter which brand the customer
//     clicks through from.
//
// Adding a new landed tenant later:
//   1. Drop their static files under /public/sites/<slug>/
//   2. Add their host(s) to LANDING_HOST_TO_SLUG below
//   3. Deploy — zero config changes elsewhere.

import { NextRequest, NextResponse } from "next/server";

// Hostname → folder name under /public/sites/ to serve from.
// Hostnames must be lowercase and WITHOUT port.
const LANDING_HOST_TO_SLUG: Record<string, string> = {
  "indianbeans.com": "indianbeans",
  "www.indianbeans.com": "indianbeans",
};

// Paths we never rewrite even on a landing-site host — the Next.js
// app owns these. Payment-link + embed flows must keep working so
// customers who click through a landing-page CTA that lands on a
// /pay/* or /l/* URL hit the real app.
const APP_PATH_PREFIXES = ["/_next/", "/api/", "/pay/", "/l/", "/partner/", "/supplier/", "/dashboard/", "/admin/"];

export function middleware(request: NextRequest) {
  const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
  const slug = LANDING_HOST_TO_SLUG[host];

  // Not a landing-site host → do nothing.
  if (!slug) return NextResponse.next();

  const path = request.nextUrl.pathname;

  // App-owned paths always fall through to Next.js, even on the
  // landing host.
  if (APP_PATH_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p))) {
    return NextResponse.next();
  }

  // Map the URL path to a file under /public/sites/<slug>/
  //   "/"              → "/index.html"
  //   "/features"      → "/features.html"
  //   "/features.html" → "/features.html"
  //   "/assets/x.css"  → "/assets/x.css"
  let target: string;
  if (path === "/" || path === "") {
    target = "/index.html";
  } else if (path.includes(".")) {
    target = path;
  } else {
    target = `${path}.html`;
  }

  const url = request.nextUrl.clone();
  url.pathname = `/sites/${slug}${target}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Run on every request EXCEPT static optimizer internals (those are
  // served by Next.js directly before middleware fires, but excluding
  // them keeps the matcher cheap and avoids any accidental interference).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
