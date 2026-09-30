// =============================================================================
// Phase G #1 (2026-08-30) — Supplier subscription service layer.
//
// Flavour A rules:
//   - Subscription rows are created alongside the FIRST invoice from the
//     supplier invoice form. Status = PENDING_ACTIVATION.
//   - When that first invoice is marked PAID (mock-pay, Stripe webhook,
//     any future processor), we call activateSubscription() — flips to
//     ACTIVE and sets nextBillingAt = paidAt + one interval.
//   - The billing cron (every day) calls generateDueInvoices() which
//     scans ACTIVE subs whose nextBillingAt <= NOW and mints the next
//     invoice. That invoice's payment flows through the same PAID path
//     which now calls advanceSubscriptionAfterPayment() to push
//     nextBillingAt forward by another interval.
//   - Cancellation stops future generation but never touches issued
//     invoices — the buyer can still pay a past-due invoice after
//     cancellation if they choose to.
//
// This file is stateful DB code; the HTTP endpoints (invoice route,
// mock-pay route, cron route, cancel route) all delegate here to keep
// their handlers thin.
// =============================================================================

import prisma from "@/lib/prisma";
import type { InvoiceLineInput } from "@/lib/supplier-invoices";
import {
  computeTotals,
  createSupplierInvoice,
  buildPaymentLinkUrl,
  generateInvoiceNumber,
} from "@/lib/supplier-invoices";

// --- Types -------------------------------------------------------------------

export type SubscriptionInterval = "MONTHLY" | "ANNUAL";

export type SubscriptionStatus =
  | "PENDING_ACTIVATION"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELLED";

export type SubscriptionCancelledBy = "BUYER" | "VENDOR" | "SYSTEM_DUNNING";

/**
 * Input for a new subscription. Same customer/line shape as an invoice —
 * the first invoice is minted from this same input.
 */
export interface CreateSubscriptionInput {
  supplierTenantId: string;
  createdByMembershipId?: string | null;

  customerName: string;
  customerEmail: string;
  customerCcEmails?: string[];
  customerPhone?: string | null;
  customerCompany?: string | null;
  customerAddress?: string | null;

  currency: string;
  taxCents?: number;
  notes?: string | null;

  lines: InvoiceLineInput[];

  interval: SubscriptionInterval;
  intervalCount?: number; // defaults to 1 — supports "every 3 months" later
}

// --- Interval math -----------------------------------------------------------

/**
 * Push a date forward by `count` intervals. Kept in one place so the
 * cron, activation, and preview code all use the same calendar logic.
 * Uses UTC month/year arithmetic so DST doesn't drift the billing day.
 */
export function addInterval(
  from: Date,
  interval: SubscriptionInterval,
  count: number = 1
): Date {
  const d = new Date(from.getTime());
  if (interval === "MONTHLY") {
    d.setUTCMonth(d.getUTCMonth() + count);
  } else if (interval === "ANNUAL") {
    d.setUTCFullYear(d.getUTCFullYear() + count);
  }
  return d;
}

// --- Create + first invoice -------------------------------------------------

/**
 * Create a subscription + mint the FIRST invoice in one transaction.
 * The invoice comes back with subscription_id + subscription_sequence=1
 * and is emailable via the existing supplier-invoice email flow.
 *
 * The buyer's act of paying invoice #1 is what "authorises" the
 * subscription — until then it sits PENDING_ACTIVATION and is invisible
 * to the billing cron.
 */
