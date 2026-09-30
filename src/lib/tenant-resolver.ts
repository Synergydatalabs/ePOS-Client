// Tenant Resolver - resolves tenant from hostname/domain for white-label routing

import prisma from "./prisma";

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  authProvider: string;
  branding: {
    brandName: string | null;
    brandLogoUrl: string | null;
    brandFaviconUrl: string | null;
    brandPrimaryColor: string;
    brandAccentColor: string;
    brandBackgroundColor: string;
    poweredByVisible: boolean;
  };
}

// Simple in-memory cache with 5-minute TTL
const cache = new Map<string, { data: ResolvedTenant | null; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): ResolvedTenant | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCache(key: string, data: ResolvedTenant | null) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  // Prevent unbounded cache growth
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

/**
 * Clear cache for a specific hostname (call after branding update)
 */
export function invalidateTenantCache(hostname?: string) {
  if (hostname) {
    cache.delete(hostname);
  } else {
    cache.clear();
  }
}

/**
 * Resolve tenant from request hostname.
 * Returns null for standard zashx.com requests (use default Cognito flow).
 */
export async function resolveTenant(hostname: string): Promise<ResolvedTenant | null> {
  // Strip port for local development
  const host = hostname.split(":")[0].toLowerCase();

  // Skip standard zashx domains — these use Cognito auth
  if (host === "localhost" || host.endsWith(".zashx.com") || host === "zashx.com") {
    return null;
  }

  // Check cache
  const cached = getCached(host);
  if (cached !== undefined) return cached;

  // 1. Try custom domain match (e.g., oreugo.ca)
  //
  // PHASE 7a (2026-05-18): match BOTH bare apex AND www variants.
  // Partners typically register only one form in TenantSettings.customDomain,
  // but real users hit both `oreugo.ca` AND `www.oreugo.ca`. Without this
  // normalization, the un-registered form would fall through to the iTap
  // default branding — exactly the bug partners reported.
  //
  // We DON'T touch storage; whatever the admin entered remains as-is.
  // Lookup is what gets relaxed.
  const hostBare = host.replace(/^www\./, "");
  const hostWww = `www.${hostBare}`;
  const candidates = Array.from(new Set([host, hostBare, hostWww]));

  const settingsByDomain = await prisma.tenantSettings.findFirst({
    where: { customDomain: { in: candidates } },
    include: {
      tenant: {
        select: { id: true, slug: true, name: true, authProvider: true, status: true },
      },
    },
  });

  if (settingsByDomain && settingsByDomain.tenant.status === "ACTIVE") {
    const resolved: ResolvedTenant = {
      id: settingsByDomain.tenant.id,
      slug: settingsByDomain.tenant.slug,
      name: settingsByDomain.tenant.name,
      authProvider: settingsByDomain.tenant.authProvider,
      branding: {
        brandName: settingsByDomain.brandName,
        brandLogoUrl: settingsByDomain.brandLogoUrl,
        brandFaviconUrl: settingsByDomain.brandFaviconUrl,
        brandPrimaryColor: settingsByDomain.brandPrimaryColor,
        brandAccentColor: settingsByDomain.brandAccentColor,
        brandBackgroundColor: settingsByDomain.brandBackgroundColor,
        poweredByVisible: settingsByDomain.poweredByVisible,
      },
    };
    setCache(host, resolved);
    return resolved;
  }

  // 2. No match — cache null to avoid repeated DB lookups
  setCache(host, null);
  return null;
}

/**
 * Resolve tenant by slug (for API routes like /api/partner/branding?slug=oreugo)
 */
export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    include: {
      settings: true,
    },
  });

  if (!tenant || tenant.status !== "ACTIVE" || !tenant.settings) return null;

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    authProvider: tenant.authProvider,
    branding: {
      brandName: tenant.settings.brandName,
      brandLogoUrl: tenant.settings.brandLogoUrl,
      brandFaviconUrl: tenant.settings.brandFaviconUrl,
      brandPrimaryColor: tenant.settings.brandPrimaryColor,
      brandAccentColor: tenant.settings.brandAccentColor,
      brandBackgroundColor: tenant.settings.brandBackgroundColor,
      poweredByVisible: tenant.settings.poweredByVisible,
    },
  };
}
