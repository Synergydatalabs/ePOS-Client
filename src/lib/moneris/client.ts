// ============================================================================
// Moneris Go Cloud — HTTP client.
//
// Three entry points that all share the same two-phase pattern:
//   • chargeOnTerminal — action: "purchase"
//   • refundOnTerminal — action: "refund"  (linked by orderId to a prior purchase)
//   • voidOnTerminal   — action: "void"    (linked by orderId; same-day pre-settlement)
//
// All three funnel through submitTerminalAction(), which does the POST +
// polls the receiptUrl until the terminal finishes. Callers only differ in
// the action string and (for void) amount handling.
// ============================================================================

import crypto from "crypto";
import {
  MONERIS_ACTIONS,
  MONERIS_API_VERSION,
  MONERIS_BASE_URLS,
  MONERIS_MAX_WAIT_MS,
  MONERIS_POLL_INTERVAL_MS,
  MONERIS_STATUS_TERMINAL_BUSY,
  MONERIS_TIMEOUTS,
  formatMonerisTimestamp,
  generateDataId,
  type MonerisAction,
} from "./constants";
import {
  MonerisApiError,
  MonerisTerminalBusyError,
  type MonerisChargeResult,
  type MonerisCredentials,
  type MonerisRequestEnvelope,
  type MonerisResponseEnvelope,
} from "./types";

// ---------------------------------------------------------------------------
// Public API — thin wrappers over submitTerminalAction()
// ---------------------------------------------------------------------------

export interface ChargeOnTerminalInput {
  credentials: MonerisCredentials;
  /** POS-side order identifier (typically the tap-app Order.id). */
  orderId: string;
  /** Amount to charge in cents — will be serialized as a string. */
  amountCents: number;
  /** Optional cashier username for Moneris to record on the receipt. */
  username?: string;
}

/**
 * Charge a card-present transaction on the configured Moneris Go device.
 * Blocks up to MONERIS_MAX_WAIT_MS while the cardholder taps / inserts.
 */
export async function chargeOnTerminal(
  input: ChargeOnTerminalInput
): Promise<MonerisChargeResult> {
  return submitTerminalAction({
    credentials: input.credentials,
    action: MONERIS_ACTIONS.PURCHASE,
    orderId: input.orderId,
    amountCents: input.amountCents,
    username: input.username,
  });
}

export interface RefundOnTerminalInput {
  credentials: MonerisCredentials;
  /**
   * The ORIGINAL purchase's orderId — Moneris uses this to link the
   * refund back to the settled transaction on their side. Same value we
   * sent as orderId on the initial charge call.
   */
  originalOrderId: string;
  /** Refund amount in cents. Full refund = same as original; partial ≤ original. */
  amountCents: number;
  /** Optional cashier username. */
  username?: string;
}

/**
 * Refund a prior purchase on the terminal. Cardholder must be present —
 * Moneris (like every acquirer) requires the card be re-presented for
 * card-present refunds. Same two-phase flow as charge; blocks while the
 * customer taps.
 */
export async function refundOnTerminal(
  input: RefundOnTerminalInput
): Promise<MonerisChargeResult> {
  return submitTerminalAction({
    credentials: input.credentials,
    action: MONERIS_ACTIONS.REFUND,
    orderId: input.originalOrderId,
    amountCents: input.amountCents,
    username: input.username,
  });
}

export interface VoidOnTerminalInput {
  credentials: MonerisCredentials;
  /** Original purchase's orderId — same rules as refund. */
  originalOrderId: string;
  /** Optional cashier username. */
  username?: string;
}

/**
 * Void a same-day, pre-settlement purchase. Cheaper than a refund at
 * network fees, and the void doesn't leave a matched-pair on the
 * cardholder's statement. If the batch has already closed (Moneris
 * settles typically after 11pm ET), a void will fail — the caller
 * should fall back to refund in that case.
 *
 * Void doesn't require an amount — Moneris undoes the full original
 * transaction. We still send 0 in totalAmount because the field is
 * required by the schema; if Moneris rejects, adjust to omit or send
 * the original amount.
 */
export async function voidOnTerminal(
  input: VoidOnTerminalInput
): Promise<MonerisChargeResult> {
  return submitTerminalAction({
    credentials: input.credentials,
    action: MONERIS_ACTIONS.VOID,
    orderId: input.originalOrderId,
    amountCents: 0,
    username: input.username,
  });
}

// ---------------------------------------------------------------------------
// Shared submit — all three actions share the same wire flow.
// ---------------------------------------------------------------------------

interface SubmitTerminalActionInput {
  credentials: MonerisCredentials;
  action: MonerisAction;
  orderId: string;
  amountCents: number;
  username?: string;
}

