// =============================================================================
// Phase F #4 (2026-08-27) — Supplier-invoice Stripe integration.
//
// Sits on top of the existing per-tenant Stripe client (src/lib/stripe/) which
// was built for merchant-tenant BYO checkout. Same TenantPaymentProvider row
// shape (encrypted credentials, capability slot), same Stripe SDK wrapper —
// the supplier flow just needs its own thin service layer for:
//   • loadActiveSupplierStripe   — decrypt the supplier's Stripe credentials
//                                  from the ECOMMERCE processor row
//   • createInvoiceCheckoutSession — mint a Stripe Checkout URL for an invoice,
//                                    embedding invoiceId in metadata so the
//                                    webhook can reconcile back
//
// The webhook handler at /api/webhooks/payment/stripe/supplier-invoice reads
// that metadata to flip the invoice's paymentStatus to PAID.
// =============================================================================

import prisma from "@/lib/prisma";
import { kybDecryptJson } from "@/lib/kyb-crypto";
import { buildStripeClient, createCheckoutSession, createPaymentIntent } from "@/lib/stripe/client";
import type { StripePaymentIntentResult } from "@/lib/stripe/client";
import type { StripeCredentials } from "@/lib/stripe/types";

/**
 * Resolve the supplier's currently active Stripe processor row and return
 * decrypted credentials. Null when the supplier has no active Stripe setup
 * — caller falls back to the mock-pay path.
 *
 * Scoped to processor='STRIPE' + status='ACTIVE'. Capability filter is
 * omitted deliberately — a supplier who has Stripe wired up for CARD or
 * ECOMMERCE can accept invoice payments either way; the credentials are
 * the same account.
 */
export async function loadActiveSupplierStripe(
  supplierTenantId: string
): Promise<StripeCredentials | null> {
  const row = await prisma.tenantPaymentProvider.findFirst({
    where: {
      tenantId: supplierTenantId,
      processor: "STRIPE",
      status: "ACTIVE",
    },
    select: { credentialsEnc: true },
  });
  if (!row) return null;

  const decrypted = kybDecryptJson<StripeCredentials>(row.credentialsEnc);
  if (!decrypted?.secretKey) return null;
  return decrypted;
}

/**
 * Build a Stripe Checkout Session for one supplier invoice. Returns the
 * URL to redirect the customer to. The invoice's totalCents becomes the
 * single line item — line-item detail is preserved in the invoice row +
 * items table, not duplicated onto Stripe.
 *
 * success/cancel URLs point back at our own pay page so we can render
 * the paid state (or a retry) after Stripe closes.
 */
export async function createInvoiceCheckoutSession(args: {
  supplierTenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  customerEmail: string;
  origin: string;
  supplierDisplayName: string;
}): Promise<{ url: string; sessionId: string } | null> {
  const credentials = await loadActiveSupplierStripe(args.supplierTenantId);
  if (!credentials) return null;

  const returnBase = args.origin.replace(/\/+$/, "");
  const session = await createCheckoutSession({
    credentials,
    // Use invoiceId as the "orderId" so the existing metadata contract
    // (see src/lib/stripe/client.ts) covers us without a rename.
    orderId: args.invoiceId,
    amountCents: args.totalCents,
    currency: args.currency,
    orderNumber: args.invoiceNumber,
    customerEmail: args.customerEmail,
    successUrl: `${returnBase}/pay/invoice/${args.invoiceId}?paid=1`,
    cancelUrl: `${returnBase}/pay/invoice/${args.invoiceId}?cancelled=1`,
    extraMetadata: {
      // Explicit invoiceId key so the webhook doesn't have to know that
      // orderId doubles as invoiceId in the supplier-invoice flow.
      invoiceId: args.invoiceId,
      invoiceNumber: args.invoiceNumber,
      // Guard against a webhook accidentally matching a merchant PO with
      // the same UUID (statistically impossible, but explicit is cheap).
      hubFlow: "supplier_invoice",
      supplierDisplayName: args.supplierDisplayName.slice(0, 120),
    },
  });

  return { url: session.url, sessionId: session.id };
}

/**
 * Phase I #2a (2026-09-08) — Elements variant of the invoice pay flow.
 *
 * Instead of returning a hosted checkout URL to redirect to, mints a
 * Stripe PaymentIntent and returns the clientSecret + publishableKey for
 * the pay page to render inline via @stripe/react-stripe-js Elements.
 * The customer never leaves hub.synergydatalabs.com.
 *
 * Metadata contract mirrors createInvoiceCheckoutSession so the same
 * webhook handler (payment_intent.succeeded now, plus the existing
 * checkout.session.completed) can reconcile either flow. Legacy invoices
 * paid via Checkout Sessions still land through the checkout.session
 * branch of the webhook untouched.
 *
 * Returns null when the supplier has no active Stripe processor.
 */
export async function createInvoicePaymentIntent(args: {
  supplierTenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  customerEmail: string;
  supplierDisplayName: string;
  /**
   * Phase I #9 (2026-09-19): let API-created invoices suppress Stripe's
   * own receipt email (partner sends their own). Defaults to true for
   * every existing caller.
   */
  sendReceipt?: boolean;
}): Promise<StripePaymentIntentResult | null> {
  const credentials = await loadActiveSupplierStripe(args.supplierTenantId);
  if (!credentials) return null;

  const description = args.supplierDisplayName
    ? `${args.supplierDisplayName} · Invoice #${args.invoiceNumber}`
    : `Invoice #${args.invoiceNumber}`;

  const intent = await createPaymentIntent({
    credentials,
    orderId: args.invoiceId,
    amountCents: args.totalCents,
    currency: args.currency,
    customerEmail: args.customerEmail,
    description,
    sendReceipt: args.sendReceipt,
    extraMetadata: {
      invoiceId: args.invoiceId,
      invoiceNumber: args.invoiceNumber,
      hubFlow: "supplier_invoice",
      supplierDisplayName: args.supplierDisplayName.slice(0, 120),
    },
  });

  return intent;
}

/**
 * Phase I #13 (2026-09-23) — mid-checkout PaymentIntent amount update.
 *
 * When the customer switches payment methods on the pay page and the
 * new method attracts a surcharge (e.g. +2% UPI convenience fee), we
 * need to keep three amounts in sync:
 *   1. The Stripe PaymentIntent's `amount` (what actually gets captured)
 *   2. The supplier_invoices.totalCents (what the receipt shows)
 *   3. The UI's rendered total on the pay page
 *
 * This helper handles (1). The caller updates (2) in the same DB txn,
 * and (3) is derived from the endpoint's response.
 *
 * Returns null when the supplier has no active Stripe processor.
 */
export async function updateInvoicePaymentIntentAmount(args: {
  supplierTenantId: string;
  paymentIntentId: string;
  newAmountCents: number;
  currency: string;
}): Promise<{ id: string } | null> {
  const credentials = await loadActiveSupplierStripe(args.supplierTenantId);
  if (!credentials) return null;
  const stripe = buildStripeClient(credentials);
  const updated = await stripe.paymentIntents.update(args.paymentIntentId, {
    amount: args.newAmountCents,
    currency: args.currency.toLowerCase(),
  });
  return { id: updated.id };
}
