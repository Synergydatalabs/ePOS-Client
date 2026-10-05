// Global Payments (GP) Drop-In provider — hosted ECOMMERCE payment link.
//
// Same pattern as MonerisCheckoutProvider: createPaymentLink returns a
// stable URL to our own /pay/po/[poId]?processor=GP&ref=… page. That page
// mounts the GP Drop-In widget (card + Apple/Google Pay) using the GP-API
// credentials from env vars (GP_DROPIN_APP_ID / APP_KEY) — the actual
// access-token minting + transaction call happens at visit time, not here.
//
// Credentials from the TenantPaymentProvider row are checked but NOT
// forwarded to the pay page: the Drop-In lib reads GP_DROPIN_* env vars
// (which fall back to GLOBALPAY_UCI_* if DROPIN-specific aren't set). The
// TenantPaymentProvider row is still the gate — missing or SUSPENDED → the
// PO submit flow doesn't create a link in the first place.

import type {
  CreatePaymentLinkParams,
  CreatePaymentLinkResult,
  PaymentProviderClient,
} from "./index";
import type { PaymentProcessor } from "@prisma/client";

const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "";

interface GpCredentials {
  app_id?: string;
  app_key?: string;
  account_name?: string;
}

export class GpProvider implements PaymentProviderClient {
  readonly processor: PaymentProcessor = "GP";

  async createPaymentLink(
    params: CreatePaymentLinkParams
  ): Promise<CreatePaymentLinkResult> {
    // Credentials check is lenient: GP Drop-In pulls creds from env vars
    // at pay time, so an empty bag on the TenantPaymentProvider row is
    // acceptable. We only validate that the row EXISTS (the caller already
    // ensured ACTIVE status). externalMid is required — surfaces as the
    // merchant_id on each Drop-In charge.
    const creds = (params.credentials ?? {}) as GpCredentials;
    void creds; // reserved for future per-tenant override of env creds

    if (!params.externalMid) {
      throw new Error(
        "GP ECOMMERCE row is missing external_mid (MER_… / dev… / etc.). " +
          "Assign the provider again via the admin UI with the merchant id."
      );
    }

    // Stable per-PO reference. Matches the Moneris pattern so audit logs
    // read uniformly across processors.
    const reference = `PO-${params.purchaseOrderId.slice(0, 8).toUpperCase()}-${Date.now()
      .toString()
      .slice(-6)}`;

    const url = `${BASE_URL}/pay/po/${params.purchaseOrderId}?processor=GP&ref=${encodeURIComponent(
      reference
    )}`;

    console.log(
      `[GP-PROVIDER] Created GP Drop-In payment link for PO ${params.poNumber}: ref=${reference}, mid=${params.externalMid}, amount=${(
        params.amountCents / 100
      ).toFixed(2)} ${params.currency}`
    );

    return {
      url,
      reference,
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    };
  }
}
