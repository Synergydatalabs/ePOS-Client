// ============================================
// Drop-in UI — Sale client
// POST /ucp/transactions with the paymentReference token
// that Drop-in returned from the browser.
// ============================================

import crypto from "crypto";
import {
  getDropinConfig,
  DROPIN_TIMEOUTS,
  GP_API_VERSION,
  DROPIN_DEFAULTS,
} from "./constants";
import { getDropinAccessToken } from "./token";
import {
  DropinApiError,
  type DropinSaleRequest,
  type DropinSaleResponse,
} from "./types";

/**
 * For Sale transactions we need a server-side token with default (broad) scopes,
 * NOT the narrow PMT_POST_Create_Single scope used for Drop-in tokenization.
 *
 * Pass an empty array → token.ts omits the `permissions` field entirely
 * → token inherits the App ID's full default scopes (TRN_POST_Capture, etc.)
 */
async function getSaleToken(): Promise<string> {
  const token = await getDropinAccessToken({
    permissions: [],
    secondsToExpire: 300,
  });
  return token.token;
}

/**
 * Process a Sale transaction using the paymentReference token
 * returned by the Drop-in UI in the browser.
 */
export async function processDropinSale(
  params: DropinSaleRequest
): Promise<DropinSaleResponse> {
  const config = getDropinConfig();

  if (!params.paymentReference) {
    return { success: false, error: "paymentReference is required" };
  }
  if (!params.amount || params.amount <= 0) {
    return { success: false, error: "amount must be greater than zero" };
  }

  const token = await getSaleToken();
  const currency = params.currency || config.currency || DROPIN_DEFAULTS.currency;
  const country = params.country || config.country || DROPIN_DEFAULTS.country;

  // Build payment_method based on whether this is a wallet (Apple/Google Pay)
  // or a regular Drop-in card token.
  //
  // - Wallet: GP expects the FULL encrypted wallet payload under
  //   payment_method.digital_wallet.payment_token (and `provider` set).
  //   The Apple/Google token is decoded back into a JSON object because GP
  //   wants the object structure, not a stringified version.
  // - Card: send the tokenized card reference as payment_method.id (default
  //   Drop-in flow).
  let paymentMethod: Record<string, unknown>;

  if (params.walletType) {
    let walletPayload: unknown;
    try {
      walletPayload =
        typeof params.paymentReference === "string"
          ? JSON.parse(params.paymentReference)
          : params.paymentReference;
    } catch {
      // If it's not JSON-parseable we send it as a raw token string — GP
      // will surface a clearer error than the generic "downstream" one.
      walletPayload = params.paymentReference;
    }

    paymentMethod = {
      entry_mode: "ECOM",
      digital_wallet: {
        provider: params.walletType, // "APPLEPAY" | "PAY_BY_GOOGLE"
        payment_token: walletPayload,
      },
    };
  } else {
    paymentMethod = {
      entry_mode: "ECOM",
      id: params.paymentReference,
    };
  }

  const gpBody: Record<string, unknown> = {
    channel: "CNP",               // card-not-present (online)
    capture_mode: "AUTO",         // auto-settle
    type: "SALE",
    amount: params.amount,        // cents
    currency,
    country,                      // merchant country code (e.g. "CA")
    reference: params.reference || `ORDER-${Date.now()}`,
    payment_method: paymentMethod,
  };

  if (config.accountId) gpBody.account_id = config.accountId;
  else if (config.accountName) gpBody.account_name = config.accountName;

  if (params.description) gpBody.description = params.description;

  const idempotency = crypto.randomBytes(16).toString("hex");

  const response = await fetch(config.transactionsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GP-Version": GP_API_VERSION,
      "X-GP-Idempotency": idempotency,
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(gpBody),
    signal: AbortSignal.timeout(DROPIN_TIMEOUTS.CHARGE),
  });

  const data = (await response.json().catch(() => ({}))) as any;

  if (!response.ok) {
    // Log the full request/response for diagnosis — these mismatches are
    // almost always wrong account_name, currency, or scope on the App ID.
    console.error("[DROPIN] /ucp/transactions error", {
      status: response.status,
      requestBody: gpBody,
      responseBody: data,
    });

    throw new DropinApiError(
      response.status,
      String(data.error_code || "UNKNOWN"),
      String(
        data.detailed_error_description ||
          data.error_message ||
          data.message ||
          "Charge failed"
      )
    );
  }

  const responseCode = String(data.response_code || "").toUpperCase();
  const status = String(data.status || "").toUpperCase();
  const approved = responseCode === "SUCCESS" || status === "CAPTURED" || status === "PREAUTHORIZED";

  return {
    success: approved,
    transactionId: data.id,
    status,
    responseCode,
    responseMessage: data.response_message,
    authCode: data.payment_method?.authcode || data.authorization_code,
    cardBrand: data.payment_method?.card?.brand,
    cardLast4: data.payment_method?.card?.masked_number_last4 || data.payment_method?.card?.last_4,
    amount: data.amount,
    currency: data.currency,
    reference: data.reference,
    raw: data,
    error: approved
      ? undefined
      : `${data.response_message || "Transaction declined"} (${responseCode})`,
  };
}