export async function createSupplierSubscription(
  input: CreateSubscriptionInput,
  origin: string
) {
  if (!input.lines.length) {
    throw new Error("A subscription needs at least one line item");
  }
  if (!["MONTHLY", "ANNUAL"].includes(input.interval)) {
    throw new Error(`Unsupported interval: ${input.interval}`);
  }
  const { subtotalCents, taxCents, totalCents } = computeTotals(
    input.lines,
    input.taxCents ?? 0
  );
  if (totalCents <= 0) {
    throw new Error("Subscription total must be greater than zero");
  }

  // Snapshot line items in the shape the cron will use to build future
  // invoices. Keep only the invoice-relevant fields so we don't
  // accidentally hoard client-only cruft.
  const lineItemsSnapshot = input.lines.map((l, i) => ({
    productId: l.productId ?? null,
    productName: l.productName.trim(),
    productDescription: l.productDescription?.trim() || null,
    unitLabel: (l.unitLabel?.trim() || "unit").slice(0, 50),
    quantity: Math.max(1, Math.round(l.quantity)),
    unitPriceCents: Math.max(0, Math.round(l.unitPriceCents)),
    sortOrder: i,
  }));

  // Transaction: create the Subscription + create the first Invoice + link them.
  // We inline the invoice create (not calling createSupplierInvoice) so we
  // can atomically write subscription_id + sequence on it — the existing
  // create helper doesn't know about subscriptions.
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const invoiceNumber = await generateInvoiceNumber(input.supplierTenantId);
    try {
      return await prisma.$transaction(async (tx) => {
        const sub = await tx.supplierSubscription.create({
          data: {
            supplierTenantId: input.supplierTenantId,
            customerName: input.customerName.trim(),
            customerEmail: input.customerEmail.trim().toLowerCase(),
            customerCcEmails: (input.customerCcEmails || [])
              .map((e) => e.trim().toLowerCase())
              .filter((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
              .filter((e, i, arr) => arr.indexOf(e) === i),
            customerPhone: input.customerPhone?.trim() || null,
            customerCompany: input.customerCompany?.trim() || null,
            customerAddress: input.customerAddress?.trim() || null,
            currency: input.currency.toUpperCase(),
            subtotalCents,
            taxCents,
            totalCents,
            lineItems: lineItemsSnapshot as unknown as object,
            interval: input.interval,
            intervalCount: Math.max(1, input.intervalCount ?? 1),
            status: "PENDING_ACTIVATION",
            createdByMembershipId: input.createdByMembershipId ?? null,
            notes: input.notes?.trim() || null,
          },
        });

        const invoice = await tx.supplierInvoice.create({
          data: {
            supplierTenantId: input.supplierTenantId,
            invoiceNumber,
            status: "SENT",
            customerName: input.customerName.trim(),
            customerEmail: input.customerEmail.trim().toLowerCase(),
            customerCcEmails: sub.customerCcEmails,
            customerPhone: sub.customerPhone,
            customerCompany: sub.customerCompany,
            customerAddress: sub.customerAddress,
            currency: sub.currency,
            subtotalCents,
            taxCents,
            totalCents,
            notes: sub.notes,
            createdByMembershipId: input.createdByMembershipId ?? null,
            subscriptionId: sub.id,
            subscriptionSequence: 1,
            // Period 1: from creation → creation + interval
            subscriptionPeriodStart: new Date(),
            subscriptionPeriodEnd: addInterval(new Date(), sub.interval as SubscriptionInterval, sub.intervalCount),
            items: {
              create: input.lines.map((l, i) => ({
                productId: l.productId ?? null,
                productName: l.productName.trim(),
                productDescription: l.productDescription?.trim() || null,
                unitLabel: (l.unitLabel?.trim() || "unit").slice(0, 50),
                quantity: Math.max(1, Math.round(l.quantity)),
                unitPriceCents: Math.max(0, Math.round(l.unitPriceCents)),
                lineTotalCents:
                  Math.max(1, Math.round(l.quantity)) *
                  Math.max(0, Math.round(l.unitPriceCents)),
                sortOrder: i,
              })),
            },
          },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });

        const paymentLinkUrl = buildPaymentLinkUrl(origin, invoice.id);
        const withLink = await tx.supplierInvoice.update({
          where: { id: invoice.id },
          data: { paymentLinkUrl },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });

        return { subscription: sub, invoice: withLink };
      });
    } catch (err: any) {
      if (err?.code === "P2002" && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }
  throw new Error("Failed to allocate a unique invoice number after retries");
}

// --- Activation --------------------------------------------------------------

/**
 * Called from the payment-marked-paid path (mock-pay endpoint + Stripe
 * webhook + Moneris webhook + any future processor). If the paid invoice
 * belongs to a subscription:
 *   - Sequence 1 → PENDING_ACTIVATION becomes ACTIVE (first-payment
 *     activation).
 *   - Sequence 2+ → nextBillingAt advances by one interval; status stays
 *     ACTIVE (or flips from PAST_DUE back to ACTIVE if the buyer paid a
 *     lapsed invoice).
 * No-op when invoice.subscriptionId is null.
 */
export async function onSubscriptionInvoicePaid(
  invoiceId: string,
  paidAt: Date
): Promise<void> {
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      subscriptionId: true,
      subscriptionSequence: true,
      subscriptionPeriodEnd: true,
    },
  });
  if (!invoice?.subscriptionId) return; // not a subscription invoice — no-op

  const sub = await prisma.supplierSubscription.findUnique({
    where: { id: invoice.subscriptionId },
    select: {
      id: true,
      status: true,
      interval: true,
      intervalCount: true,
      nextBillingAt: true,
      activatedAt: true,
    },
  });
  if (!sub) return;
  if (sub.status === "CANCELLED") return; // buyer paid a past invoice after
  // vendor already cancelled — respect the cancellation, don't reactivate.

  // Next billing anchors off the invoice's periodEnd if set, else the
  // paidAt clock. periodEnd exists on all G-migrated invoices.
  const nextBillingAt = invoice.subscriptionPeriodEnd
    ? invoice.subscriptionPeriodEnd
    : addInterval(paidAt, sub.interval as SubscriptionInterval, sub.intervalCount);

  await prisma.supplierSubscription.update({
    where: { id: sub.id },
    data: {
      status: "ACTIVE",
      // Only set activatedAt on the very first paid invoice.
      ...(sub.activatedAt ? {} : { activatedAt: paidAt }),
      nextBillingAt,
    },
  });
}

