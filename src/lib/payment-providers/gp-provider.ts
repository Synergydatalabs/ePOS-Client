// Global Payments (GP) provider — hosted-checkout payment link.
//
// STATUS: STUB. This file exists so the interface + factory are in place,
// but real GP API calls are commented out — we default to MockProvider
// (see payment-providers/index.ts) until:
//   1. GP's business team confirms which product to use for referred
//      merchants (Hosted Payment Page? Drop-in? Hosted Fields with a
//      redirect?)
//   2. A real supplier is approved with real credentials on the platform,
//      so we have something to actually call against
//
// Once ready, uncomment the real fetch call below and update the factory
// in payment-providers/index.ts to return `new GpProvider()` for GP.

import type {
  CreatePaymentLinkParams,
  CreatePaymentLinkResult,
  PaymentProviderClient,
} from "./index";
import type { PaymentProcessor } from "@prisma/client";

// GP has two environments — CERT for testing, PROD for live. Chosen per
// call based on the credentials' shape (or an explicit env flag). Left
// as constants here so the file is self-contained.
const GP_API_BASE = {
  CERT: "https://apis-cert.globalpay.com",
  PROD: "https://apis.globalpay.com",
} as const;

const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface GpCredentials {
  app_id: string;
  app_key: string;
  account_name?: string;
  environment?: "CERT" | "PROD";
}

export class GpProvider implements PaymentProviderClient {
  readonly processor: PaymentProcessor = "GP";

  async createPaymentLink(
    params: CreatePaymentLinkParams
  ): Promise<CreatePaymentLinkResult> {
    const creds = params.credentials as unknown as GpCredentials;
    if (!creds?.app_id || !creds?.app_key) {
      throw new Error(
        "GP credentials missing app_id or app_key. Check the TenantPaymentProvider row."
      );
    }
    const env = creds.environment || "CERT";
    // Base URL kept for the real call below when it's uncommented.
    void GP_API_BASE[env];

    // -----------------------------------------------------------------
    // TODO: swap this for the real GP Hosted Payment Page call.
    //
    // Rough shape (to be confirmed with GP business team):
    //   1. POST {GP_API_BASE[env]}/ucp/accesstoken to get bearer token
    //      Body: { app_id, app_key, grant_type: "client_credentials", … }
    //   2. POST {GP_API_BASE[env]}/ucp/transactions with:
    //        {
    //          amount, currency,
    //          account_name: creds.account_name,
    //          merchant_id: params.externalMid,   // supplier's MID
    //          payment_method: { entry_mode: "ECOM", ... },
    //          notifications: { return_url: params.returnUrl, status_url: params.webhookUrl },
    //          reference: params.purchaseOrderId,
    //        }
    //   3. Response includes a hosted checkout URL + transaction id
    //
    // Until then, throw so the caller falls back to the mock. Since the
    // factory routes GP to MockProvider today, this branch never runs in
    // production — kept as a landing place for the real integration.
    // -----------------------------------------------------------------

    throw new Error(
      "GpProvider.createPaymentLink() not implemented yet — factory routes GP to MockProvider until GP integration ships. See src/lib/payment-providers/gp-provider.ts for the TODO."
    );

    // Placeholder so the file compiles cleanly — unreachable while the
    // throw above is in place. Left as a shape reference for the real
    // implementation.
    // eslint-disable-next-line no-unreachable
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    return { url: "", reference: "", expiresAt };
  }
}
