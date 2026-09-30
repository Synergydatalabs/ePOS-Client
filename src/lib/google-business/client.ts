// ============================================================================
// src/lib/google-business/client.ts
//
// Thin Google Business Profile (GBP) API client. Wraps the OAuth dance
// and the My Business Business Information + Account Management endpoints
// we actually use.
//
// Scopes we request:
//   - https://www.googleapis.com/auth/business.manage  (read+write locations, hours, photos, reviews)
//
// Token refresh is automatic: any function that needs an access token
// will refresh-with-stored-refresh-token if the cached one has expired.
//
// Env vars (set on the platform, not per-tenant):
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REDIRECT_URI   (e.g. https://itap.zashx.com/api/auth/google-business/callback)
// ============================================================================

import prisma from "@/lib/prisma";
import { decryptString, encryptString } from "@/lib/crypto/encryption";

const SCOPE = "https://www.googleapis.com/auth/business.manage";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/** Build the consent-screen URL the partner is bounced to. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: env("GOOGLE_OAUTH_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",   // required to get a refresh_token
    prompt: "consent",        // force refresh_token issuance every time
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchange an authorization code (from the callback URL) for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
      redirect_uri: env("GOOGLE_OAUTH_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Refresh an access token using a stored refresh token. */
async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google refresh failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Load tenant's GBP creds, refresh if expired, return a usable access token.
 * Throws if the tenant hasn't connected GBP yet.
 */
export async function getAccessTokenForTenant(tenantId: string): Promise<string> {
  const s = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: {
      gbpAccessTokenEnc: true,
      gbpRefreshTokenEnc: true,
      gbpTokenExpiresAt: true,
    },
  });
  if (!s?.gbpAccessTokenEnc || !s.gbpRefreshTokenEnc) {
    throw new Error("Google Business Profile is not connected for this tenant.");
  }

  // 60-second buffer so we don't try to use a token about to expire mid-call.
  const stillValid =
    s.gbpTokenExpiresAt && s.gbpTokenExpiresAt.getTime() - Date.now() > 60_000;
  if (stillValid) return decryptString(s.gbpAccessTokenEnc);

  const refresh = decryptString(s.gbpRefreshTokenEnc);
  const refreshed = await refreshAccessToken(refresh);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

  await prisma.tenantSettings.update({
    where: { tenantId },
    data: {
      gbpAccessTokenEnc: encryptString(refreshed.access_token),
      gbpTokenExpiresAt: newExpiresAt,
    },
  });
  return refreshed.access_token;
}

/** Wrapper for authenticated GBP REST calls. */
async function gbpFetch(
  tenantId: string,
  url: string,
  init?: RequestInit
): Promise<any> {
  const token = await getAccessTokenForTenant(tenantId);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GBP ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Account + Location listing — called once after OAuth to pick which
// location ZASHX should be linked to (a Google account can manage many
// locations across multiple businesses).
// ---------------------------------------------------------------------------

export async function listAccounts(tenantId: string): Promise<
  Array<{ name: string; accountName: string; type: string }>
> {
  const data = await gbpFetch(
    tenantId,
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts"
  );
  return data.accounts || [];
}

export async function listLocationsForAccount(
  tenantId: string,
  accountResource: string
): Promise<
  Array<{
    name: string;
    title: string;
    storefrontAddress?: { addressLines?: string[]; locality?: string };
  }>
> {
  const fields = "name,title,storefrontAddress";
  const url =
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountResource}/locations` +
    `?readMask=${encodeURIComponent(fields)}`;
  const data = await gbpFetch(tenantId, url);
  return data.locations || [];
}

// ---------------------------------------------------------------------------
// Sync helpers — push ZASHX data to GBP and pull review data back.
// Each one returns a small status object so the sync orchestrator can
// report which steps succeeded.
// ---------------------------------------------------------------------------

export async function pushLocationBasics(tenantId: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { gbpLocationResource: true },
  });
  if (!s?.gbpLocationResource) return { ok: false, error: "No GBP location linked." };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });
  if (!tenant) return { ok: false, error: "Tenant not found." };

  // Push the tenant name → GBP location title. Hours/photos/etc are TODO
  // — they need richer source data on our side (regularHours, profile
  // photos uploaded to S3 with public URLs, etc.).
  try {
    await gbpFetch(
      tenantId,
      `https://mybusinessbusinessinformation.googleapis.com/v1/${s.gbpLocationResource}` +
        `?updateMask=title`,
      {
        method: "PATCH",
        body: JSON.stringify({ title: tenant.name }),
      }
    );
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "push failed" };
  }
}

export async function pullReviews(tenantId: string): Promise<{
  ok: boolean;
  count?: number;
  error?: string;
}> {
  const s = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { gbpAccountResource: true, gbpLocationResource: true },
  });
  if (!s?.gbpAccountResource || !s?.gbpLocationResource) {
    return { ok: false, error: "No GBP location linked." };
  }
  try {
    // mybusiness.googleapis.com (v4) is still the canonical Reviews API.
    const url = `https://mybusiness.googleapis.com/v4/${s.gbpAccountResource}/${s.gbpLocationResource}/reviews`;
    const data = await gbpFetch(tenantId, url);
    const count = (data.reviews || []).length;
    // Pull-side cache to a future GbpReview table goes here. For Phase 5e
    // we just confirm the fetch works and report the count back.
    return { ok: true, count };
  } catch (err: any) {
    return { ok: false, error: err?.message || "pull failed" };
  }
}

/** Run a full sync: push basics, pull reviews. Updates tenant settings
 *  with timestamp + status so the UI can show "Last synced 5 min ago". */
export async function runSync(tenantId: string): Promise<{
  ok: boolean;
  steps: { name: string; ok: boolean; error?: string; count?: number }[];
}> {
  const steps = [
    { name: "push:basics", ...(await pushLocationBasics(tenantId)) },
    { name: "pull:reviews", ...(await pullReviews(tenantId)) },
  ];
  const ok = steps.every((s) => s.ok);
  const firstError = steps.find((s) => !s.ok)?.error;

  await prisma.tenantSettings.update({
    where: { tenantId },
    data: {
      gbpLastSyncAt: new Date(),
      gbpLastSyncStatus: ok ? "ok" : "error",
      gbpLastSyncError: ok ? null : firstError || "unknown",
    },
  });
  return { ok, steps };
}
