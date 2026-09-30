// ============================================================================
// Moneris Checkout (MCO) — HTTP client.
//
// Two calls:
//   • createPreload — server-to-server; returns a `ticket` the frontend
//     passes into monerisCheckout.startCheckout(ticket) to open the
//     hosted checkout page.
//   • fetchReceipt — server-to-server; called after the Payment Complete
//     JS callback to verify the outcome and get card + auth details.
//
// Both actions POST to the same URL. Which side of the flow it is is
// selected by the `action` field on the body.
// ============================================================================

import {
  MCO_ACTIONS,
  MCO_ENDPOINTS,
  MCO_REQUEST_TIMEOUT_MS,
  formatMcoAmount,
  type McoCredentials,
} from "./constants";
import {
  McoApiError,
  type McoCart,
  type McoContact,
  type McoAddress,
  type McoPreloadResponse,
  type McoReceiptResponse,
  type McoRequest,
} from "./types";

export interface CreatePreloadInput {
  credentials: McoCredentials;
  /** Total in cents — we convert to dollars-string for the wire. */
  amountCents: number;
  /**
   * Our internal order handle. Echoed back on the receipt so we can
   * reconcile MCO tickets to tap-app records without an extra lookup.
   */
  orderNo: string;
  /** Optional customer identifier (email, membership id, etc.). */
  customerId?: string;
  /** Statement descriptor appended to the merchant's business name. */
  dynamicDescriptor?: string;
  /** Cart contents — displayed on the checkout page for context. */
  cart?: McoCart;
  contact?: McoContact;
  shipping?: McoAddress;
  billing?: McoAddress;
  language?: "en" | "fr";
}

export interface CreatePreloadResult {
  ticket: string;
  environment: McoCredentials["environment"];
  /** JavaScript URL the frontend loads for the checkout widget. */
  scriptUrl: string;
  raw: McoPreloadResponse;
}

// The frontend needs to load the RIGHT chkt_v1.00.js file for the
// environment the preload was minted in. Test tickets don't work with
// the prod script and vice-versa — this helper keeps them paired.
const MCO_SCRIPTS = {
  qa: "https://gatewayt.moneris.com/chkt/js/chkt_v1.00.js",
  prod: "https://gateway.moneris.com/chkt/js/chkt_v1.00.js",
} as const;

export async function createPreload(
  input: CreatePreloadInput
): Promise<CreatePreloadResult> {
  const body: McoRequest = {
    store_id: input.credentials.store_id,
    api_token: input.credentials.api_token,
    checkout_id: input.credentials.checkout_id,
    environment: input.credentials.environment,
    action: MCO_ACTIONS.PRELOAD,
    txn_total: formatMcoAmount(input.amountCents),
    order_no: input.orderNo,
    cust_id: input.customerId,
    dynamic_descriptor: input.dynamicDescriptor,
    language: input.language,
    cart: input.cart,
    contact_details: input.contact,
    shipping_details: input.shipping,
    billing_details: input.billing,
  };

  const parsed = (await postJson(input.credentials.environment, body)) as McoPreloadResponse;
  const ok = isSuccess(parsed.response?.success);
  if (!ok || !parsed.response?.ticket) {
    throw new McoApiError(errorMessage(parsed.response?.error) || "Preload failed", parsed);
  }

  return {
    ticket: parsed.response.ticket,
    environment: input.credentials.environment,
    scriptUrl: MCO_SCRIPTS[input.credentials.environment],
    raw: parsed,
  };
}

export interface FetchReceiptInput {
  credentials: McoCredentials;
  ticket: string;
}

export interface FetchReceiptResult {
  approved: boolean;
  declined: boolean;
  /** Present on approval — hand to the POS receipt printer. */
  approvalCode?: string;
  cardType?: string;
  panMasked?: string;
  amountCents?: number;
  orderNo?: string;
  transactionNo?: string;
  responseCode?: string;
  message: string;
  raw: McoReceiptResponse;
}

export async function fetchReceipt(input: FetchReceiptInput): Promise<FetchReceiptResult> {
  const body: McoRequest = {
    store_id: input.credentials.store_id,
    api_token: input.credentials.api_token,
    checkout_id: input.credentials.checkout_id,
    environment: input.credentials.environment,
    action: MCO_ACTIONS.RECEIPT,
    ticket: input.ticket,
  };

  const parsed = (await postJson(input.credentials.environment, body)) as McoReceiptResponse;
  const ok = isSuccess(parsed.response?.success);
  if (!ok) {
    throw new McoApiError("Receipt lookup failed", parsed);
  }

  const receipt = parsed.response?.receipt;
  const cc = receipt?.cc;
  // MCO uses "a" for approved, "d" for declined. Anything else = treat as
  // declined (also covers the rare case where the receipt object is
  // missing entirely — never approve on missing data).
  const result = String(receipt?.result || "").toLowerCase();
  const approved = result === "a";
  const declined = !approved;

  const amountFromCc = cc?.amount ? Math.round(parseFloat(cc.amount) * 100) : undefined;

  return {
    approved,
    declined,
    approvalCode: cc?.approval_code,
    cardType: cc?.card_type,
    panMasked: cc?.first6last4,
    amountCents: Number.isFinite(amountFromCc) ? amountFromCc : undefined,
    orderNo: cc?.order_no,
    transactionNo: cc?.transaction_no,
    responseCode: cc?.response_code,
    message: approved ? "Approved" : `Declined (response_code=${cc?.response_code || "?"})`,
    raw: parsed,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function postJson(
  environment: McoCredentials["environment"],
  body: unknown
): Promise<unknown> {
  const res = await fetch(MCO_ENDPOINTS[environment], {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MCO_REQUEST_TIMEOUT_MS),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new McoApiError(`Moneris Checkout HTTP ${res.status}`, parsed);
  }
  return parsed;
}

// Moneris returns success as a QUOTED string in some payloads
// ("\"true\"") and as bare "true"/true in others. Normalize.
function isSuccess(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const trimmed = raw.replace(/^["']+|["']+$/g, "").toLowerCase();
    return trimmed === "true";
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const parts: string[] = [];
  for (const [field, meta] of Object.entries(err as Record<string, { data?: string }>)) {
    const data = meta?.data ? String(meta.data).replace(/^["']+|["']+$/g, "") : "";
    parts.push(data ? `${field}: ${data}` : field);
  }
  return parts.join("; ");
}
