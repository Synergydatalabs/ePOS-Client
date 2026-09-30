// Shared "mark a PO as paid" logic.
//
// Two callers today:
//   1. POST /api/pay/po/[poId]/mock-pay — mock checkout confirms via direct
//      call (no real webhook because the mock is platform-hosted)
//   2. Real-processor webhook (Phase C #68 — coming) — will lookup the PO
//      by payment_link_reference and call this same function
//
// Keeping the state transition in one place means the two paths can't
// drift — same idempotency, same notifications, same audit fields.

import type { Prisma, PurchaseOrder } from "@prisma/client";
import prisma from "@/lib/prisma";
import { notifyPoPaid } from "@/lib/marketplace-notify";

export interface MarkPoAsPaidParams {
  purchaseOrderId: string;
  // Amount actually captured. Usually equals po.totalCents. Set separately
  // so real processors can pass the exact figure they charged (fx / fee
  // differences never affect this — that's captured elsewhere).
  paidAmountCents: number;
  // Card, apple_pay, google_pay, ach, etc. Free-form string — processor-
  // reported. Stored as-is for auditing.
  paidMethod: string;
  // Whatever ref the processor used (for the mock this is our own
  // MOCK-XXXX ref; for real webhooks, it's the transaction id we already
  // have on the PO row).
  processorReference?: string | null;
}

export interface MarkPoAsPaidResult {
  purchaseOrder: PurchaseOrder;
  // true if this call transitioned the PO from unpaid → paid.
  // false if the PO was already PAID (idempotent no-op).
  wasFreshTransition: boolean;
}

export async function markPoAsPaid(
  params: MarkPoAsPaidParams,
  tx?: Prisma.TransactionClient
): Promise<MarkPoAsPaidResult> {
  const client = tx ?? prisma;

  const existing = await client.purchaseOrder.findUnique({
    where: { id: params.purchaseOrderId },
  });
  if (!existing) {
    throw new Error(`PO ${params.purchaseOrderId} not found`);
  }

  // Idempotency — if already PAID, return the current row without
  // rewriting anything. Prevents duplicate emails on webhook retries and
  // double-payments on network flakes.
  if (existing.paymentStatus === "PAID") {
    return { purchaseOrder: existing, wasFreshTransition: false };
  }

  const now = new Date();
  const updated = await client.purchaseOrder.update({
    where: { id: params.purchaseOrderId },
    data: {
      paymentStatus: "PAID",
      paidAt: now,
      paidAmountCents: params.paidAmountCents,
      paidMethod: params.paidMethod,
      // If the caller passed a processor reference (real webhook), stamp
      // it in case it differs from what was stored at link-creation time
      // (e.g. processor issued a new transaction id on retry).
      ...(params.processorReference
        ? { paymentLinkReference: params.processorReference }
        : {}),
    },
  });

  // Fire-and-forget notification to both sides. Runs outside the caller's
  // transaction (using bare prisma via marketplace-notify) so a slow SES
  // send doesn't hold a DB lock.
  //
  // We do this synchronously in JS (not awaited inside a tx) because the
  // caller may be inside a transaction — deferring the send is safer than
  // scheduling it to run before the tx commits.
  notifyPoPaid({
    id: updated.id,
    poNumber: updated.poNumber,
    supplierTenantId: updated.supplierTenantId,
    merchantTenantId: updated.merchantTenantId,
    paidAmountCents: params.paidAmountCents,
    currency: updated.currency,
    paidMethod: params.paidMethod,
  });

  return { purchaseOrder: updated, wasFreshTransition: true };
}
