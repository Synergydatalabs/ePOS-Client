// ============================================================================
// Payment provider router
//
// One entry point the POS uses to answer "which processor should handle this
// tenant's card / interac / gift card charge, and what are the credentials?"
// Reads TenantPaymentProvider rows written by tapapp-admin (Phase 2d) and
// returns the ACTIVE row for the requested (tenantId, capability). A short
// in-memory cache keeps this out of the hot path — each POS pane may hit
// the router several times per second when the operator is running through
// a check.
//
// Cache design:
//   • Per-process Map, TTL 60 s.
//   • No cross-process invalidation. Admin changes to a tenant's provider
//     become visible after up to 60 s of stale reads — an acceptable
//     tradeoff for MVP (payments are rare events and a stale read simply
//     posts to the previous processor for a few seconds).
//   • Negative cache: absence of an active provider is also cached, so a
//     tenant that has never had a provider assigned isn't re-queried on
//     every POS click.
//   • The router never throws for a missing provider — it returns null.
//     Callers decide whether that's a hard 400 to the POS or a fallback.
//
// Decryption uses the same kyb-crypto helper both apps share; the
// KYB_ENCRYPTION_KEY env var must be the same in tap-app and tapapp-admin.
// ============================================================================

import prisma from "@/lib/prisma";
import { kybDecryptJson } from "@/lib/kyb-crypto";

export type Processor = "GP" | "MONERIS" | "STRIPE";
export type Capability = "CARD" | "INTERAC" | "GIFT_CARD" | "ACH" | "ECOMMERCE";

export interface ActiveProvider {
  id: string;
  processor: Processor;
  capability: Capability;
  providerReferenceId: string;
  credentials: Record<string, unknown>;
  feeSchedule?: { percentBps?: number; fixedCents?: number } | null;
}

interface CacheEntry {
  data: ActiveProvider | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string, capability: Capability): string {
  return `${tenantId}::${capability}`;
}

/**
 * Returns the ACTIVE payment provider for a given (tenantId, capability),
 * or null if no active row exists. Result is cached for 60s.
 *
 * The caller MUST NOT log the returned `credentials` — it contains a
 * plaintext api_token / app_key. Pass it to the SDK and drop the reference.
 */
export async function getActiveProvider(args: {
  tenantId: string;
  capability: Capability;
  /** Skip the cache — useful in admin/debug endpoints. */
  bypassCache?: boolean;
}): Promise<ActiveProvider | null> {
  const key = cacheKey(args.tenantId, args.capability);
  const now = Date.now();

  if (!args.bypassCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.data;
    }
  }

  const row = await prisma.tenantPaymentProvider.findFirst({
    where: {
      tenantId: args.tenantId,
      capability: args.capability,
      status: "ACTIVE",
    },
    select: {
      id: true,
      processor: true,
      capability: true,
      externalMid: true,
      credentialsEnc: true,
      feeScheduleJson: true,
    },
  });

  if (!row) {
    cache.set(key, { data: null, expiresAt: now + CACHE_TTL_MS });
    return null;
  }

  let credentials: Record<string, unknown> = {};
  try {
    const decrypted = kybDecryptJson<Record<string, unknown>>(row.credentialsEnc);
    if (decrypted && typeof decrypted === "object") {
      credentials = decrypted;
    }
  } catch (err) {
    // Decrypt failure is a hard error — we can't post to the processor with
    // garbage credentials. Bust the cache so the next call tries again once
    // ops fixes the KYB_ENCRYPTION_KEY drift.
    cache.delete(key);
    throw new Error(
      `Failed to decrypt provider credentials (tenantPaymentProvider.id=${row.id}). ` +
        `Check that KYB_ENCRYPTION_KEY matches the value used by tapapp-admin. Underlying: ${
          (err as Error).message
        }`
    );
  }

  const active: ActiveProvider = {
    id: row.id,
    processor: row.processor as Processor,
    capability: row.capability as Capability,
    providerReferenceId: row.externalMid,
    credentials,
    feeSchedule: (row.feeScheduleJson as { percentBps?: number; fixedCents?: number } | null) ?? null,
  };
  cache.set(key, { data: active, expiresAt: now + CACHE_TTL_MS });
  return active;
}

/**
 * Manually invalidate the router cache for a tenant/capability pair.
 * Useful after an admin action in-process (e.g. an internal test harness);
 * for cross-process invalidation just wait out the TTL.
 */
export function invalidateProviderCache(args?: {
  tenantId?: string;
  capability?: Capability;
}): void {
  if (!args?.tenantId) {
    cache.clear();
    return;
  }
  if (args.capability) {
    cache.delete(cacheKey(args.tenantId, args.capability));
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(`${args.tenantId}::`)) cache.delete(key);
  }
}
