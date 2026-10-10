// =============================================================================
// POST /api/webhooks/h-ecom — Helcim webhook receiver.
//
// 2026-10-09: Helcim's URL validator blocks the word "helcim" in the
// configured URL, hence this path. The merchant pastes
// `https://indianbeans.com/api/webhooks/h-ecom` into their Helcim portal.
//
// Multi-tenant: we look up which tenant owns the transaction via the
// `invoiceNumber` field (which we set to our SupplierInvoice id when
// initializing the HelcimPay.js session). On a match we verify the
// signature against that tenant's stored webhook verifier, then flip
// the invoice to PAID + fire outbound webhooks.
//
// Helcim sends the signature in header `webhook-signature` as a hex
// HMAC-SHA256 of the raw body. We verify with timing-safe equality.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { kybDecryptJson } from "@/lib/kyb-crypto";
import { verifyHelcimWebhookSignature } from "@/lib/helcim/client";
import { fireWebhookForLink } from "@/lib/webhooks/dispatch";
import type { HelcimCredentials, HelcimWebhookEvent } from "@/lib/helcim/types";

export const runtime = "nodejs"; // crypto needs node runtime

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature =
    request.headers.get("webhook-signature") ||
    request.headers.get("x-helcim-signature") ||
    null;

  let event: HelcimWebhookEvent;
  try {
    event = JSON.parse(rawBody) as HelcimWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const invoiceRef = String(event?.data?.invoiceNumber || "").trim();
  if (!invoiceRef) {
    // Live tests from the Helcim portal arrive with no invoice number.
    // Accept silently so Helcim stops retrying; log for debugging.
    console.warn("[HELCIM-WEBHOOK] no invoiceNumber — ignored", {
      type: event?.type,
      id: event?.id,
    });
    return NextResponse.json({ received: true, ignored: "no_invoice_number" });
  }

  // 2026-10-09: Resolve the invoice from Helcim's invoiceNumber field.
  // The initialize call mints a fresh "H…" alphanumeric ref per session
  // (Helcim rejects long UUIDs and duplicates), stashes it on the invoice
  // as paymentLinkRef, and sends it to Helcim as invoiceNumber. So the
  // webhook looks it up here by paymentLinkRef. Falls back to a UUID
  // id-match and a UUID prefix-match for forwards/backwards compatibility
  // if Helcim ever echoes something else, or for direct portal tests.
  const invoiceSelect = {
    id: true,
    supplierTenantId: true,
    invoiceNumber: true,
    paymentStatus: true,
    totalCents: true,
    currency: true,
    customerEmail: true,
    customerName: true,
    paymentLinkId: true,
    paymentLinkRef: true,
  } as const;

  let invoice = await prisma.supplierInvoice.findFirst({
    where: { paymentLinkRef: invoiceRef },
    select: invoiceSelect,
  });
  if (!invoice && invoiceRef.length === 36) {
    invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceRef },
      select: invoiceSelect,
    });
  }
  if (!invoice) {
    invoice = await prisma.supplierInvoice.findFirst({
      where: { id: { startsWith: invoiceRef } },
      select: invoiceSelect,
    });
  }
  if (!invoice) {
    console.warn("[HELCIM-WEBHOOK] invoice not found", { invoiceRef });
    return NextResponse.json({ received: true, ignored: "invoice_not_found" });
  }

  // Load the tenant's Helcim credentials to verify the signature.
  const providerRow = await prisma.tenantPaymentProvider.findFirst({
    where: {
      tenantId: invoice.supplierTenantId,
      processor: "HELCIM",
      capability: "CARD",
    },
    select: { credentialsEnc: true },
  });
  const creds = providerRow
    ? kybDecryptJson<HelcimCredentials>(providerRow.credentialsEnc)
    : null;

  if (!creds?.webhookVerifier) {
    console.warn("[HELCIM-WEBHOOK] no webhook verifier for tenant", {
      tenantId: invoice.supplierTenantId,
    });
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 400 }
    );
  }

  if (!verifyHelcimWebhookSignature(rawBody, signature, creds.webhookVerifier)) {
    console.warn("[HELCIM-WEBHOOK] signature verification failed", {
      tenantId: invoice.supplierTenantId,
      invoiceId,
      sigPrefix: signature?.slice(0, 8),
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const type = String(event.type || "").toLowerCase();
  const txnId = event.data?.transactionId ? String(event.data.transactionId) : null;

  // Dispatch on event type.
  if (type === "transactionsuccess" || type === "cardtransaction") {
    if (invoice.paymentStatus === "PAID") {
      return NextResponse.json({ received: true, note: "already_paid" });
    }
    await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        paymentStatus: "PAID",
        status: "PAID",
        paidAt: new Date(),
        paidMethod: "helcim_card",
        paymentLinkRef: txnId || invoice.paymentLinkRef,
      },
    });

    // Fire outbound partner webhook (fire-and-forget).
    if (invoice.paymentLinkId) {
      void fireWebhookForLink({
        paymentLinkId: invoice.paymentLinkId,
        eventType: "payment.succeeded",
        tenant: {
          id: invoice.supplierTenantId,
          slug: "",
          name: "",
          currency: invoice.currency,
        },
        payment: {
          id: txnId || `pay_${invoice.id}`,
          amount: invoice.totalCents,
          currency: invoice.currency.toLowerCase(),
          status: "paid",
          method: "card",
          processor: { name: "helcim" },
        },
        customer: {
          email: invoice.customerEmail,
          name: invoice.customerName,
        },
        source: {
          kind: "invoice",
          invoice: { id: invoice.id, number: invoice.invoiceNumber },
        },
        metadata: {},
      });
    }

    return NextResponse.json({ received: true, invoiceId: invoice.id });
  }

  if (type === "transactionfailed") {
    if (invoice.paymentLinkId) {
      void fireWebhookForLink({
        paymentLinkId: invoice.paymentLinkId,
        eventType: "payment.failed",
        tenant: {
          id: invoice.supplierTenantId,
          slug: "",
          name: "",
          currency: invoice.currency,
        },
        payment: {
          id: txnId || `pay_${invoice.id}`,
          amount: invoice.totalCents,
          currency: invoice.currency.toLowerCase(),
          status: "failed",
          method: "card",
          processor: { name: "helcim" },
        },
        customer: {
          email: invoice.customerEmail,
          name: invoice.customerName,
        },
        source: {
          kind: "invoice",
          invoice: { id: invoice.id, number: invoice.invoiceNumber },
        },
        metadata: {},
      });
    }
    return NextResponse.json({ received: true, note: "payment_failed" });
  }

  if (type === "transactionrefunded") {
    if (invoice.paymentLinkId) {
      void fireWebhookForLink({
        paymentLinkId: invoice.paymentLinkId,
        eventType: "payment.refunded",
        tenant: {
          id: invoice.supplierTenantId,
          slug: "",
          name: "",
          currency: invoice.currency,
        },
        payment: {
          id: txnId || `pay_${invoice.id}`,
          amount: invoice.totalCents,
          currency: invoice.currency.toLowerCase(),
          status: "refunded",
          method: "card",
          processor: { name: "helcim" },
        },
        customer: {
          email: invoice.customerEmail,
          name: invoice.customerName,
        },
        source: {
          kind: "invoice",
          invoice: { id: invoice.id, number: invoice.invoiceNumber },
        },
        metadata: {},
      });
    }
    return NextResponse.json({ received: true, note: "refund_recorded" });
  }

  return NextResponse.json({ received: true, note: `unhandled_type:${type}` });
}

// Health check (GET) for debugging — Helcim only POSTs.
export async function GET() {
  return NextResponse.json({
    endpoint: "helcim",
    ok: true,
    message: "POST only — this is a webhook receiver",
  });
}
