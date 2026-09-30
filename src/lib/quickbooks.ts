// QuickBooks Online client + OAuth helpers.
//
// QBO US and QBO CA are separate Intuit apps with distinct client IDs
// and secrets, and the underlying REST API is shared but hits the same
// base URL (Intuit routes internally by realmId). We keep them separate
// in our env so a merchant can be connected to QBO CA on one tenant and
// QBO US on another without token collisions.
//
// Env vars expected (per region; leave one region unset to disable it):
//   QBO_US_CLIENT_ID, QBO_US_CLIENT_SECRET
//   QBO_CA_CLIENT_ID, QBO_CA_CLIENT_SECRET
//   QBO_ENVIRONMENT      = "sandbox" | "production"   (default: sandbox)
//   QBO_REDIRECT_URI     = "https://itap.zashx.com/api/integrations/quickbooks/callback"
//
// Nothing here throws when creds are missing — the admin UI shows a
// clear "not configured" state and the connect button is disabled.

import prisma from "./prisma";
import { decryptToken, encryptToken } from "./integration-crypto";

export type Region = "US" | "CA";
export type Provider = "QUICKBOOKS_US" | "QUICKBOOKS_CA";

const OAUTH_SCOPE = "com.intuit.quickbooks.accounting";
const OAUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function apiBase() {
  return process.env.QBO_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com/v3"
    : "https://sandbox-quickbooks.api.intuit.com/v3";
}

export function providerToRegion(p: Provider): Region {
  return p === "QUICKBOOKS_US" ? "US" : "CA";
}
export function regionToProvider(r: Region): Provider {
  return r === "US" ? "QUICKBOOKS_US" : "QUICKBOOKS_CA";
}

export function creds(region: Region): { clientId: string; clientSecret: string } | null {
  const clientId =
    region === "US" ? process.env.QBO_US_CLIENT_ID : process.env.QBO_CA_CLIENT_ID;
  const clientSecret =
    region === "US"
      ? process.env.QBO_US_CLIENT_SECRET
      : process.env.QBO_CA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function redirectUri(): string {
  return (
    process.env.QBO_REDIRECT_URI ||
    "http://localhost:4003/api/integrations/quickbooks/callback"
  );
}

/**
 * Build the Intuit OAuth authorization URL. State encodes the tenant id
 * + region + optional origin host so the callback can (a) persist
 * tokens without a session cookie round-trip and (b) redirect the
 * merchant back to the branded partner domain they started from.
 *
 * State format: "REGION:tenantId" or "REGION:tenantId:originHost"
 */
export function buildAuthorizeUrl(
  tenantId: string,
  region: Region,
  originHost?: string
): string | null {
  const c = creds(region);
  if (!c) return null;
  const state = originHost
    ? `${region}:${tenantId}:${originHost}`
    : `${region}:${tenantId}`;
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    scope: OAUTH_SCOPE,
    redirect_uri: redirectUri(),
    state,
  });
  return `${OAUTH_BASE}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  x_refresh_token_expires_in?: number;
  token_type: string;
}

/** Exchange the authorization code for an access + refresh token pair. */
export async function exchangeCodeForTokens(
  region: Region,
  code: string
): Promise<TokenResponse> {
  const c = creds(region);
  if (!c) throw new Error(`QBO ${region} credentials not configured`);
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QBO token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** Refresh an expired access token. Also rotates the refresh token. */
export async function refreshAccessToken(
  region: Region,
  refreshToken: string
): Promise<TokenResponse> {
  const c = creds(region);
  if (!c) throw new Error(`QBO ${region} credentials not configured`);
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QBO token refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Load a connection and return a valid access token, refreshing if the
 * stored one has expired (or is within 60s of expiring). Persists the
 * rotated tokens back to the DB.
 */
export async function getValidAccessToken(connectionId: string): Promise<{
  accessToken: string;
  realmId: string;
} | null> {
  const conn = await prisma.integrationConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn || conn.status !== "CONNECTED" || !conn.realmId) return null;

  const now = Date.now();
  const expires = conn.accessTokenExpires?.getTime() || 0;
  const needsRefresh = expires - now < 60_000;

  if (!needsRefresh) {
    const accessToken = decryptToken(conn.accessTokenEnc);
    if (accessToken) return { accessToken, realmId: conn.realmId };
  }

  // Refresh — decrypt refresh token, hit Intuit, persist rotated pair.
  const refreshToken = decryptToken(conn.refreshTokenEnc);
  if (!refreshToken) return null;
  const region = providerToRegion(conn.provider);
  try {
    const tok = await refreshAccessToken(region, refreshToken);
    const expiresAt = new Date(now + tok.expires_in * 1000);
    await prisma.integrationConnection.update({
      where: { id: connectionId },
      data: {
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: encryptToken(tok.refresh_token),
        accessTokenExpires: expiresAt,
        lastError: null,
        lastErrorAt: null,
      },
    });
    return { accessToken: tok.access_token, realmId: conn.realmId };
  } catch (err: any) {
    await prisma.integrationConnection.update({
      where: { id: connectionId },
      data: {
        status: "ERROR",
        lastError: err?.message || "Token refresh failed",
        lastErrorAt: new Date(),
      },
    });
    return null;
  }
}

/**
 * Post a Journal Entry to QBO. `entry` follows the standard QBO
 * JournalEntry schema — see lib/quickbooks-journal.ts for the builder.
 */
export async function postJournalEntry(
  connectionId: string,
  entry: unknown
): Promise<{ id: string; raw: unknown }> {
  const auth = await getValidAccessToken(connectionId);
  if (!auth) throw new Error("Not connected");
  const url = `${apiBase()}/company/${auth.realmId}/journalentry?minorversion=70`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(entry),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `QBO JournalEntry failed: ${res.status} ${JSON.stringify(raw)}`
    );
  }
  const id = raw?.JournalEntry?.Id;
  if (!id) throw new Error("QBO response missing JournalEntry.Id");
  return { id, raw };
}

/** Fetch the merchant's chart of accounts for the mapping UI. */
export async function listAccounts(connectionId: string) {
  const auth = await getValidAccessToken(connectionId);
  if (!auth) throw new Error("Not connected");
  // "Active = true" excludes soft-deleted accounts. Query language is
  // Intuit's SQL-lite dialect.
  const query = encodeURIComponent(
    "SELECT Id, Name, AccountType, AccountSubType, Classification FROM Account WHERE Active = true MAXRESULTS 1000"
  );
  const url = `${apiBase()}/company/${auth.realmId}/query?minorversion=70&query=${query}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: "application/json",
    },
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`QBO listAccounts failed: ${res.status}`);
  const accounts = raw?.QueryResponse?.Account || [];
  return accounts as Array<{
    Id: string;
    Name: string;
    AccountType?: string;
    AccountSubType?: string;
    Classification?: string;
  }>;
}
