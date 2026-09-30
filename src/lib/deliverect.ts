// Deliverect middleware client.
//
// Deliverect connects one API to DoorDash, Uber Eats, SkipTheDishes,
// Grubhub etc. — the merchant pays Deliverect (~$50–100/mo per store)
// and gets a single account with per-location IDs.
//
// Auth model chosen for MVP: **per-tenant credentials**, not shared OAuth.
// Reason: Deliverect doesn't have a public OAuth flow for third-party
// apps — they issue API keys to accounts. Each merchant enters their
// own client_id + client_secret + location_id in iTap's admin UI.
// (Contrast with QBO where iTap has one app + merchants OAuth.)
//
// Env vars:
//   DELIVERECT_API_BASE  = 'https://api.deliverect.com' (default)
//
// Token flow (per-tenant): POST /oauth/token with client_credentials
//   grant to get a short-lived access token. We cache it in-process
//   for its expiry window minus a safety buffer, refreshing on demand.

import prisma from "./prisma";
import { decryptToken, encryptToken } from "./integration-crypto";
import crypto from "crypto";

const API_BASE = process.env.DELIVERECT_API_BASE || "https://api.deliverect.com";

// In-process token cache. Keyed by connectionId → { token, expiresAt }.
// Cleared on process restart, which is fine — we just refetch.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  token_type: string;
}

async function fetchAccessToken(
  clientId: string,
  clientSecret: string
): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: API_BASE,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Deliverect token failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Fetch a valid access token for a connection, hitting Deliverect only
 * when the cached one has expired (or is within 60s of expiring).
 */
async function getAccessToken(connectionId: string): Promise<string> {
  const cached = tokenCache.get(connectionId);
  if (cached && cached.expiresAt - Date.now() > 60_000) {
    return cached.token;
  }

  const conn = await prisma.integrationConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn || conn.status !== "CONNECTED") {
    throw new Error("Deliverect connection not active");
  }
  const clientId = decryptToken(conn.apiKeyEnc);
  const clientSecret = decryptToken(conn.apiSecretEnc);
  if (!clientId || !clientSecret) {
    throw new Error("Deliverect credentials missing on connection");
  }

  const tok = await fetchAccessToken(clientId, clientSecret);
  const expiresAt = Date.now() + tok.expires_in * 1000;
  tokenCache.set(connectionId, { token: tok.access_token, expiresAt });
  return tok.access_token;
}

/**
 * Build the menu payload Deliverect expects for a given tenant. Very
 * simplified — Deliverect's real schema has modifier groups, availability
 * schedules, price adjustments etc. This structure is enough to push a
 * basic menu; a merchant-fixup pass in Deliverect's UI fine-tunes it.
 */
export async function buildMenuPayload(tenantId: string) {
  const categories = await prisma.category.findMany({
    where: { tenantId, isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      products: {
        where: { isActive: true, isAvailable: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return {
    // Deliverect wants an id + name at the top level. We use tenantId
    // as the stable menu id — safe since it doesn't change.
    id: tenantId,
    name: "iTAP Menu",
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || undefined,
      products: c.products.map((p) => ({
        id: p.id,
        plu: p.sku || p.id,
        name: p.name,
        description: p.description || undefined,
        // Deliverect prices in cents matches our storage — no conversion
        price: p.basePrice,
        imageUrl: p.imageUrl || undefined,
        available: p.isAvailable,
      })),
    })),
  };
}

/**
 * Push the tenant's current menu to Deliverect. Returns the API response
 * for logging. Errors bubble up so the caller can surface + record them.
 */
export async function pushMenu(connectionId: string): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
}> {
  const token = await getAccessToken(connectionId);
  const conn = await prisma.integrationConnection.findUnique({
    where: { id: connectionId },
    select: { tenantId: true, externalLocationId: true },
  });
  if (!conn || !conn.externalLocationId) {
    throw new Error("Connection missing external location id");
  }
  const menu = await buildMenuPayload(conn.tenantId);

  const res = await fetch(
    `${API_BASE}/locations/${conn.externalLocationId}/menu`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(menu),
    }
  );
  const body = await res.json().catch(() => ({}));

  // Persist the last-sync marker regardless of outcome so admins can
  // see when the last attempt happened.
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      ...(res.ok
        ? { lastError: null, lastErrorAt: null }
        : {
            lastError: `Menu push failed: ${res.status}`,
            lastErrorAt: new Date(),
          }),
    },
  });

  return { ok: res.ok, status: res.status, body };
}

/**
 * Push an order status update back to Deliverect so the delivery
 * platform (DoorDash / UE / Skip) sees the current state. Call this
 * whenever our Order.status advances for an order that came IN from
 * Deliverect. See DeliverectOrder table for provenance lookup.
 */
export async function pushOrderStatus(
  connectionId: string,
  externalOrderId: string,
  status: "ACCEPTED" | "PREPARING" | "READY" | "PICKED_UP" | "CANCELLED"
): Promise<{ ok: boolean; status: number }> {
  const token = await getAccessToken(connectionId);
  const res = await fetch(
    `${API_BASE}/orders/${externalOrderId}/status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    }
  );
  return { ok: res.ok, status: res.status };
}

/**
 * Verify an inbound webhook's signature. Deliverect signs the raw
 * request body with the shared webhook secret (HMAC SHA-256). We
 * compare in constant time so a timing attack can't leak byte-by-byte.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string
): boolean {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  // Both must be same-length for timingSafeEqual — pad if needed.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Helper for admins to (re-)generate a per-connection webhook secret
 * when they set up the integration. Returns the plaintext once so the
 * admin can paste it into Deliverect's dashboard; then it's encrypted
 * in the DB and never returned again.
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Persist + return an encrypted webhook secret for a connection.
 */
export async function rotateWebhookSecret(connectionId: string): Promise<string> {
  const secret = generateWebhookSecret();
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: { webhookSecretEnc: encryptToken(secret) },
  });
  return secret;
}
