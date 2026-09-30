// ============================================================================
// Moneris Go Cloud — request/response types.
// Modeled directly from the docs at developer.moneris.com/moneris-go/docs/
// cloud-integration. Unknown/optional fields are typed loosely (unknown
// or optional) so a schema update from Moneris doesn't force a client
// bump — we only assert on the fields we actually branch on.
// ============================================================================

import type { MonerisAction, MonerisEnvironment } from "./constants";

/** Decrypted credential bag from TenantPaymentProvider.credentialsEnc. */
export interface MonerisCredentials {
  store_id: string;
  api_token: string;
  terminal_id: string;
  ist_config_code?: string;
  environment?: MonerisEnvironment;
}

/** One request entry inside the `data.request[]` array. */
export interface MonerisRequestEntry {
  orderId: string;
  idempotencyKey: string;
  terminalId: string;
  action: MonerisAction;
  /** Amount in cents as a STRING per Moneris ("1110" = $11.10). */
  totalAmount: string;
  username?: string;
  modifier?: string;
  linkId?: string;
}

export interface MonerisRequestEnvelope {
  apiVersion: string;
  apiToken: string;
  storeId: string;
  istConfigCode: string;
  polling: "true" | "false";
  postBackUrl?: string;
  dataId: string;
  dataTimestamp: string;
  data: {
    request: MonerisRequestEntry[];
  };
}

/**
 * One response entry inside `receipt.data.response[]`. All fields
 * optional because Moneris omits keys situationally (an error response
 * won't have `cardType`, a validation response won't have `authCode`).
 */
export interface MonerisResponseEntry {
  idempotencyKey?: string;
  orderId?: string;
  cloudTicket?: string;
  /** "true" when the txn is done; "false" while the terminal is still processing. */
  completed?: "true" | "false";
  action?: string;
  statusCode?: string;
  status?: string;
  /** Fresh URL to poll for terminal txn status. Present on validation reply. */
  receiptUrl?: string;
  /** Moneris response code (short numeric). */
  responseCode?: string;
  /** Present on the final txn response — card + auth details. */
  authCode?: string;
  isoCode?: string;
  cardType?: string;
  cardHolderName?: string;
  paymentType?: string;
  panLast4?: string;
  amount?: string;
  timedOut?: "true" | "false";
  /** Per-field validation errors when statusCode indicates a 4xx. */
  errorDetails?: Array<{
    errorCode?: string;
    parameter?: string;
    value?: string;
    issue?: string;
  }>;
  /** Freeform passthrough for anything else we didn't model. */
  [key: string]: unknown;
}

/** Envelope wrapping every Moneris response — both validation and terminal. */
export interface MonerisResponseEnvelope {
  receipt: {
    apiVersion?: string;
    statusCode?: string;
    status?: string;
    dataId?: string;
    dataTimestamp?: string;
    data?: {
      response?: MonerisResponseEntry[];
    };
    TxnName?: string;
    CloudTicket?: string;
    Completed?: string;
    Error?: string;
  };
}

/**
 * The normalized result returned from chargeOnTerminal(). Shaped to be
 * consumable by the same POS front-end code that handles GP UCI responses —
 * approved/declined/error, plus the fields the receipt printer needs.
 * Callers should NOT reach into `raw` for happy-path logic; that's an
 * escape hatch for logging + admin debug tooling only.
 */
export interface MonerisChargeResult {
  approved: boolean;
  declined: boolean;
  /** True when we gave up polling before the terminal finished. */
  timedOut: boolean;
  /** Human-readable text derived from Moneris statusCode + status. */
  message: string;
  /** Moneris statusCode (2000 = success family; 4xxx = client error; 5xxx = terminal / cloud). */
  statusCode: string;
  /** Cloud-side dedup handle — store on Payment row for reconciliation. */
  cloudTicket?: string;
  /** Our own idempotency key — echoed back by Moneris. */
  idempotencyKey: string;
  /** Set on approval; empty on decline/error. */
  authCode?: string;
  cardType?: string;
  panLast4?: string;
  amountCents?: number;
  /** Everything Moneris sent back, minus nothing. Kept for audit logs. */
  raw: MonerisResponseEnvelope;
}

/**
 * Thrown by the Moneris client when the cloud rejects the request before
 * the terminal is even reached (bad creds, malformed body, etc.). These
 * are ADMIN problems, not cashier problems — the POS surface should
 * translate to "check provider credentials" rather than "retry".
 */
export class MonerisApiError extends Error {
  readonly statusCode: string;
  readonly errorDetails?: MonerisResponseEntry["errorDetails"];
  readonly raw: MonerisResponseEnvelope;
  constructor(message: string, statusCode: string, raw: MonerisResponseEnvelope) {
    super(message);
    this.name = "MonerisApiError";
    this.statusCode = statusCode;
    this.errorDetails = raw.receipt?.data?.response?.[0]?.errorDetails;
    this.raw = raw;
  }
}

/** Thrown when the terminal is currently processing another transaction. */
export class MonerisTerminalBusyError extends Error {
  constructor(public readonly raw: MonerisResponseEnvelope) {
    super("Terminal is currently processing another transaction");
    this.name = "MonerisTerminalBusyError";
  }
}
