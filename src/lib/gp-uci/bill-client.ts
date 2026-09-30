// ============================================
// Global Payments UCI — device command client
//
// All UCI operations use POST /ucp/device_commands with an action_type
// in the body. The terminal acknowledges synchronously; the actual outcome
// arrives asynchronously via webhook (status_url).
//
// Reference: https://developer.globalpayments.com/docs/payments/in-store/cloud
// ============================================

import {
  getUciConfig,
  UCI_ACTIONS,
  getUciGpVersion,
  UCI_TIMEOUTS,
  type UciCredentialOverride,
} from "./constants";
import { getUciAccessToken } from "./token";
import {
  UciApiError,
  type UciBillRequest,
  type UciBillResponse,
} from "./types";

// ---------- Shared HTTP helper ----------

interface DeviceCommandResponse {
  id?: string;                  // DVC_xxxx — UCI Device Command ID
  device_reference?: string;    // echo of the lane
  action_type?: string;
  status?: string;              // INITIATED, COMPLETED, FAILED, etc.
  action?: {
    id?: string;
    type?: string;
    time_created?: string;
    result_code?: string;
    app_id?: string;
    app_name?: string;
  };
  transaction?: any[];          // populated on TRANSACTION_LIST etc.
  error_code?: string;
  // 2026-05-27: GP sometimes returns detailed_error_description as a
  // nested object (e.g. { field, message }) rather than a string.
  // Type as `unknown` and JSON.stringify in the logger.
  detailed_error_description?: unknown;
  detailed_error_code?: string;
  error_message?: string;
}

async function postDeviceCommand(
  body: Record<string, unknown>,
  credentials?: UciCredentialOverride
): Promise<DeviceCommandResponse> {
  const config = getUciConfig(credentials);
  const token = await getUciAccessToken(credentials);

  const gpVersion = getUciGpVersion();
  const response = await fetch(config.deviceCommandsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-GP-Version": gpVersion,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UCI_TIMEOUTS.COMMAND),
  });

  const data = (await response.json().catch(() => ({}))) as DeviceCommandResponse;

  if (!response.ok) {
    console.error("[UCI] device_commands error", {
      status: response.status,
      url: config.deviceCommandsUrl,
      gpVersion,
      requestBody: body,
      responseBody: data,
    });
    // Build a verbose message so the inline UI surface tells the user
    // exactly what GP rejected (helps debugging without grepping pm2 logs).
    //
    // 2026-05-27 fix: GP sometimes returns detailed_error_description as a
    // nested object (e.g. { field, message }) rather than a string. The old
    // `data.X || "..."` truthy-check would let an object through to String()
    // which produced the literal "[object Object]". JSON-stringify objects
    // so we can actually read what GP said.
    const stringifyErr = (val: unknown): string => {
      if (val == null) return "";
      if (typeof val === "string") return val;
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    };
    const errText =
      stringifyErr(data.detailed_error_description) ||
      stringifyErr(data.error_message) ||
      "Device command failed";

    const verbose = [
      errText,
      data.error_code && `[error_code=${data.error_code}]`,
      data.detailed_error_code && `[detailed=${data.detailed_error_code}]`,
      `[http=${response.status}]`,
    ]
      .filter(Boolean)
      .join(" ");
    throw new UciApiError(
      response.status,
      String(data.error_code || "UNKNOWN"),
      verbose
    );
  }

  return data;
}

/**
 * GP wants amounts as INTEGER cents (verified for CREATE_ORDER + AUTHORIZE
 * via their internal Postman collection). Strings/decimals get rejected by
 * the validator. Use this for every transaction.amount in the device commands.
 */
function toIntCents(cents: number | undefined | null): number {
  const n = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return Math.max(0, Math.round(n));
}

/** Wrap a request body with the standard notifications + account context */
function withContext(
  body: Record<string, unknown>,
  credentials?: UciCredentialOverride
): Record<string, unknown> {
  const config = getUciConfig(credentials);
  const wrapped: Record<string, unknown> = { ...body };
  if (!wrapped.notifications && config.defaultWebhookUrl) {
    wrapped.notifications = { status_url: config.defaultWebhookUrl };
  }
  if (config.accountName && !wrapped.account_name) {
    wrapped.account_name = config.accountName;
  }
  return wrapped;
}

