// Paddle Billing API wrapper — just the one call we need.
//
// createTransaction mints a Paddle transaction with an ad-hoc price so
// we can bill arbitrary amounts (not tied to Paddle's pre-created
// catalog). Returns the hosted checkout URL to redirect the customer
// to; after they pay, Paddle redirects them to `successUrl` and fires
// a `transaction.completed` webhook back to us.
//
// We stash our invoice id under `custom_data` so the webhook can
// reconcile the completion event back to the right row.

import { getPaddleConfig, PADDLE_API_VERSION } from "./constants";

export interface CreatePaddleTransactionInput {
  invoiceId: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  description: string;
  // The URL Paddle will append `_ptxn=<txn_id>` to and bounce the customer
  // to. In our flow this is /paddle-checkout, which loads Paddle.js and
  // opens the overlay. successUrl inside Paddle.js's Initialize config
  // then handles the post-payment redirect to /pay/invoice/<id>?paid=1.
  checkoutPageUrl: string;
}

export interface PaddleTransaction {
  id: string;
  checkoutUrl: string;
}

export async function createPaddleTransaction(
  input: CreatePaddleTransactionInput
): Promise<PaddleTransaction> {
  const config = getPaddleConfig();
  if (!config.isConfigured) {
    throw new Error("Paddle is not configured on this environment");
  }

  // Zero-decimal currencies — Paddle (and ISO 4217) treats these as
  // having no fractional unit. Our DB stores every amount × 100 for
  // consistency, so for these currencies we divide back out before
  // passing to Paddle, otherwise Paddle sees 100× the real amount
  // (e.g. a ₩3,000 invoice becomes ₩300,000 on checkout).
  const ZERO_DECIMAL_CURRENCIES = new Set([
    "JPY", "KRW", "VND", "CLP", "ISK", "UGX", "RWF", "XOF", "XAF",
    "PYG", "DJF", "GNF", "KMF", "MGA", "BIF", "XPF",
  ]);
  const upperCurrency = input.currency.toUpperCase();
  const paddleAmount = ZERO_DECIMAL_CURRENCIES.has(upperCurrency)
    ? Math.round(input.amountCents / 100)
    : Math.round(input.amountCents);

  const body = {
    items: [
      {
        quantity: 1,
        price: {
          description: input.description.slice(0, 200),
          product_id: config.productId,
          unit_price: {
            // Paddle amount is a string in the smallest currency unit.
            amount: String(paddleAmount),
            currency_code: upperCurrency,
          },
          billing_cycle: null, // one-time charge, not a subscription
          trial_period: null,
          tax_mode: "account_setting" as const,
        },
      },
    ],
    customer: input.customerEmail ? { email: input.customerEmail } : undefined,
    collection_mode: "automatic" as const,
    // Round-trip our invoice id so the webhook can find the row.
    custom_data: {
      hub_invoice_id: input.invoiceId,
      hub_type: "supplier_invoice",
    },
    checkout: {
      // Paddle appends `?_ptxn=<txn_id>` to this URL and returns the result
      // as data.checkout.url. We redirect the customer there; the
      // /paddle-checkout page then loads Paddle.js and opens the overlay.
      url: input.checkoutPageUrl,
    },
  };

  const response = await fetch(`${config.apiBaseUrl}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Paddle-Version": PADDLE_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err =
      data?.error?.detail ||
      data?.error?.message ||
      data?.error?.code ||
      `Paddle API returned ${response.status}`;
    throw new Error(err);
  }

  const txnId = data?.data?.id;
  const checkoutUrl = data?.data?.checkout?.url;
  if (!txnId || !checkoutUrl) {
    throw new Error("Paddle response missing transaction id or checkout URL");
  }

  return { id: txnId, checkoutUrl };
}
