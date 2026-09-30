// src/middleware.ts
// Dual-auth middleware:
// - White-label partner domains (oreugo.ca, etc.) → /partner/* routes with clean URLs
// - zashx.com → Cognito/NextAuth dashboard
// - POS → own JWT auth system

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

// Partner domains — add new partner domains here.
// These domains get clean URLs: oreugo.ca/login instead of oreugo.ca/partner/login.
//
// EXTRA_PARTNER_DOMAINS env var (comma-separated) lets a specific deploy
// add hostnames without a code change — e.g. the demo instance sets
// EXTRA_PARTNER_DOMAINS=demo.oreugo.ca so it renders Oreugo branding
// instead of the default ZASHX login. Live prod sets no such var and
// keeps just the hardcoded pair below.
const PARTNER_DOMAINS = [
  "oreugo.ca",
  "www.oreugo.ca",
  ...(process.env.EXTRA_PARTNER_DOMAINS?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) || []),
];

function isPartnerDomain(hostname: string): boolean {
  const host = hostname.split(":")[0].toLowerCase(); // strip port for local dev
  return PARTNER_DOMAINS.includes(host);
}

// Any Synergy Data Labs subdomain — hub.*, itap.* (legacy), www.*, apex.
// Kept in sync with isItapHost() in src/components/partner/site-shell.tsx.
// Used here to redirect the Oreugo-branded /partner landing page away on
// hub hosts, since we haven't built a hub-branded partner landing yet.
function isSynergyHost(hostname: string): boolean {
  const host = hostname.split(":")[0].toLowerCase();
  return host.includes("synergydatalabs") || host === "itap.zashx.com";
}

// Public paths that don't need auth on partner domains
const PARTNER_PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/privacy",
  "/terms",
  "/cookies",
  "/about",
];

function isPartnerPublicPath(pathname: string): boolean {
  return PARTNER_PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(p))
  );
}