/** Map UCI status string → our internal bill status */
function mapStatus(uciStatus: string | undefined): UciBillResponse["status"] {
  const s = (uciStatus || "").toUpperCase();
  if (s === "INITIATED" || s === "PENDING") return "SENT";
  if (s === "DELIVERED") return "DELIVERED";
  if (s === "COMPLETED" || s === "PAID" || s === "SUCCESS") return "PAID";
  if (s === "CANCELLED" || s === "DELETED") return "CANCELLED";
  if (s === "FAILED" || s === "DECLINED") return "FAILED";
  if (s === "EXPIRED" || s === "TIMEOUT") return "EXPIRED";
  return "SENT";
}

// ============================================================
// Public API
// ============================================================

/**
 * Push an order/bill to a terminal (e.g. a restaurant check).
 * → action_type: CREATE_ORDER
 *
 * The terminal displays the bill until the customer pays or it's deleted.
 * Same `order.reference` within a day REPLACES the previous bill.
 */
export async function createBill(
  params: UciBillRequest,
  credentials?: UciCredentialOverride
): Promise<UciBillResponse> {
  if (!params.lane) throw new UciApiError(400, "MISSING_LANE", "lane (device_reference) is required");

  // ==================================================================
  // 2026-05-27 — FINAL working schema (after ~8 iterations + GP Postman)
  //
  // GP CERT validator wants:
  //   • All amounts as INTEGERS (cents), NOT strings, NOT decimals
  //   • `total_amount` at the SEAT level is what their validator calls
  //     "SeatAmountDue" — their public doc said `amount_due` but that's
  //     wrong / outdated. Their Postman collection is the ground truth.
  //   • At the seat level, `amount: 0` (literally zero — the seat's
  //     "running total still owed" starts at the full amount, but as
  //     partial payments come in this drops. Initial state = 0 owed
  //     reduction = full amount due.)
  //   • `reference` ≤ 10 chars (= GP's CheckNumber field)
  //   • `description` ≤ 10 chars (= GP's TableNumber field)
  //
  // Reference field-name mappings revealed by GP's error responses:
  //   • our `reference`          → GP's `CheckNumber`
  //   • our `description`        → GP's `TableNumber`
  //   • our `items`              → GP's `Seats`
  //   • our `items_breakdown`    → GP's `Items` (required, non-empty)
  //   • our `total_amount` (seat) → GP's `SeatAmountDue`
  //
  // Discarded from our earlier (wrong) hypothesis:
  //   ❌ `currency` at order level — not in Postman, GP rejects it
  //   ❌ `system: { name, mid }`  — not required, Postman omits
  //   ❌ `notifications`           — not in Postman body (we add via
  //      withContext only because the webhook is useful for status)
  //   ❌ String amounts           — Postman uses integers
  //   ❌ `amount_due` seat field  — non-existent in current API
  // ==================================================================

  // Caller passes cents. GP wants cents-as-int. No conversion needed
  // beyond clamping to safe int.
  const toInt = (cents: number | undefined | null): number => {
    const n = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
    return Math.max(0, Math.round(n));
  };
  // Discount is the only field that can be negative in GP's schema (a
  // discount REDUCES the total). Other amount fields are clamped >= 0.
  const toIntSigned = (cents: number | undefined | null): number => {
    const n = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
    return Math.round(n);
  };

  // Build per-seat items. Each "line" in our LineItem corresponds to a
  // seat (per-seat grouping is handled by .seat); a seat's items_breakdown
  // collects all dishes/drinks for that seat.
  // For simple use cases (no per-seat split) everything goes to seat #1.
  const seatMap = new Map<number, typeof params.lineItems>();
  for (const li of params.lineItems || []) {
    const seat = li.seat ?? 1;
    if (!seatMap.has(seat)) seatMap.set(seat, []);
    seatMap.get(seat)!.push(li);
  }

  // If caller passed no line items, synthesize a single catch-all line
  // so the request is well-formed (Items field is required, non-empty).
  if (seatMap.size === 0) {
    seatMap.set(1, [
      {
        name: params.metadata?.tableLabel || `Order ${params.orderNumber}`,
        quantity: 1,
        unitPrice: params.amount,
        lineTotal: params.amount,
        seat: 1,
      },
    ]);
  }

  const items = Array.from(seatMap.entries()).map(([seatNum, lis]) => {
    const seatSubtotal = lis.reduce((sum, li) => sum + toInt(li.lineTotal), 0);
    return {
      line_number: seatNum,
      items_breakdown: lis.map((li) => ({
        description: li.name.slice(0, 50), // GP truncates long descriptions; trim to be safe
        quantity: li.quantity,
        amount: toInt(li.unitPrice),
      })),
      subtotal_amount: seatSubtotal,
      discount_amount: 0,
      tax_amount: 0,
      tax2_amount: 0,
      tax3_amount: 0,
      surcharge_amount: 0,
      // total_amount at seat level = the SeatAmountDue. Critical: this is
      // what GP's validator actually reads, NOT amount_due (which is what
      // their docs claim — but those docs are stale).
      total_amount: seatSubtotal,
      // amount at seat level is literally 0 per the working Postman sample.
      amount: 0,
    };
  });

  // reference and description are length-constrained by GP (≤10 chars,
  // else 40090 "must be 10 characters or fewer").
  //
  // 2026-05-28 CRITICAL FIX: use the TAIL of the order number, not the head.
  // Order numbers like "ORD-20260527-0002" share a common date prefix, so
  // slice(0,10) produced "ORD-202605" for EVERY order that day. GP's rule is
  // "same check_number same day = REPLACE the bill" — so all orders collided
  // on one reference, and the repeated replace against an in-flight/queued
  // bill triggered 502 SYSTEM_ERROR_DOWNSTREAM. The tail preserves the unique
  // sequence portion (e.g. "0527-0002") so each order gets a distinct check.
  const reference =
    params.orderNumber.length <= 10
      ? params.orderNumber
      : params.orderNumber.slice(-10);
  const description = (params.metadata?.tableLabel || `Order`).slice(0, 10);

  const body = withContext(
    {
      device_reference: params.lane,
      action_type: UCI_ACTIONS.CREATE_ORDER,
      order: {
        reference,
        time_created_reference: new Date().toISOString(),
        description,
        user_reference: (params.metadata?.staffName || "POS").slice(0, 20),
        subtotal_amount: toInt(params.subtotal),
        discount_amount: toIntSigned(params.discountAmount ?? 0),
        tax_amount: toInt(params.taxAmount),
        tax2_amount: toInt(params.tax2Amount ?? 0),
        tax3_amount: 0,
        surcharge_amount: 0,
        total_amount: toInt(params.amount),
        amount: toInt(params.amount),
        items,
      },
    },
    credentials
  );

  const data = await postDeviceCommand(body, credentials);

  return {
    gpBillId: data.id || "",
    status: mapStatus(data.status),
    rawResponse: data,
  };
}

