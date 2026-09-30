// ============================================================================
// POST /api/public/v1/payments/charge — Phase I #11 (2026-09-19)
//
// Tokenized-forward Payments API. The partner's frontend uses Stripe.js
// to tokenize the card in the customer's browser (card → Stripe.com
// directly), then their backend forwards the resulting pm_… token
// through to us. We create + confirm a PaymentIntent server-side on
// the tenant's Stripe account and return the outcome synchronously.
//
// The customer never sees our domain — no iframe, no redirect. Their
// site fully controls the card-form UI (styled with their brand).
// hub.synergydatalabs.com only appears in server-to-server traffic
// between their backend and ours, invisible to the customer's browser.
//
// Request (Authorization: Bearer sk_...):
//   {
//     "amount": 1000,                              // cents (required)
//     "currency": "cad",                           // ISO 4217 (default CAD)
//     "payment_method_id": "pm_1NxYz...",          // token from Stripe.js
//     "customer": { "email": "buyer@example.com", "name": "Buyer" },
//     "description": "Order #42",
//     "return_url": "https://your-site.com/checkout/return",  // for 3DS redirects (optional)
//     "webhook_url":      "https://your-site.com/hooks/payment",
//     "webhook_secret":   "your-partner-secret",
//     "webhook_template": "{\"event\":\"{{event.type}}\",\"amount\":{{payment.amount}}}",
//     "webhook_events":   ["payment.succeeded", "payment.failed"],
//     "metadata":         { "order_id": "42" }
//   }
//
// Response 200 (SUCCESS — the common case):
//   {
//     "id": "<invoice-id>",
//     "invoice_number": "INV-2026-0042",
//     "payment_intent_id": "pi_...",
//     "status": "succeeded",
//     "amount": 1000,
//     "amount_received": 1000,
//     "currency": "cad"
//   }
//
// Response 200 (3DS challenge needed — <5% of transactions):
//   {
//     "id": "<invoice-id>",
//     "payment_intent_id": "pi_...",
//     "status": "requires_action",
//     "client_secret": "pi_..._secret_...",   // partner's JS calls stripe.handleNextAction()
//     "amount": 1000, "currency": "cad"
//   }
//
// Response 200 (DECLINED — return 200 not 4xx so partner can show the message):
//   {
//     "id": "<invoice-id>",
//     "status": "requires_payment_method",   // or "failed" / "canceled"
//     "failure_code": "card_declined",
//     "failure_message": "Your card was declined."
//   }
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireApiKey,
  apiErrorResponse,
  PUBLIC_API_CORS_HEADERS,
  corsPreflightResponse,
} from "@/lib/api-keys";
import { createPaymentLink, createInvoiceFromLink } from "@/lib/payment-link.service";
import { loadActiveSupplierStripe } from "@/lib/supplier-stripe";
import { chargeWithToken } from "@/lib/stripe/client";
import { fireWebhookForLink } from "@/lib/webhooks/dispatch";
import { notifyInvoicePaid } from "@/lib/telegram-notify";
import prisma from "@/lib/prisma";

const ALLOWED_EVENTS = new Set([
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
  "invoice.paid",
]);
const MAX_AMOUNT_CENTS = 999_999_99;
const CURRENCY_RE = /^[a-zA-Z]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
// Stripe token ids for anything we can confirm against a PaymentIntent.
const TOKEN_RE = /^(pm_|src_|tok_|card_)[A-Za-z0-9_]+$/;

interface Body {
  amount?: unknown;
  currency?: unknown;
  payment_method_id?: unknown;
  customer?: unknown;
  description?: unknown;
  return_url?: unknown;
  webhook_url?: unknown;
  webhook_secret?: unknown;
  webhook_template?: unknown;
  webhook_events?: unknown;
  metadata?: unknown;
}