// --- Generate next invoice (cron) -------------------------------------------

/**
 * Cron entry point. Finds every ACTIVE subscription whose nextBillingAt
 * is on/before `asOf` and mints the next invoice. Returns a summary
 * for logging.
 *
 * Idempotency: if there's already an unpaid invoice at (subscriptionId,
 * subscriptionSequence = current sequence + 1) we skip — the cron
 * probably fired twice on the same day. This is checked before create
 * inside the transaction so two racing cron runs still can't double up.
 */
export async function generateDueInvoices(
  origin: string,
  asOf: Date = new Date()
): Promise<{
  processed: number;
  minted: string[];
  skipped: string[];
  errors: Array<{ subscriptionId: string; error: string }>;
}> {
  const due = await prisma.supplierSubscription.findMany({
    where: {
      status: "ACTIVE",
      nextBillingAt: { lte: asOf },
    },
    select: { id: true },
    take: 500, // hard cap per run — cron is daily, real fleets never hit this
  });

  const minted: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ subscriptionId: string; error: string }> = [];

  for (const { id } of due) {
    try {
      const result = await mintNextInvoiceForSubscription(id, origin);
      if (result.status === "MINTED") minted.push(result.invoiceId);
      else skipped.push(id);
    } catch (err: any) {
      errors.push({ subscriptionId: id, error: err?.message || String(err) });
    }
  }

  return { processed: due.length, minted, skipped, errors };
}

/**
 * Mint the next invoice for one subscription. Extracted so tests +
 * "send now" admin-force actions can call it directly.
 */
export async function mintNextInvoiceForSubscription(
  subscriptionId: string,
  origin: string
): Promise<
  | { status: "MINTED"; invoiceId: string; invoiceNumber: string; sequence: number }
  | { status: "SKIPPED_DUPLICATE"; existingInvoiceId: string }
  | { status: "SKIPPED_CANCELLED" }
  | { status: "SKIPPED_NOT_DUE" }