/**
 * Cancel a bill that hasn't been paid yet.
 * → action_type: DELETE_ORDER
 *
 * 2026-05-29 VERIFIED against live CERT: pass the DVC_Id as `id` (GP maps it
 * to its internal `qprTransactionId`) plus `device_reference`. Returns
 * HTTP 200 / resource_status COMPLETED on success.
 *
 * Note: GP returns HTTP 500 "This bill cannot be deleted as it is already
 * paid" if the bill was already settled — we surface that as a clear error.
 */
export async function cancelBill(
  gpBillId: string,
  lane: string
): Promise<UciBillResponse> {
  if (!gpBillId) throw new UciApiError(400, "MISSING_ID", "gpBillId (DVC_Id) is required for cancel");
  if (!lane) throw new UciApiError(400, "MISSING_LANE", "lane (device_reference) is required for cancel");

  const body = withContext({
    id: gpBillId,
    device_reference: lane,
    action_type: UCI_ACTIONS.DELETE_ORDER,
  });

  const data = await postDeviceCommand(body);

  return {
    gpBillId: data.id || gpBillId,
    status: "CANCELLED",
    rawResponse: data,
  };
}

/**
 * Cancel a specific bill on a specific terminal.
 * Alias for cancelBill — kept for backwards compatibility with callers that
 * previously passed (lane, orderReference). Now takes (lane, gpBillId) where
 * gpBillId is the DVC_Id from the original CREATE_ORDER response.
 *
 * If you only have the order reference (check number), call PENDING_TRANSACTION_LIST
 * first to map reference → DVC_Id, then call this.
 */
export async function deleteOrder(
  lane: string,
  gpBillId: string
): Promise<UciBillResponse> {
  return cancelBill(gpBillId, lane);
}

/**
 * Fetch the status (and full transaction details) for a previous DVC_Id.
 * → action_type: TRANSACTION_LIST
 */
