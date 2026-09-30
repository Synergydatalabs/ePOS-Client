// ============================================================================
// Moneris Checkout (MCO) — configuration constants.
//
// MCO is Moneris's hosted card-not-present product — different from the
// Moneris Go Cloud terminal API (which lives in src/lib/moneris/). Both
// APIs answer to "Moneris" but they don't share endpoints, auth format,
// or amount representation. Do NOT mix them.
//
// Amounts here are DOLLARS as strings ("452.00"), not cents. That's how
// the MCO wire format is defined — do the ¢ → $ conversion at the edge
// (route handler) before calling the client.
// ============================================================================

// Both preload and receipt requests POST to the same URL — the `action`
// field on the body switches between them.
export const MCO_ENDPOINTS = {
  qa: "https://gatewayt.moneris.com/chkt/request/request.php",
  prod: "https://gateway.moneris.com/chkt/request/request.php",
} as const;

export type McoEnvironment = keyof typeof MCO_ENDPOINTS;

export const MCO_ACTIONS = {
  PRELOAD: "preload",
  RECEIPT: "receipt",
} as const;

export type McoAction = (typeof MCO_ACTIONS)[keyof typeof MCO_ACTIONS];

// Timeout for both preload + receipt HTTPS calls. MCO responds fast
// (~1s p50) — a slow response usually means the wrong environment
// (qa vs prod), so we cut short at 15s and let ops see the error.
export const MCO_REQUEST_TIMEOUT_MS = 15_000;

// Amount formatter — MCO wants "452.00" style with exactly 2 decimal
// places. Any leading zero-only value ("0.00") is legal per the spec.
export function formatMcoAmount(cents: number): string {
  const dollars = cents / 100;
  return dollars.toFixed(2);
}

// Read platform-level MCO credentials from env vars. Used as the default
// for 2a. When we wire per-supplier/per-merchant creds in 2b/2d, the
// route accepts explicit credentials and skips this fallback.
export interface McoCredentials {
  store_id: string;
  api_token: string;
  checkout_id: string;
  environment: McoEnvironment;
}

export function getMcoCredentialsFromEnv(): McoCredentials {
  const store_id = process.env.MONERIS_MCO_STORE_ID;
  const api_token = process.env.MONERIS_MCO_API_TOKEN;
  const checkout_id = process.env.MONERIS_MCO_CHECKOUT_ID;
  const environmentRaw = (process.env.MONERIS_MCO_ENVIRONMENT || "qa").toLowerCase();
  const environment: McoEnvironment = environmentRaw === "prod" ? "prod" : "qa";
  if (!store_id) throw new Error("MONERIS_MCO_STORE_ID is not set");
  if (!api_token) throw new Error("MONERIS_MCO_API_TOKEN is not set");
  if (!checkout_id) throw new Error("MONERIS_MCO_CHECKOUT_ID is not set");
  return { store_id, api_token, checkout_id, environment };
}
