// ============================================
// Global Payments UCI (Unified Cloud Integration)
// Constants & environment config
//
// API reference:
//   https://developer.globalpayments.com/docs/payments/in-store/cloud
//
// Architecture: All UCI commands use a SINGLE endpoint:
//   POST {base}/ucp/device_commands
//
// The action_type field in the body determines what the device does:
//   AUTHORIZE / REFUND / PREAUTHORIZE / CAPTURE / ADJUST / REVERSE
//   CREATE_ORDER / DELETE_ORDER / TRANSACTION_LIST
//   PENDING_TRANSACTION_LIST / LAST_TRANSACTION / PING / BATCH_CLOSE
// ============================================

export const UCI_CONFIG = {
  CERT: {
    // GP has two sandboxes:
    //   - apis.sandbox.globalpay.com  → GP-API Sandbox (Drop-in / online)
    //   - apis-cert.globalpay.com     → UCI Certification (in-person terminals)
    //
    // The App ID may be enabled in only ONE of them.
    // Default: use the GP-API Sandbox (we KNOW the credentials work there
    // because Drop-in payments succeed). If UCI's device_commands endpoint
    // ALSO exists on this host, we're good. If not, override via env:
    //   GLOBALPAY_UCI_BASE_URL=https://apis-cert.globalpay.com
    //   GLOBALPAY_UCI_TOKEN_URL=https://apis-cert.globalpay.com/ucp/accesstoken
    BASE_URL: "https://apis.sandbox.globalpay.com",
    TOKEN_URL: "https://apis.sandbox.globalpay.com/ucp/accesstoken",
  },
  PROD: {
    BASE_URL: "https://apis.globalpay.com",
    TOKEN_URL: "https://apis.globalpay.com/ucp/accesstoken",
  },
} as const;

// Single endpoint — all action types POST here
export const UCI_ENDPOINT = "/ucp/device_commands";

// API version sent via X-GP-Version header.
// The UCI doc shows "03-02-2021" but GP-API rejects that with
// "X-GP-Version contains unexpected data". The valid format is ISO YYYY-MM-DD.
// Best guess from the doc's date is "2021-03-02"; override via env if needed:
//   GLOBALPAY_UCI_GP_VERSION=2021-03-22
export const UCI_GP_VERSION_DEFAULT = "2021-03-02";
export function getUciGpVersion(): string {
  return process.env.GLOBALPAY_UCI_GP_VERSION || UCI_GP_VERSION_DEFAULT;
}
// Kept as a const for back-compat with anything that imports it directly.
// Use getUciGpVersion() in new code so env overrides take effect at runtime.
export const UCI_GP_VERSION = UCI_GP_VERSION_DEFAULT;

// All known UCI action types.
//
// 2026-05-29 VERIFIED against live CERT: bill cancellation is `DELETE_ORDER`
// with the bill's DVC_Id passed as the `id` field (which GP maps to its
// internal `qprTransactionId`). The `BILL_DELETE` action from the Postman
// collection returns "action_type contains unexpected data" — it targets a
// different environment. DELETE_ORDER + id = HTTP 200 (confirmed working).
export const UCI_ACTIONS = {
  // Order/bill management
  CREATE_ORDER: "CREATE_ORDER",
  DELETE_ORDER: "DELETE_ORDER",
  PENDING_TRANSACTION_LIST: "PENDING_TRANSACTION_LIST",
  // Instant transactions
  AUTHORIZE: "AUTHORIZE",
  REFUND: "REFUND",
  PREAUTHORIZE: "PREAUTHORIZE",
  CAPTURE: "CAPTURE",
  ADJUST: "ADJUST",
  REVERSE: "REVERSE",
  REVERSE_AUTH: "REVERSE_AUTH",
  INCREMENT: "INCREMENT",
  // 2026-05-29: VERIFY (account verification / $0 auth) — required by the GP
  // UCI Test Script "Verify" use case. Confirms a card is valid without
  // charging it (AVS/CVV check, $0.00 or $0.01 auth then auto-void).
  VERIFY: "VERIFY",
  // Queries
  TRANSACTION_LIST: "TRANSACTION_LIST",
  LAST_TRANSACTION: "LAST_TRANSACTION",
  // Device management
  PING: "PING",
  BATCH_CLOSE: "BATCH_CLOSE",
  PARAMETERS_DOWNLOAD: "PARAMETERS_DOWNLOAD",
} as const;