export async function getBillStatus(
  gpBillId: string,
  lane?: string
): Promise<UciBillResponse> {
  const body = withContext({
    id: gpBillId,
    ...(lane && { device_reference: lane }),
    action_type: UCI_ACTIONS.TRANSACTION_LIST,
  });

  const data = await postDeviceCommand(body);

  // The transaction array tells us the actual payment outcome
  const txn = Array.isArray(data.transaction) ? data.transaction[0] : null;
  const isPaid = !!txn && (data.status === "COMPLETED" || data.status === "PAID");

  return {
    gpBillId: data.id || gpBillId,
    status: isPaid ? "PAID" : mapStatus(data.status),
    rawResponse: data,
  };
}

/**
 * Refund a previous transaction directly on the terminal.
 * Caller should pass the original TRN_Id (from a prior TRANSACTION_LIST result).
 * → action_type: REFUND
 */
export async function refundBill(
  lane: string,
  amount?: number,
  originalTransactionId?: string
): Promise<UciBillResponse> {
  // Cert-validated shape (2026-07-27): id + amount both inside a single
  // `transaction` object, matching the shape REVERSE uses. Same rail-side
  // interpretation as before: id alone = full linked refund; id + amount =
  // partial linked refund; amount alone = unreferenced/standalone refund.
  const body = withContext({
    device_reference: lane,
    action_type: UCI_ACTIONS.REFUND,
    transaction: {
      ...(originalTransactionId && { id: originalTransactionId }),
      ...(amount !== undefined && { amount: toIntCents(amount) }),
    },
  });

  const data = await postDeviceCommand(body);
  return {
    gpBillId: data.id || "",
    status: mapStatus(data.status),
    rawResponse: data,
  };
}

/**
 * Send a quick PING to verify a terminal is reachable / online.
 * → action_type: PING
 */
export async function pingTerminal(lane: string): Promise<DeviceCommandResponse> {
  return postDeviceCommand(
    withContext({
      device_reference: lane,
      action_type: UCI_ACTIONS.PING,
    })
  );
}

/**
 * Initiate an instant card sale on the terminal (no bill, retail use case).
 * The customer taps the card on the terminal; result flows back via webhook.
 * → action_type: AUTHORIZE
 */
export async function chargeOnTerminal(
  lane: string,
  amount: number,
  options?: {
    gratuity?: number;
    reference?: string;
    currency?: string;
    /** Phase 2d: per-tenant GP credentials from the payment router. */
    credentials?: UciCredentialOverride;
  }
): Promise<UciBillResponse> {
  // 2026-05-27 FINAL: GP wants integer cents for amounts (verified via
  // their internal Postman collection). Strings and decimals get rejected
  // by the validator.
  const toInt = (cents: number): number =>
    Math.max(0, Math.round(Number.isFinite(cents) ? cents : 0));

  const credentials = options?.credentials;
  const body = withContext(
    {
      device_reference: lane,
      action_type: UCI_ACTIONS.AUTHORIZE,
      transaction: {
        amount: toInt(amount),
        currency: options?.currency || "CAD",
        ...(options?.gratuity !== undefined && {
          gratuity_amount: toInt(options.gratuity),
        }),
      },
      ...(options?.reference && { reference: options.reference.slice(0, 10) }),
    },
    credentials
  );

  const data = await postDeviceCommand(body, credentials);
  return {
    gpBillId: data.id || "",
    status: mapStatus(data.status),
    rawResponse: data,
  };
}

/**
 * List all currently-pending (unpaid) orders on a terminal.
 * → action_type: PENDING_TRANSACTION_LIST
 */
export async function listPendingOrders(lane: string) {
  return postDeviceCommand(
    withContext({
      device_reference: lane,
      action_type: UCI_ACTIONS.PENDING_TRANSACTION_LIST,
    })
  );
}

// ============================================================
// GP UCI Certification actions (2026-05-29)
//
// The GP UCI Test Script requires these secondary/instant operations on top
// of the basic sale. They follow the SAME device_commands envelope as
// AUTHORIZE: integer-cents amounts inside a `transaction` object, plus a
// `reference_transaction: { id }` when the operation chains off a prior
// transaction (the TRN_Id returned by the original AUTHORIZE/PREAUTHORIZE,
// available via the webhook or TRANSACTION_LIST).
//
// IMPORTANT: GP's public docs proved unreliable for CREATE_ORDER, so each of
// these shapes should be confirmed against live CERT with the PowerShell test
// rig before relying on it for production. The shapes below match the
// AUTHORIZE/REFUND format we already proved works.
// ============================================================

