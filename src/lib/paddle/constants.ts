// Paddle (Model A — one shared Paddle account for all tenants).
//
// All credentials live in env vars rather than per-tenant encrypted
// rows. This keeps the integration simple while we decide whether
// per-tenant Paddle accounts are worth building (Model B).
//
// Required env to turn the feature ON:
//   PADDLE_API_KEY         — Bearer token (dashboard → Dev tools → Authentication)
//   PADDLE_PRODUCT_ID      — a generic Paddle product we reuse for every ad-hoc transaction
//   PADDLE_WEBHOOK_SECRET  — signing secret for /api/webhooks/paddle
// Optional:
//   PADDLE_ENV             — "sandbox" (default) or "production"
//
// When PADDLE_API_KEY is missing, the Paddle button on the pay page
// is hidden and `/paddle-start` returns a clear 503. Nothing else
// breaks.

export const PADDLE_API_VERSION = "1";

export interface PaddleConfig {
  apiKey: string;
  productId: string;
  webhookSecret: string;
  env: "sandbox" | "production";
  apiBaseUrl: string;
  isConfigured: boolean;
}

export function getPaddleConfig(): PaddleConfig {
  const env =
    (process.env.PADDLE_ENV || "sandbox").toLowerCase() === "production"
      ? "production"
      : "sandbox";
  const apiBaseUrl =
    env === "production"
      ? "https://api.paddle.com"
      : "https://sandbox-api.paddle.com";

  const apiKey = process.env.PADDLE_API_KEY || "";
  const productId = process.env.PADDLE_PRODUCT_ID || "";
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET || "";

  return {
    apiKey,
    productId,
    webhookSecret,
    env,
    apiBaseUrl,
    // "Fully set up and safe to call" — missing any of these means the
    // caller should degrade gracefully (hide button, 503 the endpoint).
    isConfigured: !!apiKey && !!productId && !!webhookSecret,
  };
}
