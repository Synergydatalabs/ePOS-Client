// ============================================================================
// Helcim client — thin wrapper over the Helcim v2 REST API.
//
// 2026-10-09: covers what we actually call today:
//   - initializeCheckout(): mints a HelcimPay.js session token
//   - verifyWebhookSignature(): HMAC-SHA256 check on inbound webhooks
//   - testApiToken(): hits a safe endpoint to confirm the token works
// ============================================================================

import { createHmac, timingSafeEqual } from "crypto";
import { HELCIM_API_BASE } from "./constants";
import type {
  HelcimCredentials,
  HelcimPayInitializeResponse,
} from "./types";

interface InitializeCheckoutInput {
  apiToken: string;
  amount: number; // in dollars (Helcim expects decimal, not cents)
  currency: string; // "CAD" / "USD"
  invoiceNumber?: string;
  customerCode?: string;
  paymentType?: "purchase" | "preauth" | "verify";
}

/**
 * POST /helcim-pay/initialize — mint a checkout session.
 * Returns { checkoutToken, secretToken }. The browser uses checkoutToken
 * to open the modal; secretToken stays server-side (used later to confirm
 * the transaction).
 */
export async function initializeHelcimCheckout(
  input: InitializeCheckoutInput
): Promise<HelcimPayInitializeResponse> {
  const body = {
    paymentType: input.paymentType || "purchase",
    amount: Number(input.amount.toFixed(2)),
    currency: input.currency.toUpperCase(),
    ...(input.invoiceNumber ? { invoiceNumber: input.invoiceNumber } : {}),
    ...(input.customerCode ? { customerCode: input.customerCode } : {}),
  };

  const res = await fetch(`${HELCIM_API_BASE}/helcim-pay/initialize`, {
    method: "POST",
    headers: {
      "api-token": input.apiToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Helcim initialize failed (${res.status}): ${text || res.statusText}`
    );
  }

  const data = (await res.json()) as HelcimPayInitializeResponse;
  if (!data.checkoutToken || !data.secretToken) {
    throw new Error("Helcim initialize response missing tokens");
  }
  return data;
}

/**
 * Verify a Helcim webhook's HMAC signature.
 *
 * Helcim sends two headers:
 *   - `webhook-signature`: hex HMAC-SHA256 of the raw body
 *   - `webhook-timestamp`: unix seconds (optional but recommended to use)
 *
 * We verify the signature only; timestamp drift checking can be added
 * later if we see replay issues.
 */
export function verifyHelcimWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookVerifier: string
): boolean {
  if (!signatureHeader || !webhookVerifier) return false;
  const expected = createHmac("sha256", webhookVerifier)
    .update(rawBody, "utf8")
    .digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signatureHeader.trim(), "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Quick sanity-check that the API token is accepted by Helcim.
 *
 * 2026-10-09: Helcim v2 has no dedicated "whoami" endpoint. We try two
 * safe read-only endpoints and treat any non-401 response as "token is
 * valid" (401 is the only unambiguous auth failure signal; a 403 means
 * the token is valid but lacks permission on that endpoint, a 404 means
 * our path guess was wrong, and 2xx is obviously good).
 */
export async function testHelcimApiToken(
  apiToken: string
): Promise<{ ok: boolean; account?: string; error?: string }> {
  const probePaths = ["/customers?limit=1", "/payment-plans?limit=1"];
  let lastStatus: number | null = null;
  let lastText = "";
  for (const path of probePaths) {
    try {
      const res = await fetch(`${HELCIM_API_BASE}${path}`, {
        method: "GET",
        headers: {
          "api-token": apiToken,
          Accept: "application/json",
        },
      });
      lastStatus = res.status;
      lastText = await res.text().catch(() => "");
      if (res.status === 401) {
        return {
          ok: false,
          error: "Helcim rejected the token (401 Unauthorized). Check that the token is active and has Transaction Processing enabled.",
        };
      }
      // Any 2xx or a 403 (token valid, lacks permission on this endpoint)
      // tells us the token itself is good.
      if (res.ok || res.status === 403) {
        return { ok: true };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || "Network error contacting Helcim" };
    }
  }
  return {
    ok: false,
    error: `Helcim probe inconclusive (last status ${lastStatus}). ${lastText || "No response body."}`.slice(0, 400),
  };
}

/**
 * Credential-source helper — load the active Helcim credentials for a
 * tenant, decrypting the stored blob. Returns null if the tenant has
 * no Helcim provider row.
 */
export async function loadHelcimCredentials(
  tenantId: string
): Promise<HelcimCredentials | null> {
  // Lazy import to keep the browser bundle thin (this file is server-only).
  const { default: prisma } = await import("@/lib/prisma");
  const { kybDecryptJson } = await import("@/lib/kyb-crypto");

  const row = await prisma.tenantPaymentProvider.findFirst({
    where: {
      tenantId,
      processor: "HELCIM",
      capability: "CARD",
      status: "ACTIVE",
    },
    select: { credentialsEnc: true },
  });
  if (!row) return null;
  return kybDecryptJson<HelcimCredentials>(row.credentialsEnc);
}