/**
 * Pre-authorize (reserve) funds on a card WITHOUT capturing them.
 * Used for the cert "Pre-Authorization" / tab/bar use case. The customer
 * taps; the amount is held but not settled until a CAPTURE.
 * → action_type: PREAUTHORIZE
 */
export async function preAuthorize(
  lane: string,
  amount: number,
  options?: {
    gratuity?: number;
    reference?: string;
    currency?: string;
  }
): Promise<UciBillResponse> {
  const body = withContext({
    device_reference: lane,
    action_type: UCI_ACTIONS.PREAUTHORIZE,
    transaction: {
      amount: toIntCents(amount),
      currency: options?.currency || "CAD",
      ...(options?.gratuity !== undefined && {
        gratuity_amount: toIntCents(options.gratuity),
      }),
    },
    ...(options?.reference && { reference: options.reference.slice(0, 10) }),
  });

  const data = await postDeviceCommand(body);
  return {
    gpBillId: data.id || "",
    status: mapStatus(data.status),
    rawResponse: data,
  };
}

/**
 * Capture (settle) a previously pre-authorized transaction.
 * Pass the original TRN_Id from the PREAUTHORIZE. Omit `amount` to capture
 * the full pre-auth, or pass a (smaller) amount for a partial capture.
 * Optionally include a gratuity to add on at capture time.
 * → action_type: CAPTURE
 */
export async function captureTransaction(
  lane: string,
  originalTransactionId: string,
  options?: {
    amount?: number;
    gratuity?: number;
  }
): Promise<UciBillResponse> {
  if (!originalTransactionId)
    throw new UciApiError(400, "MISSING_TRN", "originalTransactionId (TRN_Id) is required for CAPTURE");

  const hasTxnFields =
    options?.amount !== undefined || options?.gratuity !== undefined;

  const body = withContext({
    device_reference: lane,
    action_type: UCI_ACTIONS.CAPTURE,
    reference_transaction: { id: originalTransactionId },
    ...(hasTxnFields && {
      transaction: {
        ...(options?.amount !== undefined && { amount: toIntCents(options.amount) }),
        ...(options?.gratuity !== undefined && {
          gratuity_amount: toIntCents(options.gratuity),
        }),
      },
    }),
  });

  const data = await postDeviceCommand(body);
  return {
    gpBillId: data.id || "",
    status: mapStatus(data.status),
    rawResponse: data,
  };
}

/**
 * Increase the amount of an existing pre-authorization (e.g. an open bar tab
 * that grows). Pass the original PREAUTHORIZE TRN_Id and the ADDITIONAL amount
 * to add (GP increments by this delta on top of the existing hold).
 * → action_type: INCREMENT
 */
export async function incrementAuth(
  lane: string,
  originalTransactionId: string,
  amount: number
): Promise<UciBillResponse> {
  if (!originalTransactionId)
    throw new UciApiError(400, "MISSING_TRN", "originalTransactionId (TRN_Id) is required for INCREMENT");

  const body = withContext({
    device_reference: lane,
    action_type: UCI_ACTIONS.INCREMENT,
    reference_transaction: { id: originalTransactionId },
    transaction: { amount: toIntCents(amount) },
  });

  const data = await postDeviceCommand(body);
  return {
    gpBillId: data.id || "",
    status: mapStatus(data.status),
    rawResponse: data,
  };
}

/**
 * Adjust a completed transaction — typically a TIP/gratuity adjustment after
 * the card has left (restaurant flow: authorize the bill, then add the tip
 * the customer wrote on the slip). Pass the original TRN_Id plus the new
 * gratuity and/or the new total amount.
 * → action_type: ADJUST
 */
