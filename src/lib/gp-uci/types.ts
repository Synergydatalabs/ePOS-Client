// ============================================
// UCI — shared types
// ============================================

export type UciBillStatus =
  | "SENT"        // we POSTed to GP, awaiting delivery
  | "DELIVERED"   // terminal received it, showing to customer
  | "PAID"        // customer completed payment
  | "CANCELLED"   // cashier or customer cancelled
  | "FAILED"      // declined, timeout, etc.
  | "EXPIRED";    // no response in time

export interface UciBillLineItem {
  name: string;
  quantity: number;
  unitPrice: number;   // cents
  lineTotal: number;   // cents
  seat?: number;       // for split-by-seat
}

export interface UciBillRequest {
  lane: string;                    // target Lane/TID, e.g. "OREUGO01"
  orderNumber: string;             // our order_number for the receipt
  amount: number;                  // total, in cents
  currency: string;                // "CAD"
  lineItems: UciBillLineItem[];
  subtotal: number;
  taxAmount: number;
  tax2Amount?: number;
  discountAmount?: number;
  tipEnabled?: boolean;            // allow customer to add tip at terminal
  allowSplit?: boolean;            // enable "Split Payment" button
  allowCash?: boolean;             // enable "Pay with Cash" button
  metadata?: Record<string, string>;
}

export interface UciBillResponse {
  gpBillId: string;                // GP's ID for this bill
  status: UciBillStatus;
  rawResponse?: unknown;
}

export interface UciWebhookPayload {
  event: "bill.paid" | "bill.cancelled" | "bill.failed" | "bill.expired";
  gpBillId: string;
  lane: string;
  status: UciBillStatus;
  amount: number;
  tipAmount?: number;
  currency: string;
  transactionId?: string;
  authCode?: string;
  cardLast4?: string;
  cardBrand?: string;
  entryMode?: string;
  timestamp: string;
  // GP's payload shape TBD — this is our internal normalized shape
  raw?: Record<string, unknown>;
}

export interface UciAccessToken {
  token: string;
  type: string;       // "Bearer"
  expiresAt: Date;
  scope: string;
}

export class UciAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UciAuthError";
  }
}

export class UciApiError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string
  ) {
    super(message);
    this.name = "UciApiError";
  }
}

export class UciBillSpecPendingError extends Error {
  constructor(message = "Global Payments UCI Bill API spec is not yet implemented — awaiting official documentation from Global Payments.") {
    super(message);
    this.name = "UciBillSpecPendingError";
  }
}