export const UCI_TIMEOUTS = {
  AUTH: 10_000,
  COMMAND: 30_000,   // device_commands API call (terminal acks immediately)
  WEBHOOK: 5_000,
} as const;

/**
 * Trim env values aggressively — strip whitespace, CR/LF, BOM.
 * .env parsers usually do this, but PM2's ecosystem-config or copy-paste
 * can leave invisible chars that break SHA-512 hashing → "App credentials
 * not recognized" from GP even though the visible value looks correct.
 */
function clean(value: string | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/^﻿/, "")           // strip BOM
    .replace(/[\r\n\t]/g, "")         // strip CR / LF / tab inline
    .trim();                           // outer whitespace
}

export interface UciCredentialOverride {
  app_id?: string;
  app_key?: string;
  account_name?: string;
}

/**
 * Resolve the UCI runtime config.
 *
 * Phase 2d: pass `credentials` from the payment-router when a per-tenant
 * TenantPaymentProvider row is active for CARD — the router hands us the
 * decrypted { app_id, app_key, account_name } from that row and we use it
 * as an override on top of the env-baked fallback.
 *
 * When no override is supplied (legacy demo tenants that predate the
 * router, or ad-hoc admin / testing endpoints) the env vars still work.
 */
export function getUciConfig(credentials?: UciCredentialOverride) {
  const env =
    clean(process.env.GLOBALPAY_UCI_ENV || "CERT").toUpperCase() === "PROD"
      ? "PROD"
      : "CERT";
  const cfg = UCI_CONFIG[env];

  // Allow overriding base URL via env (e.g. switch CERT to apis-cert.globalpay.com)
  const baseUrl = clean(process.env.GLOBALPAY_UCI_BASE_URL) || cfg.BASE_URL;
  const tokenUrl = clean(process.env.GLOBALPAY_UCI_TOKEN_URL) || cfg.TOKEN_URL;

  const overrideAppId = clean(credentials?.app_id);
  const overrideAppKey = clean(credentials?.app_key);
  const overrideAccountName = clean(credentials?.account_name);

  return {
    env,
    baseUrl,
    tokenUrl,
    deviceCommandsUrl: `${baseUrl}${UCI_ENDPOINT}`,
    appId:
      overrideAppId ||
      clean(process.env.GLOBALPAY_UCI_APP_ID) ||
      clean(process.env.GP_DROPIN_APP_ID) ||
      clean(process.env.GP_CLOUD_APP_ID) ||
      "",
    appKey:
      overrideAppKey ||
      clean(process.env.GLOBALPAY_UCI_APP_KEY) ||
      clean(process.env.GP_DROPIN_APP_KEY) ||
      clean(process.env.GP_CLOUD_APP_KEY) ||
      "",
    accountName:
      overrideAccountName ||
      clean(process.env.GLOBALPAY_UCI_ACCOUNT_NAME) ||
      clean(process.env.GP_DROPIN_ACCOUNT_NAME) ||
      "",
    webhookSecret: clean(process.env.GLOBALPAY_UCI_WEBHOOK_SECRET),
    // Default webhook URL the device commands point to. Each request can
    // override this via params, but most flows want one canonical URL.
    defaultWebhookUrl:
      clean(process.env.GLOBALPAY_UCI_WEBHOOK_URL) ||
      `${clean(process.env.NEXT_PUBLIC_BASE_URL)}/api/webhooks/globalpay-uci`,
    isProduction: env === "PROD",
    // Flag so downstream helpers can log "per-tenant" vs "env fallback"
    // without leaking the actual credentials.
    isPerTenant: Boolean(overrideAppId && overrideAppKey),
  };
}