async function submitTerminalAction(
  input: SubmitTerminalActionInput
): Promise<MonerisChargeResult> {
  const idempotencyKey = crypto.randomUUID();
  const dataId = generateDataId();
  const environment = input.credentials.environment ?? "test";
  const baseUrl = MONERIS_BASE_URLS[environment];

  const envelope: MonerisRequestEnvelope = {
    apiVersion: MONERIS_API_VERSION,
    apiToken: input.credentials.api_token,
    storeId: input.credentials.store_id,
    istConfigCode: input.credentials.ist_config_code ?? "",
    polling: "true",
    dataId,
    dataTimestamp: formatMonerisTimestamp(new Date()),
    data: {
      request: [
        {
          orderId: input.orderId,
          idempotencyKey,
          terminalId: input.credentials.terminal_id,
          action: input.action,
          totalAmount: String(input.amountCents),
          username: input.username,
        },
      ],
    },
  };

  // 1) Validation POST. Fast round-trip — Moneris echoes back the same
  //    envelope with a receiptUrl if the request was well-formed.
  const validation = await postToMoneris(baseUrl, envelope);
  const vEntry = validation.receipt?.data?.response?.[0];
  const vStatus = validation.receipt?.statusCode || vEntry?.statusCode;

  if (vEntry?.statusCode === MONERIS_STATUS_TERMINAL_BUSY) {
    throw new MonerisTerminalBusyError(validation);
  }
  if (!vEntry?.receiptUrl) {
    // No receiptUrl means the cloud rejected the request outright — bad
    // creds, bad ist_config_code, invalid amount, void of a settled txn,
    // etc. Bubble the error shape up so the admin sees Moneris's exact
    // complaint.
    throw new MonerisApiError(
      vEntry?.status || validation.receipt?.status || "Moneris rejected the request",
      vStatus || "unknown",
      validation
    );
  }

  // 2) Poll the receiptUrl until completed:"true" or we hit the wall clock.
  const terminalResponse = await pollReceipt(vEntry.receiptUrl);

  return normalizeChargeResult({
    envelope: terminalResponse,
    idempotencyKey,
    amountCents: input.amountCents,
  });
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function postToMoneris(
  baseUrl: string,
  body: MonerisRequestEnvelope
): Promise<MonerisResponseEnvelope> {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MONERIS_TIMEOUTS.VALIDATION_REQUEST),
  });

  const parsed = (await res.json().catch(() => ({}))) as MonerisResponseEnvelope;
  if (!res.ok) {
    // Even HTTP-level errors from Moneris come with a receipt payload we
    // want to preserve for the admin audit log. Attach whatever we parsed.
    throw new MonerisApiError(
      parsed?.receipt?.status || `Moneris HTTP ${res.status}`,
      parsed?.receipt?.statusCode || String(res.status),
      parsed
    );
  }
  return parsed;
}

async function pollReceipt(receiptUrl: string): Promise<MonerisResponseEnvelope> {
  const deadline = Date.now() + MONERIS_MAX_WAIT_MS;
  let lastParsed: MonerisResponseEnvelope | null = null;

  while (Date.now() < deadline) {
    // Sleep FIRST so the terminal has at least the polling interval to
    // start prompting before we hit its status endpoint.
    await sleep(MONERIS_POLL_INTERVAL_MS);

    const res = await fetch(receiptUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(MONERIS_TIMEOUTS.POLL_REQUEST),
    });
    const parsed = (await res.json().catch(() => ({}))) as MonerisResponseEnvelope;
    lastParsed = parsed;

    const entry = parsed?.receipt?.data?.response?.[0];
    if (entry?.completed === "true") {
      return parsed;
    }
    // Any 4xx/5xx from the poll endpoint that also lacks completed:true
    // means the txn is broken (not just still running) — propagate.
    if (!res.ok) {
      throw new MonerisApiError(
        entry?.status || parsed?.receipt?.status || `Moneris poll HTTP ${res.status}`,
        entry?.statusCode || parsed?.receipt?.statusCode || String(res.status),
        parsed
      );
    }
  }

  // Timed out. Return whatever the last poll gave us so the caller can
  // still surface the receipt (usually shows completed:"false" and any
  // partial state) and store it for reconciliation.
  return lastParsed ?? emptyEnvelope("Timed out waiting for terminal response");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyEnvelope(status: string): MonerisResponseEnvelope {
  return {
    receipt: {
      apiVersion: MONERIS_API_VERSION,
      statusCode: "timeout",
      status,
    },
  };
}

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

function normalizeChargeResult(args: {
  envelope: MonerisResponseEnvelope;
  idempotencyKey: string;
  amountCents: number;
}): MonerisChargeResult {
  const receipt = args.envelope.receipt ?? {};
  const entry = receipt.data?.response?.[0] ?? {};
  const statusCode = entry.statusCode || receipt.statusCode || "unknown";

  const completed = entry.completed === "true";
  const timedOut = statusCode === "timeout" || entry.timedOut === "true";

  // Approval detection: Moneris's "2001"-ish success codes vary by action;
  // safest signal is completed:true + presence of an authCode. Anything
  // else (declined, timeout, error) counts as not-approved.
  const approved = completed && !!entry.authCode && !timedOut;
  const declined = completed && !approved && !timedOut;

  const message =
    entry.status ||
    receipt.status ||
    (approved ? "Approved" : declined ? "Declined" : "Timed out");

  const amountFromResponse = entry.amount ? parseInt(entry.amount, 10) : NaN;

  return {
    approved,
    declined,
    timedOut,
    message,
    statusCode,
    cloudTicket: entry.cloudTicket,
    idempotencyKey: args.idempotencyKey,
    authCode: entry.authCode,
    cardType: entry.cardType,
    panLast4: entry.panLast4,
    amountCents: Number.isFinite(amountFromResponse) ? amountFromResponse : args.amountCents,
    raw: args.envelope,
  };
}
