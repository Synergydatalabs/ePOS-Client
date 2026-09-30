// =============================================================================
// Phase F #6i (2026-08-28) — canonical public-origin resolver.
//
// Any URL we generate that will be seen by a *customer* (invoice pay link,
// Stripe success/cancel URL, webhook return URL, email deep link) must use
// the platform's canonical public origin — never the Node process's bind
// address (0.0.0.0:PORT) and never a retired legacy alias
// (itap.zashx.com, itap.synergydatalabs.com).
//
// Preference chain:
//   1. NEXT_PUBLIC_APP_URL — the canonical origin per env
//      (hub.synergydatalabs.com in prod). Set once, applies everywhere.
//   2. x-forwarded-proto/host — set by Nginx/ALB when behind a proxy.
//   3. host header — untrusted fallback but still better than a bind addr.
//   4. request.nextUrl — dev-only fallback (would be 0.0.0.0:PORT in prod
//      running behind PM2 without a proxy, which is what shipped payment
//      links pointing at 0.0.0.0:4003).
//
// After resolution we apply the legacy-host rewrite so any lingering
// itap.zashx.com traffic still generates hub.synergydatalabs.com URLs —
// belt and suspenders in case the env var isn't set.
// =============================================================================

import type { NextRequest } from "next/server";

const LEGACY_HOST_MAP: Record<string, string> = {
  "itap.zashx.com": "https://hub.synergydatalabs.com",
  "itap.synergydatalabs.com": "https://hub.synergydatalabs.com",
};

export function resolvePublicOrigin(request: NextRequest): string {
  const originFromEnv = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto");
  const hostHeader = request.headers.get("host");

  let origin =
    originFromEnv ||
    (fwdHost ? `${fwdProto || "https"}://${fwdHost}` : null) ||
    (hostHeader ? `${request.nextUrl.protocol}//${hostHeader}` : null) ||
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;

  for (const [legacy, canonical] of Object.entries(LEGACY_HOST_MAP)) {
    if (origin.includes(legacy)) {
      origin = canonical;
      break;
    }
  }

  return origin;
}
