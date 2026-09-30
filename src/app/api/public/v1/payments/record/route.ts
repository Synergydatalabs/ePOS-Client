// ============================================================================
// POST /api/public/v1/payments/record — Phase I #7 (2026-09-19)
//
// Record-a-payment endpoint. The partner processes the payment on their
// own site (their own Stripe, PayPal, whatever). They then call us to
// create a PAID invoice on the tenant's books for record-keeping. WE
// don't touch a card, don't call Stripe — we just record.
//
// Different from POST /api/public/v1/payments (hosted-checkout mode)
// which returns a checkout_url and expects the customer to visit our
// page. This endpoint returns nothing to redirect to — the payment
// already happened.
//
// Request:
//   Authorization: Bearer sk_...
//
//   {
//     "amount": 1000,                             // cents (required)
//     "currency": "cad",                          // ISO 4217 (default CAD)
//     "customer": {
//       "email":   "buyer@example.com",           // required
//       "name":    "Buyer Name",                  // optional
//       "phone":   "+14165551234",
//       "company": "Acme Inc.",
//       "address": "123 Main St"
//     },
//     "description":        "Order #42",          // shown on the invoice
//     "external_reference": "sdl_txn_abc123",     // your txn id (optional)
//     "paid_at":            "2026-09-19T02:26:27Z", // ISO 8601 (default: now)
//     "processor_name":     "stripe",             // free-text label
//     "metadata":           { "order_id": "42" }
//   }
//
// Response 201:
//   {
//     "id":                 "<invoice-uuid>",
//     "invoice_number":     "INV-2026-0042",
//     "status":             "paid",
//     "amount":             1000,
//     "currency":           "cad",
//     "external_reference": "sdl_txn_abc123",
//     "paid_at":            "2026-09-19T02:26:27.000Z",
//     "recorded_at":        "2026-09-19T02:30:00.000Z",
//     "view_url":           "https://hub.synergydatalabs.com/supplier/invoices/<uuid>"
//   }
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireApiKey,
  apiErrorResponse,
  PUBLIC_API_CORS_HEADERS,
  corsPreflightResponse,
} from "@/lib/api-keys";
import { resolvePublicOrigin } from "@/lib/public-origin";
import prisma from "@/lib/prisma";

const MAX_AMOUNT_CENTS = 999_999_99;
const CURRENCY_RE = /^[a-zA-Z]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RecordRequestBody {
  amount?: unknown;
  currency?: unknown;
  customer?: unknown;
  description?: unknown;
  external_reference?: unknown;
  paid_at?: unknown;
  processor_name?: unknown;
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
  const { tenantId } = auth.key;

  // 2) Parse
  let raw: RecordRequestBody;
  try {
    raw = (await request.json()) as RecordRequestBody;
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
    typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 255) : customerEmail;
  const customerPhone =
    typeof c.phone === "string" && c.phone.trim() ? c.phone.trim().slice(0, 30) : null;
  const customerCompany =
    typeof c.company === "string" && c.company.trim() ? c.company.trim().slice(0, 255) : null;
  const customerAddress =
    typeof c.address === "string" && c.address.trim() ? c.address.trim() : null;

  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim().slice(0, 500)
      : "Payment received";

  const externalReference =
    typeof raw.external_reference === "string" && raw.external_reference.trim()
      ? raw.external_reference.trim().slice(0, 255)
      : null;

  let paidAt = new Date();
  if (typeof raw.paid_at === "string" && raw.paid_at.trim()) {
    const parsed = new Date(raw.paid_at);
    if (Number.isNaN(parsed.getTime())) {
      return badRequest("`paid_at` must be an ISO 8601 date-time string", "paid_at");
    }
    // Sanity clamp — reject values in the far future (skew) or absurdly old.
    const now = Date.now();
    if (parsed.getTime() > now + 5 * 60_000) {
      return badRequest("`paid_at` cannot be more than 5 minutes in the future", "paid_at");
    }
    if (parsed.getTime() < now - 365 * 24 * 60 * 60_000) {
      return badRequest("`paid_at` cannot be more than 1 year in the past", "paid_at");
    }
    paidAt = parsed;
  }

  const processorName =
    typeof raw.processor_name === "string" && raw.processor_name.trim()
      ? raw.processor_name.trim().slice(0, 60)
      : "external";

  // 4) Tenant must be active. No processor check — we don't charge a card.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true },
  });
  if (!tenant || tenant.status !== "ACTIVE") {
    return NextResponse.json(
      { error: { type: "tenant_error", message: "Tenant is not active" } },
      { status: 403, headers: PUBLIC_API_CORS_HEADERS }
    );
  }

  // 5) Idempotency — if the same external_reference was recorded before
  // for this tenant, return the existing invoice instead of creating a
  // duplicate. Skipped when no external_reference is supplied.
  if (externalReference) {
    const existing = await prisma.supplierInvoice.findFirst({
      where: {
        supplierTenantId: tenantId,
        paymentLinkRef: externalReference,
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalCents: true,
        currency: true,
        paidAt: true,
        createdAt: true,
      },
    });
    if (existing) {
      const origin = resolvePublicOrigin(request);
      return NextResponse.json(
        {
          id: existing.id,
          invoice_number: existing.invoiceNumber,
          status: "paid",
          amount: existing.totalCents,
          currency: existing.currency.toLowerCase(),
          external_reference: externalReference,
          paid_at: existing.paidAt?.toISOString() ?? null,
          recorded_at: existing.createdAt.toISOString(),
          view_url: `${origin}/supplier/invoices/${existing.id}`,
          idempotent_replay: true,
        },
        { status: 200, headers: PUBLIC_API_CORS_HEADERS }
      );
    }
  }

  // 6) Create the PAID invoice atomically with its invoice-number slot.
  const invoice = await prisma.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const latest = await tx.supplierInvoice.findFirst({
      where: {
        supplierTenantId: tenantId,
        invoiceNumber: { startsWith: prefix },
      },
      orderBy: { invoiceNumber: "desc" },
      select: { invoiceNumber: true },
    });
    const nextSeq = latest ? Number(latest.invoiceNumber.slice(prefix.length)) + 1 : 1;
    const invoiceNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;

    return tx.supplierInvoice.create({
      data: {
        supplierTenantId: tenantId,
        invoiceNumber,
        status: "PAID",
        customerName,
        customerEmail,
        customerPhone,
        customerCompany,
        customerAddress,
        currency,
        subtotalCents: amount,
        taxCents: 0,
        totalCents: amount,
        paymentStatus: "PAID",
        paidAt,
        paidMethod: processorName.toUpperCase(),
        paymentLinkRef: externalReference,
        amountPaidCents: amount,
        items: {
          create: [
            {
              productName: description,
              unitLabel: "unit",
              quantity: 1,
              unitPriceCents: amount,
              lineTotalCents: amount,
              sortOrder: 0,
            },
          ],
        },
      },
    });
  });

  const origin = resolvePublicOrigin(request);
  return NextResponse.json(
    {
      id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      status: "paid",
      amount: invoice.totalCents,
      currency: invoice.currency.toLowerCase(),
      external_reference: externalReference,
      paid_at: invoice.paidAt?.toISOString() ?? null,
      recorded_at: invoice.createdAt.toISOString(),
      view_url: `${origin}/supplier/invoices/${invoice.id}`,
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
