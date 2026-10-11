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
//
// 2026-10-11: Optional B2B tax-exemption path. When the caller passes
// `business: {name, taxIdentifier}`, we route through the full three-call
// sequence (create/find customer → create business → create transaction
// with customer_id + business_id) so Paddle validates the tax ID and
// zero-rates the invoice when the number is recognised. Without it, we
// stay on the one-call inline-customer path.

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
  // 2026-10-11: optional B2B tax-exemption. When set, Paddle validates
  // the tax ID and zero-rates the invoice when it recognises the number
  // (confirmed working for Korean 사업자등록번호).
  business?: {
    name: string;
    taxIdentifier: string;
  };
}

export interface PaddleTransaction {
  id: string;
  checkoutUrl: string;
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "CLP", "ISK", "UGX", "RWF", "XOF", "XAF",
  "PYG", "DJF", "GNF", "KMF", "MGA", "BIF", "XPF",
]);

async function paddleFetch(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<any> {
  const config = getPaddleConfig();
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Paddle-Version": PADDLE_API_VERSION,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err =
      data?.error?.detail ||
      data?.error?.message ||
      data?.error?.code ||
      `Paddle API ${init.method} ${path} returned ${res.status}`;
    throw new Error(err);
  }
  return data;
}

/**
 * Find a Paddle customer by email, or create one if none exists.
 * Needed before we can attach a business entity to them.
 */
async function findOrCreateCustomer(email: string): Promise<string> {
  // Paddle supports email filter on /customers list.
  const existing = await paddleFetch(
    `/customers?email=${encodeURIComponent(email)}`,
    { method: "GET" }
  );
  const match = existing?.data?.[0];
  if (match?.id) return match.id;

  const created = await paddleFetch("/customers", {
    method: "POST",
    body: { email },
  });
  const id = created?.data?.id;
  if (!id) throw new Error("Paddle customer create: missing id in response");
  return id;
}

/**
 * Create a business entity under a Paddle customer, carrying the tax
 * identifier. Paddle validates the number — an invalid one silently
 * leaves tax applied, so the caller should check preview_transaction if
 * they need to know the tax outcome before charging.
 */
async function createBusiness(
  customerId: string,
  name: string,
  taxIdentifier: string
): Promise<string> {
  const created = await paddleFetch(
    `/customers/${customerId}/businesses`,
    {
      method: "POST",
      body: { name, tax_identifier: taxIdentifier },
    }
  );
  const id = created?.data?.id;
  if (!id) throw new Error("Paddle business create: missing id in response");
  return id;
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
  const upperCurrency = input.currency.toUpperCase();
  const paddleAmount = ZERO_DECIMAL_CURRENCIES.has(upperCurrency)
    ? Math.round(input.amountCents / 100)
    : Math.round(input.amountCents);

  // 2026-10-11: B2B tax-exemption branch. Resolve a customer id + business
  // id first, then reference them on the transaction. Non-B2B stays on
  // the inline-customer path.
  let customerId: string | null = null;
  let businessId: string | null = null;
  if (input.business && input.customerEmail) {
    customerId = await findOrCreateCustomer(input.customerEmail);
    businessId = await createBusiness(
      customerId,
      input.business.name,
      input.business.taxIdentifier
    );
  }

  // 2026-10-11: Tax mode switches when B2B.
  //
  // Paddle convention: `internal` = tax INCLUSIVE (price contains tax),
  // `external` = tax EXCLUSIVE (price is net, tax added on top).
  //
  // Our account default (account_setting) is inclusive — the price we
  // send is treated as "total containing VAT". When exemption applies,
  // Paddle extracts the would-be-VAT from the gross, so a ₩35,000
  // invoice becomes ₩31,818 for the business — not what we want.
  //
  // For B2B we switch to `external` (exclusive): price is net, tax is
  // added on top. The business is exempt so nothing is added — customer
  // pays exactly the amount we sent. Consumer flow stays on the account
  // default so their inclusive pricing is unchanged.
  const taxMode = input.business ? "external" : "account_setting";

  const body: Record<string, unknown> = {
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
          tax_mode: taxMode as "account_setting" | "internal" | "external",
        },
      },
    ],
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

  if (customerId) {
    body.customer_id = customerId;
    if (businessId) body.business_id = businessId;
  } else if (input.customerEmail) {
    body.customer = { email: input.customerEmail };
  }

  const data = await paddleFetch("/transactions", {
    method: "POST",
    body,
  });

  const txnId = data?.data?.id;
  const checkoutUrl = data?.data?.checkout?.url;
  if (!txnId || !checkoutUrl) {
    throw new Error("Paddle response missing transaction id or checkout URL");
  }

  return { id: txnId, checkoutUrl };
}
