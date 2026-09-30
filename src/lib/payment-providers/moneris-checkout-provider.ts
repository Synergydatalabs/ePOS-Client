// Moneris Checkout (MCO) — hosted card-not-present provider.
//
// Implements the shared PaymentProviderClient interface so getProvider("MONERIS")
// returns this instead of the mock. Unlike GP's hosted-page flow (single URL
// generated at PO creation and valid for the TTL), MCO uses short-lived
// per-ticket URLs — so we intentionally do NOT preload here. Instead:
//
//   1. createPaymentLink() returns /pay/po/{poId}?processor=MONERIS&ref=...
//      A stable, always-valid URL — merchant can share this via email or QR.
//   2. When the customer opens that URL, the page fires a preload against
//      /api/pay/po/{poId}/moneris/preload, gets a fresh ticket, and starts
//      the MCO widget. Tickets are minted per visit, so expiry is never
//      the reason a link stops working.
//
// Reference: the generated orderNo we'll send on the preload later. Stored
// on the PO row so the verify endpoint can match a completed transaction
// back to this PO with certainty.

import type {
  CreatePaymentLinkParams,
  CreatePaymentLinkResult,
  PaymentProviderClient,
} from "./index";
import type { PaymentProcessor } from "@prisma/client";

// 30 days — matches typical B2B payment terms. The MCO ticket itself is
// short-lived, but our /pay/po/[poId] page always mints a fresh one at
// visit time, so the link URL stays valid for the whole window.
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "";

export class MonerisCheckoutProvider implements PaymentProviderClient {
  readonly processor: PaymentProcessor = "MONERIS";

  async createPaymentLink(
    params: CreatePaymentLinkParams
  ): Promise<CreatePaymentLinkResult> {
    // Reference stored on the PO — used by the verify endpoint (and future
    // webhooks) to match a Moneris transaction back to this PO. Format is
    // stable-per-PO so a re-generated link keeps the same reference; the
    // shortened poId + timestamp is unique enough for Moneris's per-store
    // order_no uniqueness rule.
    const reference = `PO-${params.purchaseOrderId.slice(0, 8).toUpperCase()}-${Date.now()
      .toString()
      .slice(-6)}`;

    // URL is a stable page on our platform. The `processor` query param
    // tells /pay/po/[poId] to render the MCO widget instead of the mock
    // form. `ref` is echoed on the page for the customer + used as the
    // order_no when we preload MCO.
    const url = `${BASE_URL}/pay/po/${params.purchaseOrderId}?processor=MONERIS&ref=${encodeURIComponent(
      reference
    )}`;

    console.log(
      `[MCO-PROVIDER] Created MCO payment link for PO ${params.poNumber}: ref=${reference}, amount=${(
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