function badRequest(message: string, field?: string) {
  return NextResponse.json(
    { error: { type: "invalid_request_error", message, ...(field ? { param: field } : {}) } },
    { status: 400, headers: PUBLIC_API_CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(request: NextRequest) {
  // 1) Auth
  const auth = await requireApiKey(request);
  if (!auth.ok) {
    const { status, body, headers } = apiErrorResponse(auth.error);
    return NextResponse.json(body, {
      status,
      headers: { ...PUBLIC_API_CORS_HEADERS, ...(headers ?? {}) },
    });
  }
  const { id: apiKeyId, tenantId } = auth.key;

  // 2) Parse
  let raw: Body;
  try {
    raw = (await request.json()) as Body;
  } catch {
    return badRequest("Invalid JSON body");
  }

  // 3) Validate
  const amount = Number(raw.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return badRequest("`amount` must be a positive integer (cents)", "amount");
  }
  if (amount > MAX_AMOUNT_CENTS) {
    return badRequest(`\`amount\` exceeds max of ${MAX_AMOUNT_CENTS} cents`, "amount");
  }

  const currency = typeof raw.currency === "string" && raw.currency.trim()
    ? raw.currency.trim().toUpperCase()
    : "CAD";
  if (!CURRENCY_RE.test(currency)) {
    return badRequest("`currency` must be an ISO 4217 alpha-3 code", "currency");
  }

  const paymentMethodId =
    typeof raw.payment_method_id === "string" ? raw.payment_method_id.trim() : "";
  if (!paymentMethodId || !TOKEN_RE.test(paymentMethodId)) {
    return badRequest(
      "`payment_method_id` is required and must be a Stripe token (pm_/src_/tok_/card_)",
      "payment_method_id"
    );
  }

  if (!raw.customer || typeof raw.customer !== "object") {
    return badRequest("`customer` object is required", "customer");
  }
  const c = raw.customer as Record<string, unknown>;
  const customerEmail = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(customerEmail)) {
    return badRequest("`customer.email` is required and must be a valid email", "customer.email");
  }
  const customerName =
    typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 255) : null;
  const customerPhone =
    typeof c.phone === "string" && c.phone.trim() ? c.phone.trim().slice(0, 40) : null;
  const customerCompany =
    typeof c.company === "string" && c.company.trim() ? c.company.trim().slice(0, 255) : null;

  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim().slice(0, 500)
      : null;

  const returnUrl =
    typeof raw.return_url === "string" && raw.return_url.trim() ? raw.return_url.trim() : null;
  if (returnUrl && !URL_RE.test(returnUrl)) {
    return badRequest("`return_url` must be an http(s) URL", "return_url");
  }

  const webhookUrl =
    typeof raw.webhook_url === "string" && raw.webhook_url.trim() ? raw.webhook_url.trim() : null;
  if (webhookUrl && !URL_RE.test(webhookUrl)) {
    return badRequest("`webhook_url` must be an http(s) URL", "webhook_url");
  }
  const webhookSecret =
    typeof raw.webhook_secret === "string" && raw.webhook_secret.trim()
      ? raw.webhook_secret.trim().slice(0, 128)
      : null;
  const webhookTemplate =
    typeof raw.webhook_template === "string" && raw.webhook_template.trim()
      ? raw.webhook_template
      : null;

  let webhookEvents: string[] = ["payment.succeeded", "payment.failed"];
  if (Array.isArray(raw.webhook_events)) {
    const filtered = raw.webhook_events
      .filter((e): e is string => typeof e === "string")
      .filter((e) => ALLOWED_EVENTS.has(e));
    if (filtered.length > 0) webhookEvents = filtered;
  }

  const metadata =
    raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : {};

  // 4) Tenant + Stripe pre-check
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      status: true,
      name: true,
      supplierProfile: { select: { displayName: true } },
    },
  });
  if (!tenant || tenant.status !== "ACTIVE") {
    return NextResponse.json(
      { error: { type: "tenant_error", message: "Tenant is not active" } },
      { status: 403, headers: PUBLIC_API_CORS_HEADERS }
    );
  }
  const stripeCreds = await loadActiveSupplierStripe(tenantId);
  if (!stripeCreds) {
    return NextResponse.json(
      {
        error: {
          type: "tenant_error",
          message:
            "Tenant has no active Stripe processor — configure Stripe keys under Settings → Payments first",
        },
      },
      { status: 402, headers: PUBLIC_API_CORS_HEADERS }
    );
  }

  // 5) Ephemeral payment link + invoice (mirrors /payments and /payment-intents
  //    so the outbound webhook fan-out via fireWebhookForLink lights up).
  const link = await createPaymentLink({
    supplierTenantId: tenantId,
    nickname: description ? description.slice(0, 120) : `API charge ${new Date().toISOString()}`,
    mode: "one_time",
    unitAmountCents: amount,
    currency,
    qtyLocked: true,
    qtyDefault: 1,
    qtyMin: 1,
    qtyMax: 1,
    maxUses: 1,
    partnerRef: typeof metadata.order_id === "string" ? metadata.order_id.slice(0, 120) : null,
    descriptionOverride: description,
    requireName: false,
    requirePhone: false,
    requireCompany: false,
    webhookUrl,
    webhookSecret,
    webhookTemplate,
    webhookEvents,
    webhookEnabled: !!webhookUrl,
  });
  await prisma.supplierPaymentLink.update({
    where: { id: link.id },
    data: { apiGenerated: true, createdViaApiKeyId: apiKeyId },
  });

  const invoice = await createInvoiceFromLink({
    slug: link.shortSlug,
    quantity: 1,
    customer: {
      email: customerEmail,
      name: customerName,
      phone: customerPhone,
      company: customerCompany,
    },
    attributionOverride: typeof metadata.partner_ref === "string" ? metadata.partner_ref : null,
  });

  // 6) Charge the token synchronously on the tenant's Stripe.
  const supplierDisplayName =
    tenant.supplierProfile?.displayName || tenant.name || "";
  const result = await chargeWithToken({
    credentials: stripeCreds,
    orderId: invoice.id,
    amountCents: amount,
    currency,
    paymentMethodId,
    customerEmail,
    description: description || `Invoice #${invoice.invoiceNumber}`,
    returnUrl: returnUrl ?? undefined,
    sendReceipt: false, // API invoices: partner sends their own receipt
    extraMetadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      hubFlow: "supplier_invoice",
      supplierDisplayName: supplierDisplayName.slice(0, 120),
    },
  });

  // 7) Store the PaymentIntent id so refund webhooks can find the invoice.
  if (result.id) {
    void prisma.supplierInvoice
      .update({
        where: { id: invoice.id },
        data: { paymentLinkRef: result.id },
      })
      .catch(() => {
        /* best-effort */
      });
  }

  // 8) On synchronous success, mark the invoice PAID + fire the partner
  //    webhook right away (don't wait for the Stripe webhook — the
  //    partner's site is presumably still in front of the customer).
  //    Idempotent with the Stripe webhook path (both check paymentStatus).
  if (result.status === "succeeded") {
    try {
      await prisma.supplierInvoice.update({
        where: { id: invoice.id, paymentStatus: { not: "PAID" } },
        data: {
          paymentStatus: "PAID",
          status: "PAID",
          paidAt: new Date(),
          paidMethod: "STRIPE",
          amountPaidCents: result.amountReceivedCents || amount,
        },
      });
    } catch {
      /* row-may-not-match-where race — Stripe webhook will handle it */
    }
    // Fire ops Telegram — we marked PAID here (inline), so the Stripe
    // webhook's own notify branch will skip due to its "already paid"
    // idempotency gate. Fire from this side of the race to keep ops
    // notifications reliable. Fire-and-forget.
    void notifyInvoicePaid({
      invoiceNumber: invoice.invoiceNumber,
      amountCents: result.amountReceivedCents || amount,
      currency,
      processor: "Stripe",
    });
    void fireWebhookForLink({
      paymentLinkId: link.id,
      eventType: "payment.succeeded",
      tenant: {
        id: tenantId,
        slug: "",
        name: supplierDisplayName,
        currency,
      },
      payment: {
        id: result.id || invoice.id,
        amount: result.amountReceivedCents || amount,
        currency: currency.toLowerCase(),
        status: "succeeded",
        paidAt: new Date(),
        method: "card",
        processor: { name: "stripe" },
      },
      customer: { email: customerEmail, name: customerName ?? undefined },
      source: {
        kind: "invoice",
        invoice: { id: invoice.id, number: invoice.invoiceNumber, total: amount },
      },
      metadata,
    });

    return NextResponse.json(
      {
        id: invoice.id,
        invoice_number: invoice.invoiceNumber,
        payment_intent_id: result.id,
        status: "succeeded",
        amount,
        amount_received: result.amountReceivedCents || amount,
        currency: currency.toLowerCase(),
      },
      { status: 200, headers: PUBLIC_API_CORS_HEADERS }
    );
  }

  // 9) 3DS challenge required — hand the client_secret back so the
  //    partner's frontend can call stripe.handleNextAction() to trigger
  //    the bank's 3DS modal. When the modal completes, Stripe fires our
  //    webhook and we mark the invoice PAID then.
  if (result.status === "requires_action") {
    return NextResponse.json(
      {
        id: invoice.id,
        invoice_number: invoice.invoiceNumber,
        payment_intent_id: result.id,
        status: "requires_action",
        client_secret: result.clientSecret,
        amount,
        currency: currency.toLowerCase(),
      },
      { status: 200, headers: PUBLIC_API_CORS_HEADERS }
    );
  }

  // 10) Everything else = charge failed (declined, invalid pm, etc).
  //     Fire payment.failed so the partner's webhook receiver logs it.
  void fireWebhookForLink({
    paymentLinkId: link.id,
    eventType: "payment.failed",
    tenant: {
      id: tenantId,
      slug: "",
      name: supplierDisplayName,
      currency,
    },
    payment: {
      id: result.id || invoice.id,
      amount,
      currency: currency.toLowerCase(),
      status: "failed",
      method: "card",
      processor: { name: "stripe" },
      failureCode: result.failureCode,
      failureMessage: result.failureMessage,
    },
    customer: { email: customerEmail, name: customerName ?? undefined },
    source: {
      kind: "invoice",
      invoice: { id: invoice.id, number: invoice.invoiceNumber, total: amount },
    },
    metadata,
  });

  return NextResponse.json(
    {
      id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      payment_intent_id: result.id || null,
      status: result.status,
      failure_code: result.failureCode,
      failure_message: result.failureMessage,
      amount,
      currency: currency.toLowerCase(),
    },
    { status: 200, headers: PUBLIC_API_CORS_HEADERS }
  );
}

export async function GET() {
  return NextResponse.json(
    { error: { type: "invalid_request_error", message: "Method not allowed. Use POST." } },
    { status: 405, headers: { Allow: "POST", ...PUBLIC_API_CORS_HEADERS } }
  );
}
