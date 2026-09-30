// Phase I #5 (2026-09-14): build the webhook context object for a
// payment event. Called at fire time from src/lib/webhooks/dispatch.ts.
//
// The context object is what partners' templates plucks from via
// `{{payment.amount}}`, `{{customer.email}}`, `{{metadata.subscription_id}}`
// etc. Shape is documented alongside the render function. Add new
// fields freely — templates that don't reference them are unaffected.
//
// Two source kinds today:
//   * "invoice"      — customer paid a specific invoice
//   * "payment_link" — customer paid via a shared/QR payment link
// Both funnel into the same `payment` / `customer` / `tenant` shape;
// only the `source` branch differs.

import type { WebhookContext } from "./render";
import { randomBytes } from "crypto";

export type WebhookEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "invoice.paid";

export interface BuildContextArgs {
  eventType: WebhookEventType;
  // Phase I #5 v3 (2026-09-14): partner-supplied secret. Available in
  // templates as `{{webhook.secret}}` so partners can inject it into
  // URL query strings, body fields, or wherever their endpoint
  // expects. We do NOT hash / sign anything with it — pure passthrough.
  webhookSecret?: string | null;
  // Snapshotted payment details. We copy the values in rather than
  // holding a Prisma row so the context is decoupled from schema changes
  // and unit-testable without a DB.
  payment: {
    id: string;
    amount: number;        // minor units (cents/paise)
    currency: string;
    status: "succeeded" | "failed" | "refunded";
    paidAt?: Date | null;
    method?: string;       // card, apple_pay, interac, cash, ...
    processor?: {
      name?: string;
      chargeId?: string;
      receiptUrl?: string;
    };
    fees?: {
      stripe?: number;
      platform?: number;
      net?: number;
    };
    card?: {
      brand?: string;
      last4?: string;
      country?: string;
    };
    // Phase I #6 (2026-09-18): failure detail for payment.failed events.
    // Partners templating `{{payment.failure_code}}` / `{{payment.failure_message}}`
    // read these; succeeded events leave them null.
    failureCode?: string | null;
    failureMessage?: string | null;
  };
  customer?: {
    id?: string;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
    address?: {
      line1?: string | null;
      city?: string | null;
      province?: string | null;
      postalCode?: string | null;
      country?: string | null;
    };
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  source:
    | { kind: "invoice"; invoice: InvoiceSnapshot }
    | { kind: "payment_link"; paymentLink: PaymentLinkSnapshot };
  tenant: {
    id: string;
    slug: string;
    name: string;
    brandName?: string;
    timezone?: string;
    currency?: string;
  };
  // Arbitrary key/value pairs the partner attached to the invoice or
  // payment link at creation time — echoed back verbatim so partners
  // can correlate to their own DB (e.g. subscription_id, order_ref).
  metadata?: Record<string, unknown>;
}

interface InvoiceSnapshot {
  id: string;
  number?: string | null;
  description?: string | null;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  subtotal?: number;
  tax?: number;
  total?: number;
  lineItems?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
}

interface PaymentLinkSnapshot {
  id: string;
  slug?: string | null;
  name?: string | null;
  description?: string | null;
  amount?: number;
}

/**
 * Serialize the caller's snapshots into the canonical webhook context
 * shape. Every field the template can reference lives here.
 */
export function buildWebhookContext(args: BuildContextArgs): WebhookContext {
  const now = new Date();
  const eventId = generateEventId();

  return {
    event: {
      id: eventId,
      type: args.eventType,
      sent_at: now.toISOString(),
      livemode: process.env.NODE_ENV === "production",
    },
    payment: {
      id: args.payment.id,
      amount: args.payment.amount,
      amount_decimal: args.payment.amount / 100,
      currency: args.payment.currency.toLowerCase(),
      status: args.payment.status,
      paid_at: args.payment.paidAt?.toISOString() ?? null,
      method: args.payment.method ?? null,
      card: args.payment.card
        ? {
            brand: args.payment.card.brand ?? null,
            last4: args.payment.card.last4 ?? null,
            country: args.payment.card.country ?? null,
          }
        : null,
      fees: args.payment.fees
        ? {
            stripe: args.payment.fees.stripe ?? null,
            platform: args.payment.fees.platform ?? null,
            net: args.payment.fees.net ?? null,
          }
        : null,
      processor: args.payment.processor
        ? {
            name: args.payment.processor.name ?? null,
            charge_id: args.payment.processor.chargeId ?? null,
            receipt_url: args.payment.processor.receiptUrl ?? null,
          }
        : null,
      failure_code: args.payment.failureCode ?? null,
      failure_message: args.payment.failureMessage ?? null,
    },
    customer: args.customer
      ? {
          id: args.customer.id ?? null,
          email: args.customer.email ?? null,
          name: args.customer.name ?? null,
          phone: args.customer.phone ?? null,
          address: args.customer.address
            ? {
                line1: args.customer.address.line1 ?? null,
                city: args.customer.address.city ?? null,
                province: args.customer.address.province ?? null,
                postal_code: args.customer.address.postalCode ?? null,
                country: args.customer.address.country ?? null,
              }
            : null,
          ip_address: args.customer.ipAddress ?? null,
          user_agent: args.customer.userAgent ?? null,
        }
      : null,
    source: {
      kind: args.source.kind,
      invoice:
        args.source.kind === "invoice"
          ? {
              id: args.source.invoice.id,
              number: args.source.invoice.number ?? null,
              description: args.source.invoice.description ?? null,
              issued_at: args.source.invoice.issuedAt?.toISOString() ?? null,
              due_at: args.source.invoice.dueAt?.toISOString() ?? null,
              subtotal: args.source.invoice.subtotal ?? null,
              tax: args.source.invoice.tax ?? null,
              total: args.source.invoice.total ?? null,
              line_items: args.source.invoice.lineItems ?? [],
            }
          : null,
      payment_link:
        args.source.kind === "payment_link"
          ? {
              id: args.source.paymentLink.id,
              slug: args.source.paymentLink.slug ?? null,
              name: args.source.paymentLink.name ?? null,
              description: args.source.paymentLink.description ?? null,
              amount: args.source.paymentLink.amount ?? null,
            }
          : null,
    },
    tenant: {
      id: args.tenant.id,
      slug: args.tenant.slug,
      name: args.tenant.name,
      brand_name: args.tenant.brandName ?? args.tenant.name,
      timezone: args.tenant.timezone ?? null,
      currency: args.tenant.currency ?? args.payment.currency.toUpperCase(),
    },
    // Phase I #5 v3 (2026-09-14): partner-supplied secret exposed as
    // {{webhook.secret}} so templates can inject it into URL query
    // strings, form fields, whatever. Empty string when no secret set.
    webhook: {
      secret: args.webhookSecret ?? "",
    },
    metadata: args.metadata ?? {},
  };
}

/**
 * `evt_` + 32 hex chars. Not a UUID — shorter, easier to eyeball in
 * logs, and partners are used to Stripe's `evt_<opaque>` shape.
 */
function generateEventId(): string {
  return `evt_${randomBytes(16).toString("hex")}`;
}
