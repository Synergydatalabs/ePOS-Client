// =============================================================================
// Stripe → acquirer-side payment reference extractor
//
// 2026-10-08: Compliance / client-reconciliation flows (notably UPI payments
// out of India) want the acquirer-side transaction reference, not just our
// Stripe PaymentIntent id. For UPI, Stripe stores the NPCI/acquirer RRN on
// charges.data[].payment_method_details.upi.reference. Other methods may add
// their own equivalents over time; this helper centralises the extraction
// so every webhook branch produces the same shape of data.
//
// Returns null when nothing is extractable — never throws, since the caller
// must not fail the webhook just because a reference couldn't be pulled.
// =============================================================================

import Stripe from "stripe";
import type { StripeCredentials } from "./types";
import { buildStripeClient } from "./client";

export interface ExtractedProviderReference {
  // Acquirer-side transaction reference (UPI RRN for UPI, future methods'
  // equivalents). Null when none available.
  reference: string | null;
  // Buyer's VPA for UPI payments. Null for other payment methods.
  vpa: string | null;
  // Our best guess at the method name for `paid_method` ("stripe_upi",
  // "stripe_card", etc.) — tightens the generic "STRIPE" value we used
  // to write before.
  paidMethod: string | null;
}

/**
 * Walk a Stripe PaymentIntent / Charge / Session object and pull out any
 * UPI-level references + VPA. Works on the inline-expanded `charges.data[0]`
 * found on `payment_intent.*` events in older API versions, and on the
 * direct `payment_method_details` on `charge.*` events.
 *
 * Pure synchronous — no network. Pair with fetchChargeForReference() below
 * when `latest_charge` is only a string id (newer Stripe API versions).
 */
export function extractProviderReferenceFromObject(
  obj: unknown
): ExtractedProviderReference {
  const empty: ExtractedProviderReference = {
    reference: null,
    vpa: null,
    paidMethod: null,
  };
  if (!obj || typeof obj !== "object") return empty;

  const anyObj = obj as Record<string, unknown>;

  // Pattern A: charge event — payment_method_details is top-level.
  const topDetails = anyObj.payment_method_details as
    | Record<string, unknown>
    | undefined;
  if (topDetails) {
    return pickFromDetails(topDetails);
  }

  // Pattern B: payment_intent event with legacy `charges.data[0]` inline.
  const charges = anyObj.charges as
    | { data?: Array<Record<string, unknown>> }
    | undefined;
  const firstCharge = charges?.data?.[0];
  if (firstCharge?.payment_method_details) {
    return pickFromDetails(
      firstCharge.payment_method_details as Record<string, unknown>
    );
  }

  return empty;
}

function pickFromDetails(
  details: Record<string, unknown>
): ExtractedProviderReference {
  // UPI — the one we care about for the compliance request we're
  // responding to. Add more branches here (ideal, boleto, etc) as other
  // acquirer references become reconciliation-relevant.
  const upi = details.upi as
    | { vpa?: string; reference?: string; rrn?: string }
    | undefined;
  if (upi && typeof upi === "object") {
    return {
      reference:
        (typeof upi.reference === "string" && upi.reference) ||
        (typeof upi.rrn === "string" && upi.rrn) ||
        null,
      vpa: typeof upi.vpa === "string" ? upi.vpa : null,
      paidMethod: "stripe_upi",
    };
  }

  const card = details.card as { brand?: string; last4?: string } | undefined;
  if (card) {
    return {
      reference: null,
      vpa: null,
      paidMethod: card.brand ? `stripe_card_${card.brand}` : "stripe_card",
    };
  }

  // Any other method — just stamp its type so paid_method ends up more
  // informative than the previous generic "STRIPE".
  const type =
    typeof details.type === "string"
      ? details.type
      : Object.keys(details)[0] || null;
  return {
    reference: null,
    vpa: null,
    paidMethod: type ? `stripe_${type}` : null,
  };
}

/**
 * When the webhook payload only carries `latest_charge` as a string
 * (newer Stripe API versions do this), fetch the Charge object via the
 * supplier's Stripe account to extract the reference. Returns the empty
 * shape on any API failure — never throws, since this is best-effort
 * enrichment, not required for the webhook to succeed.
 */
export async function fetchChargeForReference(
  creds: StripeCredentials,
  chargeId: string
): Promise<ExtractedProviderReference> {
  const empty: ExtractedProviderReference = {
    reference: null,
    vpa: null,
    paidMethod: null,
  };
  if (!chargeId || typeof chargeId !== "string") return empty;
  try {
    const stripe = buildStripeClient(creds);
    const charge = (await stripe.charges.retrieve(
      chargeId
    )) as unknown as Stripe.Charge;
    return extractProviderReferenceFromObject(charge);
  } catch (err) {
    console.warn(
      `[STRIPE] fetchChargeForReference(${chargeId}) failed:`,
      (err as Error).message
    );
    return empty;
  }
}
