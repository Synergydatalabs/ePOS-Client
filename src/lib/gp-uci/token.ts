// ============================================
// UCI — Access token (reuses GP-API auth flow)
// POST /ucp/accesstoken with app_id + secret + nonce
//
// IMPORTANT: `secret` is NOT the raw App Key.
// GP-API requires: secret = SHA-512(nonce + app_key), hex-encoded.
//
// Token lives ~30 minutes; we cache with a 30s buffer.
// ============================================

import crypto from "crypto";
import { getUciConfig, UCI_TIMEOUTS, type UciCredentialOverride } from "./constants";
import { UciAuthError, type UciAccessToken } from "./types";

// Cache keyed by app_id so per-tenant credentials (Phase 2d) get their own
// token slot without stomping on the shared/env-based token that the demo
// tenants use. Empty string is the env-default slot.
const tokenCache = new Map<string, UciAccessToken>();

function generateNonce(): string {
  // 16-char random hex nonce — must be unique per request
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Build the `secret` field GP expects on the token request.
 * Per GP-API spec: sha512(nonce + app_key), lowercase hex.
 */
function computeSecret(nonce: string, appKey: string): string {
  return crypto.createHash("sha512").update(nonce + appKey, "utf8").digest("hex");
}

export function clearUciTokenCache() {
  tokenCache.clear();
}

export async function getUciAccessToken(credentials?: UciCredentialOverride): Promise<string> {
  const config = getUciConfig(credentials);
  const cacheSlot = config.appId || "__env_default__";
  const cached = tokenCache.get(cacheSlot);

  if (!config.appId || !config.appKey) {
    throw new UciAuthError(
      "GLOBALPAY_UCI_APP_ID and GLOBALPAY_UCI_APP_KEY must be set (or GP_CLOUD_APP_ID / GP_CLOUD_APP_KEY fallback)"
    );
  }

  // Return cached token if still valid with 30s buffer
  if (cached && cached.expiresAt > new Date(Date.now() + 30_000)) {
    console.log("[UCI TOKEN] Returning cached token, expires:", cached.expiresAt.toISOString());
    return cached.token;
  }

  const nonce = generateNonce();
  const secret = computeSecret(nonce, config.appKey);

  // Verbose logging so we can compare what fails (this path) vs what
  // succeeds (the diagnostic endpoint's selfTest). The values logged are
  // safe to share — secret is the SHA-512 hash, not the App Key.
  console.log("[UCI TOKEN] About to POST", {
    url: config.tokenUrl,
    appIdLast8: config.appId.slice(-8),
    appIdLength: config.appId.length,
    appKeyLength: config.appKey.length,
    appKeySha256First16: crypto
      .createHash("sha256")
      .update(config.appKey, "utf8")
      .digest("hex")
      .slice(0, 16),
    nonce,
    secretFirst16: secret.slice(0, 16),
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GP-Version": "2021-03-22",
      Accept: "application/json",
    },
    body: JSON.stringify({
      app_id: config.appId,
      nonce,
      secret,
      grant_type: "client_credentials",
    }),
    // Removed AbortSignal.timeout — was a possible suspect; not needed in v1
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[UCI TOKEN] Failed", {
      status: response.status,
      url: config.tokenUrl,
      response: errorText,
    });
    throw new UciAuthError(`Token request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.token) {
    throw new UciAuthError(`Token response missing 'token' field: ${JSON.stringify(data)}`);
  }

  const fresh: UciAccessToken = {
    token: data.token,
    type: data.type || "Bearer",
    expiresAt: new Date(Date.now() + (data.seconds_to_expire || 1800) * 1000),
    scope: data.scope || "TRN",
  };
  tokenCache.set(cacheSlot, fresh);

  console.log(
    "[UCI] Access token obtained, expires:",
    fresh.expiresAt.toISOString(),
    "  slot=",
    cacheSlot === "__env_default__" ? "env" : `tenant(${cacheSlot.slice(-8)})`
  );
  return fresh.token;
}
