// ============================================
// Global Payments Drop-in UI — constants
// Online card / wallet payments via GP's hosted tokenization.
// Same GP-API auth as UCI (App ID + App Key + SHA-512 nonce).
// ============================================

export const DROPIN_CONFIG = {
  SANDBOX: {
    BASE_URL: "https://apis.sandbox.globalpay.com",
    TOKEN_URL: "https://apis.sandbox.globalpay.com/ucp/accesstoken",
    TRANSACTIONS_URL: "https://apis.sandbox.globalpay.com/ucp/transactions",
    // Frontend JS library CDN — pin to an explicit version for stability
    JS_LIB_URL: "https://js.globalpay.com/4.1.11/globalpayments.js",
    JS_ENV: "sandbox" as const,
  },
  PRODUCTION: {
    BASE_URL: "https://apis.globalpay.com",
    TOKEN_URL: "https://apis.globalpay.com/ucp/accesstoken",
    TRANSACTIONS_URL: "https://apis.globalpay.com/ucp/transactions",
    JS_LIB_URL: "https://js.globalpay.com/4.1.11/globalpayments.js",
    JS_ENV: "production" as const,
  },
} as const;

// Drop-in tokenization needs this specific permission on the access token
export const DROPIN_SCOPES = ["PMT_POST_Create_Single"] as const;

// Default country / currency for this deployment (Oreugo / iTap — Canada)
export const DROPIN_DEFAULTS = {
  country: "CA",
  currency: "CAD",
} as const;

export const DROPIN_TIMEOUTS = {
  // PHASE 7d-fix2 (2026-05-21): bumped from 10s to 30s.
  // GP sandbox occasionally takes 12-20s to respond to /ucp/accesstoken
  // when under load (e.g. multiple browser sessions or rapid mount+submit
  // sequences from the demo page). 10s was hitting the timeout and surfacing
  // as "Payment service error (HTTP 500)" to clients in the middle of a demo.
  // 30s matches the existing CHARGE timeout — better to wait than to fail.
  AUTH: 30_000,
  CHARGE: 30_000,
} as const;

export const GP_API_VERSION = "2021-03-22";

export function getDropinConfig() {
  const isProd = (process.env.GP_DROPIN_ENV || process.env.GLOBALPAY_UCI_ENV || "sandbox")
    .toLowerCase()
    .startsWith("prod");
  const env = isProd ? "PRODUCTION" : "SANDBOX";
  const cfg = DROPIN_CONFIG[env];

  return {
    env,
    isProduction: isProd,
    baseUrl: cfg.BASE_URL,
    tokenUrl: cfg.TOKEN_URL,
    transactionsUrl: cfg.TRANSACTIONS_URL,
    jsLibUrl: cfg.JS_LIB_URL,
    jsEnv: cfg.JS_ENV,
    appId:
      process.env.GP_DROPIN_APP_ID ||
      process.env.GLOBALPAY_UCI_APP_ID ||
      process.env.GP_CLOUD_APP_ID ||
      "",
    appKey:
      process.env.GP_DROPIN_APP_KEY ||
      process.env.GLOBALPAY_UCI_APP_KEY ||
      process.env.GP_CLOUD_APP_KEY ||
      "",
    country: process.env.GP_DROPIN_COUNTRY || DROPIN_DEFAULTS.country,
    currency: process.env.GP_DROPIN_CURRENCY || DROPIN_DEFAULTS.currency,
    // Optional — set when the App ID is bound to multiple merchant accounts
    // and GP requires us to pick one for /ucp/transactions calls.
    accountName: process.env.GP_DROPIN_ACCOUNT_NAME || "",
    accountId: process.env.GP_DROPIN_ACCOUNT_ID || "",
    // Merchant ID — used by Google Pay / Apple Pay tokenization
    // (e.g. "MER_046fc2d53b7246e693833fd1be210ca9")
    merchantId: process.env.GP_DROPIN_MERCHANT_ID || "",
    // Apple Pay merchant identifier — registered on Apple Developer Portal
    // (e.g. "merchant.com.oreugo"). Required for Apple Pay sheet to launch.
    appleMerchantId: process.env.GP_DROPIN_APPLE_MERCHANT_ID || "",
  };
}