export async function adjustTransaction(
  lane: string,
  originalTransactionId: string,
  options: {
    gratuity?: number;
    amount?: number;
  }
): Promise<UciBillResponse> {
  if (!originalTransactionId)
    throw new UciApiError(400, "MISSING_TRN", "originalTransactionId (TRN_Id) is required for ADJUST");
  if (options.gratuity === undefined && options.amount === undefined)
    throw new UciApiError(400, "MISSING_AMOUNT", "ADJUST requires a gratuity and/or amount");

  const body = withContext({
    device_reference: lane,
    action_type: UCI_ACTIONS.ADJUST,
    reference_transaction: { id: originalTransactionId },
    transaction: {
      ...(options.amount !== undefined && { amount: toIntCents(options.amount) }),
      ...(options.gratuity !== undefined && {
        gratuity_amount: toIntCents(options.gratuity),
      }),
    },
  });

  const data = await postDeviceCommand(body);
  return {
    gpBillId: data.id || "",
    status: mapStatus(data.status),
    rawResponse: data,
  };
}

/**
 * Reverse (void) a sale/AUTHORIZE before the batch is settled. This fully
 * cancels the transaction so it never hits the customer's statement (unlike a
 * REFUND, which is a separate settled credit). Pass the original TRN_Id.
 * Omit `amount` for a full reversal; pass an amount for a partial reversal
 * where GP supports it.
 * → action_type: REVERSE
 */
export async function reverseTransaction(
  lane: string,
  originalTransactionId: string,
  amount?: number
): Promise<UciBillResponse> {
  if (!originalTransactionId)
    throw new UciApiError(400, "MISSING_TRN", "originalTransactionId (TRN_Id) is required for REVERSE");

  const body = withContext({
    device_reference: lane,
    action_type: UCI_ACTIONS.REVERSE,
    transaction: {
      id: originalTransactionId,
      ...(amount !== undefined && { amount: toIntCents(amount) }),
    },
  });

  const data = await postDeviceCommand(body);
  return {
    gpBillId: data.id || "",
    status: "CANCELLED",
    rawResponse: data,
  };
}

/**
 * Reverse (release) a PRE-AUTHORIZATION hold without ever capturing it — e.g.
 * a customer closes their tab and pays by other means, so the hold is freed.
 * Pass the original PREAUTHORIZE TRN_Id.
 * → action_type: REVERSE_AUTH
 */
export async function reverseAuth(
  lane: string,
  originalTransactionId: string
): Promise<UciBillResponse> {
  if (!originalTransactionId)
    throw new UciApiError(400, "MISSING_TRN", "originalTransactionId (TRN_Id) is required for REVERSE_AUTH");

  const body = withContext({
    device_reference: lane,
    action_type: UCI_ACTIONS.REVERSE_AUTH,
    transaction: { id: originalTransactionId },
  });

  const data = await postDeviceCommand(body);
  return {
    gpBillId: data.id || "",
    status: "CANCELLED",
    rawResponse: data,
  };
}

/**
 * Account verification — confirms a card is valid WITHOUT charging it. GP runs
 * a $0.00 (or $0.01 auto-voided) authorization plus AVS/CVV checks. Used for
 * the cert "Verify" use case and for saving a card on file.
 * → action_type: VERIFY
 */
export async function verifyAccount(
  lane: string,
  options?: {
    reference?: string;
    currency?: string;
  }
): Promise<UciBillResponse> {
  const body = withContext({
    device_reference: lane,
    action_type: UCI_ACTIONS.VERIFY,
    transaction: {
      amount: 0,
      currency: options?.currency || "CAD",
    },
    ...(options?.reference && { reference: options.reference.slice(0, 10) }),
  });

  const data = await postDeviceCommand(body);
  return {
    gpBillId: data.id || "",
    status: mapStatus(data.status),
    rawResponse: data,
  };
}

/**
 * Close the current batch — settles all captured transactions for the day so
 * funds move to the merchant account. Required by the cert "Batch" use case.
 * Run at end-of-day (or on demand from the admin terminals screen).
 * → action_type: BATCH_CLOSE
 */
export async function batchClose(lane: string): Promise<DeviceCommandResponse> {
  return postDeviceCommand(
    withContext({
      device_reference: lane,
      action_type: UCI_ACTIONS.BATCH_CLOSE,
    })
  );
}

/**
 * Fetch the LAST transaction processed on a terminal — useful for recovery
 * when a webhook is missed or the POS lost connection mid-sale (reconcile what
 * actually happened on the device).
 * → action_type: LAST_TRANSACTION
 */
export async function getLastTransaction(lane: string): Promise<DeviceCommandResponse> {
  return postDeviceCommand(
    withContext({
      device_reference: lane,
      action_type: UCI_ACTIONS.LAST_TRANSACTION,
    })
  );
}