> {
  const sub = await prisma.supplierSubscription.findUnique({
    where: { id: subscriptionId },
    include: {
      invoices: {
        orderBy: { subscriptionSequence: "desc" },
        take: 1,
        select: {
          id: true,
          subscriptionSequence: true,
          subscriptionPeriodEnd: true,
          paymentStatus: true,
        },
      },
    },
  });
  if (!sub) throw new Error(`Subscription not found: ${subscriptionId}`);
  if (sub.status === "CANCELLED") return { status: "SKIPPED_CANCELLED" };
  if (!sub.nextBillingAt || sub.nextBillingAt.getTime() > Date.now()) {
    return { status: "SKIPPED_NOT_DUE" };
  }

  const lastInvoice = sub.invoices[0] || null;
  const lastSequence = lastInvoice?.subscriptionSequence ?? 0;
  const nextSequence = lastSequence + 1;

  // Idempotency: if the sequence already exists, don't double-mint.
  const already = await prisma.supplierInvoice.findFirst({
    where: {
      subscriptionId: sub.id,
      subscriptionSequence: nextSequence,
    },
    select: { id: true },
  });
  if (already) {
    return { status: "SKIPPED_DUPLICATE", existingInvoiceId: already.id };
  }

  const periodStart = sub.nextBillingAt;
  const periodEnd = addInterval(
    periodStart,
    sub.interval as SubscriptionInterval,
    sub.intervalCount
  );

  // Retry on invoice-number race (~same as createSupplierInvoice).
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const invoiceNumber = await generateInvoiceNumber(sub.supplierTenantId);
    try {
      const created = await prisma.$transaction(async (tx) => {
        // Recheck inside the transaction — two cron nodes racing on the
        // same subscription must not both mint.
        const dupCheck = await tx.supplierInvoice.findFirst({
          where: {
            subscriptionId: sub.id,
            subscriptionSequence: nextSequence,
          },
          select: { id: true },
        });
        if (dupCheck) return { invoice: null, duplicate: dupCheck };

        const lineItems = Array.isArray(sub.lineItems)
          ? (sub.lineItems as any[])
          : [];

        const invoice = await tx.supplierInvoice.create({
          data: {
            supplierTenantId: sub.supplierTenantId,
            invoiceNumber,
            status: "SENT",
            customerName: sub.customerName,
            customerEmail: sub.customerEmail,
            customerCcEmails: sub.customerCcEmails,
            customerPhone: sub.customerPhone,
            customerCompany: sub.customerCompany,
            customerAddress: sub.customerAddress,
            currency: sub.currency,
            subtotalCents: sub.subtotalCents,
            taxCents: sub.taxCents,
            totalCents: sub.totalCents,
            notes: sub.notes,
            subscriptionId: sub.id,
            subscriptionSequence: nextSequence,
            subscriptionPeriodStart: periodStart,
            subscriptionPeriodEnd: periodEnd,
            items: {
              create: lineItems.map((l: any, i: number) => {
                const quantity = Math.max(1, Math.round(Number(l.quantity) || 1));
                const unitPriceCents = Math.max(0, Math.round(Number(l.unitPriceCents) || 0));
                return {
                  productId: l.productId ?? null,
                  productName: String(l.productName ?? "Subscription"),
                  productDescription: l.productDescription ?? null,
                  unitLabel: String(l.unitLabel ?? "unit"),
                  quantity,
                  unitPriceCents,
                  lineTotalCents: quantity * unitPriceCents,
                  sortOrder: typeof l.sortOrder === "number" ? l.sortOrder : i,
                };
              }),
            },
          },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });

        const paymentLinkUrl = buildPaymentLinkUrl(origin, invoice.id);
        const withLink = await tx.supplierInvoice.update({
          where: { id: invoice.id },
          data: { paymentLinkUrl },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });

        return { invoice: withLink, duplicate: null };
      });

      if (created.duplicate) {
        return {
          status: "SKIPPED_DUPLICATE",
          existingInvoiceId: created.duplicate.id,
        };
      }
      const inv = created.invoice!;
      return {
        status: "MINTED",
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        sequence: nextSequence,
      };
    } catch (err: any) {
      if (err?.code === "P2002" && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }
  throw new Error("Failed to mint invoice after retries");
}

// --- Cancel -----------------------------------------------------------------

export interface CancelSubscriptionInput {
  subscriptionId: string;
  cancelledBy: SubscriptionCancelledBy;
  cancellationReason?: string | null;
  // For SYSTEM_DUNNING cancels, cron passes the invoice that failed.
  triggeringInvoiceId?: string | null;
}

export async function cancelSupplierSubscription(input: CancelSubscriptionInput) {
  const sub = await prisma.supplierSubscription.findUnique({
    where: { id: input.subscriptionId },
    select: { id: true, status: true },
  });
  if (!sub) throw new Error("Subscription not found");
  if (sub.status === "CANCELLED") {
    // Idempotent — a second click doesn't error.
    return sub;
  }
  return prisma.supplierSubscription.update({
    where: { id: sub.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledBy: input.cancelledBy,
      cancellationReason: input.cancellationReason ?? null,
      // Zero out nextBillingAt so a stale cron never revives it.
      nextBillingAt: null,
    },
  });
}

// --- Utility: what a supplier / buyer sees ---------------------------------

/**
 * Fresh-import helper — createSupplierInvoice import above is only for
 * side-effect visibility; we don't call it here. Prevents TS thinking
 * the import is unused when the tree-shaker is aggressive.
 */
export const _keepCreateInvoiceImportAlive = createSupplierInvoice;