// Map clean partner URLs to internal /partner/* routes
function getPartnerRewritePath(pathname: string): string {
  if (pathname === "/") return "/partner";
  // /login → /partner/login, /dashboard → /partner/dashboard, etc.
  return `/partner${pathname}`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get("host") || "";

  // ============================================
  // Synergy Data Labs / hub host — redirect the Oreugo landing away.
  //
  // /partner (and /partner/) on the Oreugo-branded flow renders the full
  // Oreugo marketing landing — logos, contact, socials, all Oreugo. On any
  // hub subdomain that reads as a whole-page brand mismatch (the nav is
  // hub/Synergy but the body is Oreugo). Redirect to /partner/signup
  // instead, which we've already re-skinned in teal for these hosts.
  // Runs before every other branch so no downstream rewrite can override it.
  if (
    isSynergyHost(hostname) &&
    (pathname === "/partner" || pathname === "/partner/")
  ) {
    return NextResponse.redirect(new URL("/partner/signup", request.url));
  }

  // ============================================
  // Apple Pay domain verification — per-domain routing
  // Apple gives each registered domain a UNIQUE verification file.
  // We store them in public/apple-pay/<hostname>.txt and rewrite
  // the magic .well-known URL to the correct file based on Host.
  //
  // To add a new partner domain:
  //   1. Register domain on Apple Developer Portal
  //   2. Download the verification file
  //   3. Save it as public/apple-pay/<domain>.txt
  //      (e.g. public/apple-pay/oreugo.ca.txt)
  //   4. Click Verify in Apple Portal — done.
  // ============================================
  if (
    pathname === "/.well-known/apple-developer-merchantid-domain-association.txt" ||
    pathname === "/.well-known/apple-developer-merchantid-domain-association"
  ) {
    // Keep the FULL host (including any www. prefix) since Apple treats
    // `oreugo.ca` and `www.oreugo.ca` as separate domains that each get
    // their own unique verification file.
    const host = hostname.split(":")[0].toLowerCase();
    return NextResponse.rewrite(
      new URL(`/apple-pay/${host}.txt`, request.url)
    );
  }

  // ============================================
  // PARTNER DOMAIN HANDLING (oreugo.ca, etc.)
  // Complete white-label — no zashx references
  // ============================================
  if (isPartnerDomain(hostname)) {
    // Skip static assets, API routes, and .well-known verification files
    // (.well-known is required by Apple Pay, Let's Encrypt, etc.)
    if (
      pathname.startsWith("/_next") ||
      pathname.startsWith("/images") ||
      pathname.startsWith("/.well-known") ||
      pathname.includes(".") ||
      pathname.startsWith("/api")
    ) {
      return NextResponse.next();
    }

    // POS + public display routes on partner domain — pass through.
    // Kitchen display, order-status display, and virtual tour are all
    // standalone screens that need to render on the partner domain too
    // (otherwise mounting a TV on oreugo.ca/kitchen-display/... returns 404).
    //
    // Phase 8 (2026-07-30): /supplier is added here too so the supplier
    // portal + public accept page both live at their own top-level path
    // instead of being rewritten to /partner/supplier/... (which doesn't
    // exist). Auth is enforced inside the supplier portal layout, same
    // pattern /pos and /dashboard/admin already use.
    if (
      pathname.startsWith("/pos") ||
      pathname.startsWith("/table") ||
      pathname.startsWith("/pay") ||
      // Payment-link public checkout — same public-access model as /pay.
      pathname.startsWith("/l/") ||
      pathname === "/l" ||
      pathname.startsWith("/kitchen-display") ||
      pathname.startsWith("/order-status") ||
      pathname.startsWith("/appointment-display") ||
      pathname.startsWith("/tour") ||
      pathname.startsWith("/supplier") ||
      // Public customer booking. Without this, oreugo.ca/book/... falls
      // through the auth check below and redirects to /login — which is
      // why the "copy public booking link" URL landed on the partner
      // login page instead of the customer's booking flow.
      pathname.startsWith("/book")
    ) {
      return NextResponse.next();
    }

    // Dashboard routes on partner domain — allow if partner_token is valid
    // (partner owner accessing admin portal, reports, etc.)
    if (pathname.startsWith("/dashboard")) {
      const partnerToken = request.cookies.get("partner_token")?.value;
      if (!partnerToken) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
      try {
        const { payload } = await jwtVerify(partnerToken, JWT_SECRET);
        if ((payload as Record<string, unknown>).authType !== "partner") {
          throw new Error("Invalid token type");
        }
        return NextResponse.next();
      } catch {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    // Phase C (2026-07-30): /platform — platform admin routes. Same auth
    // model as /dashboard on partner domains (must have a partner_token).
    // The email allowlist check happens inside the layout + endpoints via
    // requirePlatformAdmin() — middleware just gates who reaches those.
    if (pathname.startsWith("/platform")) {
      const partnerToken = request.cookies.get("partner_token")?.value;
      if (!partnerToken) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
      try {
        const { payload } = await jwtVerify(partnerToken, JWT_SECRET);
        if ((payload as Record<string, unknown>).authType !== "partner") {
          throw new Error("Invalid token type");
        }
        return NextResponse.next();
      } catch {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    // Public partner pages — rewrite to /partner/* without redirect
    if (isPartnerPublicPath(pathname)) {
      const rewritePath = getPartnerRewritePath(pathname);
      return NextResponse.rewrite(new URL(rewritePath, request.url));
    }

    // Protected partner pages — check partner_token
    const partnerToken = request.cookies.get("partner_token")?.value;

    if (!partnerToken) {
      // Redirect to /login (clean URL on partner domain)
      return NextResponse.redirect(new URL("/login", request.url));
    }

    try {
      const { payload } = await jwtVerify(partnerToken, JWT_SECRET);
      if ((payload as Record<string, unknown>).authType !== "partner") {
        throw new Error("Invalid token type");
      }
      // Valid session — rewrite to internal /partner/* path
      const rewritePath = getPartnerRewritePath(pathname);
      return NextResponse.rewrite(new URL(rewritePath, request.url));
    } catch {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // ============================================
  // STANDARD DOMAIN (zashx.com, localhost, etc.)
  // ============================================

  // Skip static/public/API routes
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/pos") ||
    pathname.startsWith("/table") ||
    pathname.startsWith("/pay") ||
    // Payment-link public checkout — /l/<slug>. Same public-access
    // model as /pay/invoice/<id>: the slug in the URL is the capability,
    // no supplier login required for the customer.
    pathname.startsWith("/l/") ||
    pathname === "/l" ||
    pathname.startsWith("/ride") ||
    pathname.startsWith("/kitchen-display") ||
    pathname.startsWith("/order-status") ||
    pathname.startsWith("/appointment-display") ||
    pathname.startsWith("/tour") ||
    // Phase 8 (2026-07-30): supplier portal — auth is enforced in its own
    // layout; the /supplier/accept/[token] subroute is public.
    pathname.startsWith("/supplier") ||
    pathname.startsWith("/api/public") ||
    // Phase 5c: webhook endpoints from Meta + Twilio — no user auth
    // (request signing verifies authenticity instead)
    pathname.startsWith("/api/webhooks") ||
    // Phase 5d: cron endpoints — auth via CRON_SECRET header instead of session
    pathname.startsWith("/api/cron") ||
    // Phase 6: public customer booking page — no auth (slug-based access)
    pathname.startsWith("/book") ||
    pathname === "/partner" ||
    pathname.startsWith("/partner/login") ||
    pathname.startsWith("/partner/signup") ||
    pathname.startsWith("/partner/reset-password") ||
    pathname.startsWith("/partner/privacy") ||
    pathname.startsWith("/partner/terms") ||
    pathname.startsWith("/partner/cookies") ||
    pathname.startsWith("/partner/about") ||
    // Phase F #5 (2026-08-27): public hub marketplace — browsable without
    // auth so a prospective merchant can shop before signing up.
    pathname === "/marketplace" ||
    pathname.startsWith("/marketplace/") ||
    pathname.includes(".") ||
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname === "/activate" ||
    pathname === "/"
  ) {
    return NextResponse.next();
  }

  // /partner/* protected routes on standard domain — check partner_token
  if (pathname.startsWith("/partner")) {
    const partnerToken = request.cookies.get("partner_token")?.value;

    if (!partnerToken) {
      return NextResponse.redirect(new URL("/partner/login", request.url));
    }

    try {
      const { payload } = await jwtVerify(partnerToken, JWT_SECRET);
      if ((payload as Record<string, unknown>).authType !== "partner") {
        throw new Error("Invalid token type");
      }
      return NextResponse.next();
    } catch {
      return NextResponse.redirect(new URL("/partner/login", request.url));
    }
  }

  // Dashboard routes — check Cognito/NextAuth OR partner_token (for demo/local auth users)
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (token) {
    return NextResponse.next();
  }

  // No Cognito session — check for partner_token (demo/local auth)
  const partnerToken = request.cookies.get("partner_token")?.value;
  if (partnerToken) {
    try {
      const { payload } = await jwtVerify(partnerToken, JWT_SECRET);
      if ((payload as Record<string, unknown>).authType === "partner") {
        return NextResponse.next();
      }
    } catch {
      // Invalid partner token, fall through to redirect
    }
  }

  const signInUrl = new URL("/signin", request.url);
  signInUrl.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
