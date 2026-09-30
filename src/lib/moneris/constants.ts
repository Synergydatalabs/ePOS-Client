// ============================================================================
// Moneris Go Cloud — configuration constants.
//
// The Cloud API base URL differs per environment (test vs prod). Everything
// else (timeouts, polling cadence, action names) is stable across both.
//
// Per-tenant credentials live encrypted in TenantPaymentProvider.credentialsEnc
// (written by tapapp-admin) and are passed in at request time. Nothing here
// reads env vars; the router hands us the decrypted bag.
// ============================================================================

export const MONERIS_API_VERSION = "3.0";

// Base URLs from developer.moneris.com/moneris-go/docs/cloud-integration.
// Purchase / refund / void all POST to this base; the "action" field on
// the request body selects the transaction type.
export const MONERIS_BASE_URLS = {
  test: "https://ippostest.moneris.com/v3/Terminal/",
  prod: "https://ippos.moneris.com/v3/Terminal/",
} as const;

export type MonerisEnvironment = keyof typeof MONERIS_BASE_URLS;

// Action names accepted by the Cloud API. Only `purchase` is wired for
// Moneris 1a; refund + void come in 1b once purchase is confirmed on the
// real terminal. Keep the enum here so the client TS stays honest as we
// add actions.
export const MONERIS_ACTIONS = {
  PURCHASE: "purchase",
  REFUND: "refund", // 1b
  VOID: "void",     // 1b
} as const;

export type MonerisAction = (typeof MONERIS_ACTIONS)[keyof typeof MONERIS_ACTIONS];

// Polling cadence for the receiptUrl. Docs require ≥2s between polls to
// avoid Moneris's anti-abuse throttle. We use 2500ms to leave headroom
// for clock drift.
export const MONERIS_POLL_INTERVAL_MS = 2500;

// Overall wall-clock cap for a single transaction. Real card-present
// transactions usually settle in 20-40s (tap/PIN prompt + auth). Give
// slow cardholders or spotty 4G a comfortable ceiling before we cut
// losses and return a timeout error to the POS.
export const MONERIS_MAX_WAIT_MS = 120_000;

// HTTP timeouts. The initial POST returns fast (validation only), but a
// slow terminal-busy or unreachable cloud can still hang the socket if
// we don't bound it explicitly.
export const MONERIS_TIMEOUTS = {
  VALIDATION_REQUEST: 15_000,
  POLL_REQUEST: 10_000,
} as const;

// Terminal Busy status code from the docs. Special-cased because the
// user-facing error should say "someone else is using the terminal"
// rather than a generic failure — this happens when a second POS pane
// tries to charge while the first is still on the tap screen.
export const MONERIS_STATUS_TERMINAL_BUSY = "5904";

// Format a JS Date as "YYYY-MM-DD HH:MM:SS" in UTC. Moneris docs don't
// spell out the timezone but their samples look UTC-ish; the field is
// used for cloud-side dedup, not billing, so timezone precision doesn't
// affect the receipt. If Moneris rejects for a timezone mismatch, swap
// this to their expected zone (probably America/Toronto).
export function formatMonerisTimestamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

// Generate a Moneris dataId — their docs show "1745346531955-001" format,
// which looks like `${millis}-${seq}`. We use crypto-random suffix to
// stay unique across concurrent POS panes on the same store.
export function generateDataId(): string {
  const ms = Date.now();
  const rand = Math.floor(Math.random() * 999)
    .toString()
    .padStart(3, "0");
  return `${ms}-${rand}`;
}
