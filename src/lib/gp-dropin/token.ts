// ============================================
// Drop-in UI — access token
// POST /ucp/accesstoken
//   body: { app_id, nonce, secret=SHA512(nonce+app_key), grant_type, permissions }
//
// Note: this token is SHORT-LIVED (600s) and SHIPPED TO THE BROWSER,
// so it MUST include a narrow permission (PMT_POST_Create_Single)
// that only allows tokenization — NOT general transactions.
// Keep the broader UCI token separate.
//
// PHASE 7d-fix2 (2026-05-21): tokens are now cached in-memory per scope-set
// with a 30s safety margin before expiry. GP's /ucp/accesstoken occasionally
// takes 10-30s under sandbox load; caching avoids re-hitting it on every
// page load when the previous token is still valid.
// ============================================

import crypto from "crypto";
import { getDropinConfig, DROPIN_SCOPES, DROPIN_TIMEOUTS, GP_API_VERSION } from "./constants";
import { DropinAuthError, type DropinAccessToken } from "./types";

function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function hashSecret(nonce: string, appKey: string): string {
  return crypto.createHash("sha512").update(nonce + appKey, "utf8").digest("hex");
}

// ----------------------------------------------------------------------------
// PHASE 7d-fix2 (2026-05-21): in-memory token cache.
//
// Why: each call to GP /ucp/accesstoken can take 1-30+ seconds when sandbox
// is under load. The browser-side drop-in mount + server-side sale call each
// triggered a separate fetch, doubling the chance of hitting the timeout in
// a single checkout. By caching tokens keyed on their permission set, a
// hot path now costs ~0ms instead of a full GP roundtrip.
//
// Safety: we cache per-key (permission set is part of the key) and expire
// 30s BEFORE the actual GP expiry so we never serve an about-to-expire token.
// The cache lives in memory only — process restart resets it, which is fine
// since tokens are short-lived anyway.
// ----------------------------------------------------------------------------
const tokenCache = new Map<
  string,
  { token: string; type: string; expiresAt: Date; scope: string }
>();

function cacheKey(permissions: readonly string[] | undefined, secondsToExpire: number): string {
  const permsKey = permissions ? permissions.slice().sort().join(",") : "DEFAULT_SCOPE";
  return `${permsKey}::${secondsToExpire}`;
}

function getCachedToken(key: string) {
  const entry = tokenCache.get(key);
  if (!entry) return null;
  // 30s safety margin — never hand out a token within 30s of expiring
  if (entry.expiresAt.getTime() - Date.now() < 30_000) {
    tokenCache.delete(key);
    return null;
  }
  return entry;
}

/**
 * Fetch a Drop-in access token, using an in-memory cache to avoid
 * re-hitting GP on every request (see header comment).
 *
 * The cache is keyed on (permissions + secondsToExpire) so tokens with
 * different scopes don't collide.
 */
export async function getDropinAccessToken(options?: {
  /**
   * Restrict the token's permissions. Common values:
   *   - omit / undefined → default Drop-in tokenization scope (PMT_POST_Create_Single)
   *   - explicit array → use exactly those permissions
   *   - empty array [] → omit the field entirely (token gets App ID's full default scopes)
   */
  permissions?: readonly string[];
  secondsToExpire?: number;
}): Promise<DropinAccessToken> {
  const config = getDropinConfig();

  if (!config.appId || !config.appKey) {
    throw new DropinAuthError(
      "Drop-in credentials missing: set GP_DROPIN_APP_ID + GP_DROPIN_APP_KEY (or the GLOBALPAY_UCI_* / GP_CLOUD_* fallback pair)."
    );
  }

  // PHASE 7d-fix2: check cache first
  const secondsToExpire = options?.secondsToExpire ?? 600;
  const wantPermissionsForKey =
    options && "permissions" in options
      ? options.permissions
      : DROPIN_SCOPES;
  const key = cacheKey(wantPermissionsForKey, secondsToExpire);
  const cached = getCachedToken(key);
  if (cached) {
    return cached;
  }

  const nonce = generateNonce();
  const secret = hashSecret(nonce, config.appKey);

  // Resolve permissions:
  // - undefined / not passed → use Drop-in default scope
  // - empty array            → omit the field (broad server-side scopes)
  // - non-empty array        → use those
  const body: Record<string, unknown> = {
    app_id: config.appId,
    nonce,
    secret,
    grant_type: "client_credentials",
    seconds_to_expire: options?.secondsToExpire ?? 600,
  };

  const wantPermissions =
    options && "permissions" in options
      ? options.permissions
      : DROPIN_SCOPES; // default for browser-side tokenization

  if (Array.isArray(wantPermissions) && wantPermissions.length > 0) {
    body.permissions = wantPermissions;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GP-Version": GP_API_VERSION,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DROPIN_TIMEOUTS.AUTH),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.token) {
    const msg =
      data.error_description ||
      data.detailed_error_description ||
      data.error_message ||
      `Token request failed (status ${response.status})`;
    throw new DropinAuthError(msg);
  }

  // 🔎 Log the accounts bound to this App ID so we can pick the right
  // account_name / account_id for /ucp/transactions calls.
  // GP returns this in the token response — look in PM2 logs for the value.
  if (data.accounts) {
    console.log(
      "[DROPIN] Accounts bound to this App ID:",
      JSON.stringify(data.accounts, null, 2)
    );
  } else {
    console.log(
      "[DROPIN] Token response keys:",
      Object.keys(data).join(", ")
    );
  }

  const result = {
    token: data.token,
    type: data.type || "Bearer",
    expiresAt: new Date(Date.now() + (data.seconds_to_expire || 600) * 1000),
    scope: data.scope || DROPIN_SCOPES.join(","),
  };

  // PHASE 7d-fix2: stash in cache for subsequent calls in this process
  tokenCache.set(key, result);

  return result;
}
