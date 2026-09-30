// ============================================================================
// Phase I #6 (2026-09-18) — Payments API bearer-key auth
//
// The public /api/public/v1/* endpoints authenticate with an opaque bearer
// key the tenant minted in the supplier portal ("Authorization: Bearer
// sk_...abcd"). Keys are stored SHA-256 hashed; we hash the presented
// value and look it up on the unique key_hash column.
//
// Rate limiting is in-memory (per key, per process) — sufficient for a
// single Windows-EC2 node. If we horizontally scale we replace the Map
// with Redis, same interface.
// ============================================================================

import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";

const KEY_PREFIX_DEFAULT = "sk";
const KEY_RANDOM_BYTES = 32; // → 43 base64url chars of entropy
const RATE_LIMIT_MAX = 100; // requests per WINDOW
const RATE_LIMIT_WINDOW_MS = 1_000;

// ---------------------------------------------------------------------------
// Key generation / hashing
// ---------------------------------------------------------------------------

/**
 * Mint a new plaintext API key + its storage record fields. The plaintext
 * is returned once and never persisted.
 *
 * Format: `${prefix}_${43-char base64url}` — e.g.
 * `sk_TnaFm7O7d5m0Z3PY9jH0nX8lU-4-1v0lF6qCbrLoU9Q`.
 * The prefix carries no test/live meaning; the tenant's Stripe mode is a
 * property of their TenantPaymentProvider config at call time.
 */
export function mintApiKey(prefix: string = KEY_PREFIX_DEFAULT): {
  plaintext: string;
  keyHash: string;
  keyLast4: string;
  keyPrefix: string;
} {
  const cleanPrefix = prefix.replace(/[^a-z0-9_]/gi, "").slice(0, 24) || KEY_PREFIX_DEFAULT;
  const random = randomBytes(KEY_RANDOM_BYTES).toString("base64url");
  const plaintext = `${cleanPrefix}_${random}`;
  const keyHash = createHash("sha256").update(plaintext).digest("hex");
  const keyLast4 = plaintext.slice(-4);
  return { plaintext, keyHash, keyLast4, keyPrefix: cleanPrefix };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

// ---------------------------------------------------------------------------
// Rate limiting (per-key, sliding-ish window)
// ---------------------------------------------------------------------------

interface RateBucket {
  windowStart: number;
  count: number;
}
const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(keyHash: string): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(keyHash);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(keyHash, { windowStart: now, count: 1 });
    return { ok: true };
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return { ok: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart) };
  }
  bucket.count += 1;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bearer extraction + lookup
// ---------------------------------------------------------------------------

export type ApiKeyAuthError =
  | { kind: "missing"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "revoked"; message: string }
  | { kind: "rate_limited"; message: string; retryAfterMs: number };

export interface AuthedApiKey {
  id: string;
  tenantId: string;
  keyPrefix: string;
  keyLast4: string;
}

/**
 * Extract + validate the bearer key on `request`. Returns the row on
 * success or an ApiKeyAuthError describing why the caller was rejected.
 *
 * On success, fire-and-forget updates `last_used_at`/`last_used_ip` so
 * the tenant can see key activity in the portal.
 */
export async function requireApiKey(
  request: NextRequest
): Promise<{ ok: true; key: AuthedApiKey } | { ok: false; error: ApiKeyAuthError }> {
  const header = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!header) {
    return {
      ok: false,
      error: { kind: "missing", message: "Missing Authorization header (expected: Bearer <key>)" },
    };
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      ok: false,
      error: { kind: "invalid", message: "Authorization header must be `Bearer <key>`" },
    };
  }
  const plaintext = match[1].trim();
  if (!plaintext) {
    return { ok: false, error: { kind: "invalid", message: "Empty bearer token" } };
  }

  const keyHash = hashApiKey(plaintext);
  const row = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: { id: true, tenantId: true, enabled: true, revokedAt: true, keyPrefix: true, keyLast4: true },
  });
  if (!row) {
    return { ok: false, error: { kind: "invalid", message: "Invalid API key" } };
  }
  if (!row.enabled || row.revokedAt) {
    return { ok: false, error: { kind: "revoked", message: "API key is disabled or revoked" } };
  }

  const rate = checkRateLimit(keyHash);
  if (!rate.ok) {
    return {
      ok: false,
      error: {
        kind: "rate_limited",
        message: `Rate limit exceeded (max ${RATE_LIMIT_MAX} req/s per key)`,
        retryAfterMs: rate.retryAfterMs,
      },
    };
  }

  // Fire-and-forget usage bump — never blocks the request.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  void prisma.apiKey
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date(), lastUsedIp: ip?.slice(0, 64) ?? undefined },
    })
    .catch(() => {
      /* swallowed — usage tracking is best-effort */
    });

  return {
    ok: true,
    key: {
      id: row.id,
      tenantId: row.tenantId,
      keyPrefix: row.keyPrefix,
      keyLast4: row.keyLast4,
    },
  };
}

/**
 * Standard error-response payload for the public API. Keeps every
 * endpoint's shape consistent with what SDL's other site expects.
 */
export function apiErrorResponse(error: ApiKeyAuthError): {
  status: number;
  body: { error: { type: string; message: string; retry_after_ms?: number } };
  headers?: Record<string, string>;
} {
  switch (error.kind) {
    case "missing":
    case "invalid":
      return { status: 401, body: { error: { type: "authentication_error", message: error.message } } };
    case "revoked":
      return { status: 403, body: { error: { type: "permission_error", message: error.message } } };
    case "rate_limited":
      return {
        status: 429,
        body: {
          error: {
            type: "rate_limit_error",
            message: error.message,
            retry_after_ms: error.retryAfterMs,
          },
        },
        headers: { "Retry-After": String(Math.ceil(error.retryAfterMs / 1000)) },
      };
  }
}

// ---------------------------------------------------------------------------
// CORS (Phase I #10, 2026-09-19)
//
// The public /api/public/v1/* endpoints are called from partner-controlled
// origins — their websites, hosted test HTML files, and the like. Emit
// permissive CORS headers so browsers accept the response.
//
// Wildcard origin is safe here: auth is via Bearer token (not cookies),
// so we can't accidentally leak a session across origins — the token
// alone grants access. Partners who don't want their key in browser code
// simply keep server-to-server calls.
// ---------------------------------------------------------------------------

export const PUBLIC_API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "Retry-After",
};

/** Standard 204 preflight response used by every OPTIONS handler. */
export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_API_CORS_HEADERS });
}
