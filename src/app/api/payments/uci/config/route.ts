// GET /api/payments/uci/config
// Diagnostic — returns the URLs / version the deployed UCI module is using
// AND attempts a real token exchange against GP so we can see what's
// actually being sent vs what GP responds.

import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  getUciConfig,
  getUciGpVersion,
  UCI_GP_VERSION_DEFAULT,
} from "@/lib/gp-uci";

export async function GET() {
  const config = getUciConfig();

  return NextResponse.json({
    deployed_at: new Date().toISOString(),
    env: config.env,
    isProduction: config.isProduction,
    urls: {
      base: config.baseUrl,
      token: config.tokenUrl,
      deviceCommands: config.deviceCommandsUrl,
    },
    gpVersion: {
      effective: getUciGpVersion(),
      default: UCI_GP_VERSION_DEFAULT,
      envOverride: process.env.GLOBALPAY_UCI_GP_VERSION || null,
    },
    credentials: {
      appIdPresent: !!config.appId,
      appIdFirst8: config.appId ? config.appId.slice(0, 8) : null,
      appIdLast8: config.appId ? `...${config.appId.slice(-8)}` : null,
      appIdLength: config.appId.length,                      // expect 48
      appIdRawLength: (process.env.GLOBALPAY_UCI_APP_ID || "").length,
      appKeyPresent: !!config.appKey,
      appKeyFirst4: config.appKey ? config.appKey.slice(0, 4) : null,
      appKeyLast4: config.appKey ? `...${config.appKey.slice(-4)}` : null,
      appKeyLength: config.appKey.length,                    // expect 64
      appKeyRawLength: (process.env.GLOBALPAY_UCI_APP_KEY || "").length,
      // SHA-256 hash of the App Key — non-reversible but lets us compare
      // server-side value against your curl test without leaking the key
      appKeySha256First16: config.appKey
        ? crypto.createHash("sha256").update(config.appKey, "utf8").digest("hex").slice(0, 16)
        : null,
      accountName: config.accountName || "(not set)",
      webhookSecretPresent: !!config.webhookSecret,
    },
    selfTest: await runTokenSelfTest(config),
    webhook: {
      defaultUrl: config.defaultWebhookUrl,
    },
    envOverrides: {
      GLOBALPAY_UCI_BASE_URL: process.env.GLOBALPAY_UCI_BASE_URL || "(not set)",
      GLOBALPAY_UCI_TOKEN_URL: process.env.GLOBALPAY_UCI_TOKEN_URL || "(not set)",
      GLOBALPAY_UCI_GP_VERSION: process.env.GLOBALPAY_UCI_GP_VERSION || "(not set)",
      GLOBALPAY_UCI_ACCOUNT_NAME: process.env.GLOBALPAY_UCI_ACCOUNT_NAME || "(not set)",
      GLOBALPAY_UCI_ENV: process.env.GLOBALPAY_UCI_ENV || "(not set)",
    },
  });
}

/**
 * Performs a real token exchange against GP and returns full diagnostics.
 * Helps identify exactly what the deployed backend is sending vs receiving.
 */
async function runTokenSelfTest(config: ReturnType<typeof getUciConfig>) {
  if (!config.appId || !config.appKey) {
    return { ok: false, skipped: "appId or appKey missing" };
  }

  const nonce = crypto.randomBytes(8).toString("hex");
  const secret = crypto.createHash("sha512").update(nonce + config.appKey, "utf8").digest("hex");

  // What we WILL send (sanitised — no full secret)
  const sentSummary = {
    url: config.tokenUrl,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GP-Version": "2021-03-22",
      "Accept": "application/json",
    },
    bodyShape: {
      app_id: config.appId,            // safe to show — known
      nonce,                           // unique per call
      secret_first16: secret.slice(0, 16),  // SHA-512 hex prefix only
      secret_length: secret.length,    // expect 128 (SHA-512 hex)
      grant_type: "client_credentials",
    },
  };

  try {
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
    });

    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {/* keep raw text */}

    return {
      ok: response.ok,
      httpStatus: response.status,
      sent: sentSummary,
      gpResponse: parsed,
      hint: response.ok
        ? "✅ Token exchange succeeded — credentials are valid for this URL"
        : "❌ GP rejected the credentials. Compare appKeySha256First16 (above) with what your working curl test would produce.",
    };
  } catch (err: any) {
    return {
      ok: false,
      sent: sentSummary,
      error: err?.message || String(err),
      hint: "Network/timeout error — could not reach GP from server",
    };
  }
}
