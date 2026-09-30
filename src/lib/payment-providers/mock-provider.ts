// Mock payment provider — used until real processor integrations are wired.
//
// Generates a platform-hosted checkout URL of the form
//   ${NEXT_PUBLIC_BASE_URL}/pay/po/${purchaseOrderId}?ref=${reference}
// The public /pay/po/[poId] page (built in Round B) renders a mock
// checkout that the merchant can "pay" — that fake payment fires the
// same webhook path we'll use for real processors, so end-to-end flow
// works today without a real GP / Moneris account.
//
// When the real provider ships (see gp-provider.ts) swap the factory
// return in payment-providers/index.ts — nothing else changes.

import { randomBytes } from "crypto";
import type {
  CreatePaymentLinkParams,
  CreatePaymentLinkResult,
  PaymentProviderClient,
} from "./index";
import type { PaymentProcessor } from "@prisma/client";

// Same alphabet the PO-number generator uses (no look-alikes) so
// references stay copy-paste friendly if a human ever reads one aloud.
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — matches typical B2B payment terms

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "";

export class MockProvider implements PaymentProviderClient {
  readonly processor: PaymentProcessor;

  constructor(processor: PaymentProcessor) {
    this.processor = processor;
  }

  async createPaymentLink(
    params: CreatePaymentLinkParams
  ): Promise<CreatePaymentLinkResult> {
    // Reference is 12 chars — plenty of entropy that we can also print on
    // the mock checkout page for humans to eyeball.
    const bytes = randomBytes(12);
    let reference = `MOCK-`;
    for (let i = 0; i < 12; i++) {
      reference += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
    }

    const expiresAt = new Date(Date.now() + LINK_TTL_MS);

    // Small latency simulation — helps catch UX regressions where the
    // caller assumes link creation is instantaneous. Removed once real
    // providers replace this class.
    await new Promise((r) => setTimeout(r, 25));

    // The mock hosted checkout lives on the platform itself. Reference is
    // in the URL both as a query param (for the page to display) and
    // baked into what the mock page returns as "processor confirmation".
    const url = `${BASE_URL}/pay/po/${params.purchaseOrderId}?ref=${encodeURIComponent(reference)}`;

    console.log(
      `[MOCK-PAY] Created ${this.processor} link for PO ${params.poNumber}: ref=${reference}, amount=${(params.amountCents / 100).toFixed(2)} ${params.currency}`
    );

    return { url, reference, expiresAt };
  }
}
