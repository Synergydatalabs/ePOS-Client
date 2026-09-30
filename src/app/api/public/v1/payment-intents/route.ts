// ============================================================================
// POST /api/public/v1/payment-intents — Phase I #8 (2026-09-19)
//
// Elements-mode Payments API. The partner's site loads Stripe.js and
// mounts a card form on THEIR own page — customer never visits us.
// Their backend calls this endpoint to:
//   1. Create a SupplierInvoice on the tenant's books (UNPAID)
//   2. Mint a Stripe PaymentIntent against the tenant's active Stripe
//   3. Return { client_secret, publishable_key } so the partner's
//      frontend can confirm the payment client-side via Stripe.js.
//
// After the customer completes the card form, Stripe fires our existing
// webhook (/api/webhooks/payment/stripe/supplier-invoice), which marks
// the invoice PAID and fires the partner's own webhook (via
// fireWebhookForLink) with the rendered template + HMAC signature.
//
// Request (Authorization: Bearer sk_...):
//   {
//     "amount": 1000,                              // cents (required)
//     "currency": "cad",                           // ISO 4217 (default CAD)
//     "customer": { "email": "buyer@example.com", "name": "Buyer" },
//     "description": "Order #42",
//     "webhook_url":      "https://your-site.com/hooks/payment",
//     "webhook_secret":   "your-partner-secret",   // optional
//     "webhook_template": "{\"event\":\"{{event.type}}\",\"amount\":{{payment.amount}}}",
//     "webhook_events":   ["payment.succeeded", "payment.failed"],
//     "metadata":         { "order_id": "42" }
//   }
//
// Response 201:
//   {
//     "id":                "<invoice-id>",
//     "payment_intent_id": "pi_3Nabc...",
//     "client_secret":     "pi_3Nabc..._secret_xyz",
//     "publishable_key":   "pk_test_...",
//     "amount":            1000,
//     "currency":          "cad",
//     "created_at":        "2026-09-19T..."
//   }
//
// The partner's frontend then:
//   const stripe = Stripe(response.publishable_key);
//   const elements = stripe.elements({ clientSecret: response.client_secret });
//   const paymentEl = elements.create('payment');
//   paymentEl.mount('#payment-form');
//   // on submit:
//   const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireApiKey,
  apiErrorResponse,
  PUBLIC_API_CORS_HEADERS,
  corsPreflightResponse,
} from "@/lib/api-keys";
import { createPaymentLink, createInvoiceFromLink } from "@/lib/payment-link.service";
import { createInvoicePaymentIntent } from "@/lib/supplier-stripe";
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

interface Body {
  amount?: unknown;
  currency?: unknown;
  customer?: unknown;
  description?: unknown;
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

  // 4) Tenant + Stripe processor pre-check
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

  // 5) Spawn ephemeral single-use payment link carrying webhook config
  //    (matches the hosted-checkout endpoint's shape so the existing
  //    webhook-fan-out path via fireWebhookForLink lights up on success).
  const link = await createPaymentLink({
    supplierTenantId: tenantId,
    nickname: description ? description.slice(0, 120) : `API PI ${new Date().toISOString()}`,
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

  // 6) Invoice off the link (bumps currentUses to 1 → locked capacity)
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

  // 7) Mint Stripe PaymentIntent for that invoice on the tenant's Stripe
  let intent;
  try {
    intent = await createInvoicePaymentIntent({
      supplierTenantId: tenantId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      totalCents: amount,
      currency,
      customerEmail,
      supplierDisplayName:
        tenant.supplierProfile?.displayName || tenant.name || "",
      // API-created invoices — partner sends their own receipt.
      sendReceipt: false,
    });
  } catch (err) {
    console.error("[payment-intents] createInvoicePaymentIntent failed:", err);
    return NextResponse.json(
      {
        error: {
          type: "processor_error",
          message: err instanceof Error ? err.message : "Stripe PaymentIntent creation failed",
        },
      },
      { status: 502, headers: PUBLIC_API_CORS_HEADERS }
    );
  }
  if (!intent) {
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

  // 8) Store the PaymentIntent id on the invoice so refund webhooks find it.
  //    Fire-and-forget — a failure here doesn't block the response.
  void prisma.supplierInvoice
    .update({
      where: { id: invoice.id },
      data: { paymentLinkRef: intent.id },
    })
    .catch((err) => {
      console.error("[payment-intents] paymentLinkRef backfill failed:", err);
    });

  return NextResponse.json(
    {
      id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      payment_intent_id: intent.id,
      client_secret: intent.clientSecret,
      publishable_key: intent.publishableKey,
      amount,
      currency: currency.toLowerCase(),
      created_at: invoice.createdAt.toISOString(),
    },
    { status: 201, headers: PUBLIC_API_CORS_HEADERS }
  );
}

export async function GET() {
  return NextResponse.json(
    { error: { type: "invalid_request_error", message: "Method not allowed. Use POST." } },
    { status: 405, headers: { Allow: "POST", ...PUBLIC_API_CORS_HEADERS } }
  );
}
