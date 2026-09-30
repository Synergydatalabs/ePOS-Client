// ============================================================================
// Moneris Checkout (MCO) — request/response types.
// Modeled from Moneris's public MCO docs. Optional fields are typed
// permissively so a schema tweak on Moneris's side doesn't force a client
// bump — we assert only on what we actually branch on.
// ============================================================================

import type { McoAction, McoEnvironment } from "./constants";

/** Line item in the preload cart. Purely informational — MCO shows it
 *  to the customer on the checkout page for cart context. */
export interface McoCartItem {
  description: string;
  product_code?: string;
  /** Dollars as string, e.g. "100.00". */
  unit_cost: string;
  /** Quantity as string, e.g. "1". */
  quantity: string;
  url?: string;
}

export interface McoCart {
  items?: McoCartItem[];
  /** Dollars as string. */
  subtotal?: string;
  tax?: {
    /** Dollars as string. */
    amount: string;
    description?: string;
    /** Percentage, e.g. "13.00" for 13%. */
    rate?: string;
  };
}

export interface McoContact {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export interface McoAddress {
  address_1?: string;
  address_2?: string;
  city?: string;
  province?: string;
  country?: string;
  postal_code?: string;
}

/** Envelope posted to Moneris for both preload and receipt actions. */
export interface McoRequest {
  store_id: string;
  api_token: string;
  checkout_id: string;
  environment: McoEnvironment;
  action: McoAction;
  /** Preload only — total in dollars as string ("452.00"). */
  txn_total?: string;
  order_no?: string;
  cust_id?: string;
  dynamic_descriptor?: string;
  language?: "en" | "fr";
  cart?: McoCart;
  contact_details?: McoContact;
  shipping_details?: McoAddress;
  billing_details?: McoAddress;
  /** Receipt only — ticket returned by the preload response. */
  ticket?: string;
}

/** Response to a preload request. */
export interface McoPreloadResponse {
  response: {
    /** Note: Moneris literally returns "\"true\"" / "\"false\"" (quoted strings). */
    success: string;
    /** Present when success is truthy. */
    ticket?: string;
    /** Present when success is false — nested per-field error map. */
    error?: Record<string, { data?: string }>;
  };
}

/** Response to a receipt request — full transaction detail. */
export interface McoReceiptResponse {
  response: {
    success: string;
    /** Echoed request context — what the customer entered on the checkout page. */
    request?: {
      txn_total?: string;
      order_no?: string | null;
      cust_id?: string;
      dynamic_descriptor?: string;
      ticket?: string;
      cc_total?: string;
      cc?: {
        first6last4?: string;
        expiry?: string;
        cardholder?: string;
      };
      gift?: Array<{
        first4last4?: string;
        balance_remaining?: string;
        balance_used?: string;
      }>;
      cust_info?: McoContact;
      shipping?: McoAddress;
      billing?: McoAddress;
    };
    /** Payment outcome. `result: "a"` = approved, `"d"` = declined. */
    receipt?: {
      /** "a" = approved, "d" = declined. */
      result?: string;
      cc?: {
        order_no?: string;
        transaction_no?: string;
        reference_no?: string;
        transaction_code?: string;
        transaction_type?: string;
        transaction_date_time?: string;
        amount?: string;
        response_code?: string;
        iso_response_code?: string;
        approval_code?: string;
        card_type?: string;
        first6last4?: string;
        avs_result_code?: string;
        cvd_result_code?: string;
      };
      gift?: Array<{
        transaction_no?: string;
        reference_no?: string;
        benefit_amount?: string;
        benefit_remaining?: string;
        response_code?: string;
      }>;
    };
  };
}

export class McoApiError extends Error {
  constructor(
    message: string,
    public readonly raw: unknown
  ) {
    super(message);
    this.name = "McoApiError";
  }
}
