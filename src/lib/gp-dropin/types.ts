// ============================================
// Drop-in UI — shared types
// ============================================

export interface DropinAccessToken {
  token: string;
  type: string;
  expiresAt: Date;
  scope: string;
}

/**
 * Wallet provider type for digital wallet payments.
 *
 * GP-API uses these exact strings in `payment_method.digital_wallet.provider`:
 *   - "APPLEPAY" — Apple Pay encrypted token (PKPaymentToken)
 *   - "PAY_BY_GOOGLE" — Google Pay encrypted token (PAYMENT_GATEWAY method)
 *
 * Omit/undefined for regular Drop-in card tokenization.
 */
export type DropinWalletType = "APPLEPAY" | "PAY_BY_GOOGLE";

export interface DropinSaleRequest {
  /**
   * For Drop-in card sales: the tokenized card reference returned by the
   *   browser Drop-in UI.
   * For wallet sales: the raw wallet payload as a JSON-encoded string
   *   (Apple PKPaymentToken or Google paymentMethodData.tokenizationData.token).
   *   When `walletType` is set, this is decoded and sent to GP under
   *   `payment_method.digital_wallet.payment_token`.
   */
  paymentReference: string;
  amount: number;           // cents
  currency?: string;        // default from env
  reference?: string;       // your order number for reconciliation
  country?: string;
  description?: string;
  metadata?: Record<string, string>;
  /** Digital wallet type. Omit for regular Drop-in card sales. */
  walletType?: DropinWalletType;
}

export interface DropinSaleResponse {
  success: boolean;
  transactionId?: string;
  status?: string;           // CAPTURED, DECLINED, PENDING, etc.
  responseCode?: string;     // SUCCESS, DECLINED, etc.
  responseMessage?: string;  // APPROVED, INSUFFICIENT_FUNDS, etc.
  authCode?: string;
  cardBrand?: string;
  cardLast4?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  raw?: Record<string, unknown>;
  error?: string;
}

export class DropinAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DropinAuthError";
  }
}

export class DropinApiError extends Error {
  constructor(public statusCode: number, public errorCode: string, message: string) {
    super(message);
    this.name = "DropinApiError";
  }
}
