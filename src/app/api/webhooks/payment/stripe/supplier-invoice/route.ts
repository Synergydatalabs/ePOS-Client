// POST /api/webhooks/payment/stripe/supplier-invoice
//
// Inbound Stripe webhook for supplier-issued invoices. Verifies signature
// per-supplier by looking up the invoice from metadata.invoiceId, then
// decrypting that supplier's webhookSecret. Flips paymentStatus to PAID
// on checkout.session.completed. Handles charge.refunded → mark REFUNDED.
//
// Stripe endpoint URL to configure in the supplier's Stripe Dashboard:
//   https://hub.synergydatalabs.com/api/webhooks/payment/stripe/supplier-invoice
//
// Events to subscribe:
//   checkout.session.completed   → mark paid
//   charge.refunded              → mark refunded
//
// Signature verification is per-supplier — we read the raw body first,
// pull invoiceId out of the parsed event's metadata, load the invoice,
// then verify against that supplier's own webhookSecret. If the supplier
// hasn't stored a webhookSecret yet we reject with 400 (signature can't
// be verified against an unknown key).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { kybDecryptJson } from "@/lib/kyb-crypto";
import { buildStripeClient, verifyWebhookEvent } from "@/lib/stripe/client";
import type { StripeCredentials } from "@/lib/stripe/types";
// 2026-10-08: pull acquirer-side references (e.g. UPI RRN + VPA) from each
// successful charge so reconciliation / compliance requests can match our
// invoices against bank + NPCI statements. See extract-provider-reference.ts.
import {
  extractProviderReferenceFromObject,
  fetchChargeForReference,
} from "@/lib/stripe/extract-provider-reference";
import { onSubscriptionInvoicePaid } from "@/lib/supplier-subscriptions";
import { notifyInvoicePaid } from "@/lib/telegram-notify";
// Phase I #3 (2026-09-10): fan out receipt + partner emails from the
// webhook too. `/api/pay/invoice/[id]/paid` runs first for happy-path
// customers who stayed on the page; this branch catches everyone else
// (closed tab, Stripe redirect flow, subscription cron via Stripe, etc).
import {
  sendPaymentReceiptEmail,
  sendPartnerPaymentEmail,
} from "@/lib/email";
import { parseNotifyEmails } from "@/lib/payment-link.service";
// Phase I #6 (2026-09-18): outbound webhook fan-out on payment.failed.
// The /paid route already fires payment.succeeded; failure has no such
// hook so we fire it from here.
import { fireWebhookForLink } from "@/lib/webhooks/dispatch";

export const runtime = "nodejs"; // Buffer + crypto — not Edge

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Read the raw body EXACTLY as Stripe sent it — the HMAC is computed
  // over these bytes and any re-serialization breaks the check.
  const rawBody = await request.text();

  // Peek at the payload — unverified — just to extract the invoiceId from
  // metadata so we can find the supplier and their webhookSecret. If the
  // peek succeeds we then re-verify the signature against that secret; if
  // it fails at verification, we reject.
  let peekedInvoiceId: string | null = null;
  try {
    const peek = JSON.parse(rawBody);
    peekedInvoiceId =
      peek?.data?.object?.metadata?.invoiceId ||
      peek?.data?.object?.payment_intent?.metadata?.invoiceId ||
      null;
    // Some events store metadata on payment_intent (a string id), not the
    // inline object. Chase that too.
    if (!peekedInvoiceId) {
      const meta =
        peek?.data?.object?.metadata || peek?.data?.object?.charge?.metadata;
      if (meta?.invoiceId) peekedInvoiceId = meta.invoiceId;
    }
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  if (!peekedInvoiceId) {
    // Nothing to reconcile. Return 200 so Stripe doesn't retry — this
    // endpoint is our supplier-invoice-only lane; events without invoiceId
    // in metadata are probably from a different flow that hit the wrong
    // URL. Log and move on.
    console.warn("[STRIPE-SUPPLIER-WEBHOOK] no invoiceId in metadata — ignoring");
    return NextResponse.json({ received: true, ignored: true });
  }

  // Look up the invoice + its supplier's Stripe processor row.
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id: peekedInvoiceId },
    select: {
      id: true,
      supplierTenantId: true,
      invoiceNumber: true,
      totalCents: true,
      currency: true,
      paymentStatus: true,
      status: true,
      // Phase I #3: needed for the customer receipt + partner emails
      // fanned out on the paid transition.
      customerName: true,
      customerEmail: true,
      paymentLinkId: true,
      supplier: {
        select: {
          name: true,
          supplierProfile: { select: { displayName: true, contactEmail: true } },
          settings: { select: { brandName: true, brandPrimaryColor: true } },
        },
      },
    },
  });
  if (!invoice) {
    // Same reasoning — 200 to stop retries; we can't do anything with an
    // event for an unknown invoice.
    console.warn(
      `[STRIPE-SUPPLIER-WEBHOOK] invoice ${peekedInvoiceId} not found — ignoring`
    );
    return NextResponse.json({ received: true, ignored: true });
  }

  const processor = await prisma.tenantPaymentProvider.findFirst({
    where: { tenantId: invoice.supplierTenantId, processor: "STRIPE", status: "ACTIVE" },
    select: { credentialsEnc: true },
  });
  const creds = processor?.credentialsEnc
    ? kybDecryptJson<StripeCredentials>(processor.credentialsEnc)
    : null;
  if (!creds?.webhookSecret) {
    console.error(
      `[STRIPE-SUPPLIER-WEBHOOK] supplier ${invoice.supplierTenantId} has no webhookSecret — cannot verify`
    );
    return NextResponse.json(
      { error: "Supplier not configured for webhook verification" },
      { status: 400 }
    );
  }

  // Verify the signature against THAT supplier's webhook secret.
  let event;
  try {
    event = verifyWebhookEvent({
      rawBody,
      signatureHeader: signature,
      webhookSecret: creds.webhookSecret,
    });
  } catch (err: any) {
    console.error(
      "[STRIPE-SUPPLIER-WEBHOOK] signature verification failed:",
      err?.message || err
    );
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
  }

  // ---- Dispatch on event type ----------------------------------------
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as {
          id: string;
          amount_total: number | null;
          currency: string | null;
          payment_intent: string | null;
        };
        if (invoice.paymentStatus === "PAID") {
          // Idempotency — Stripe retries on network failure; a second event
          // for the same invoice is a no-op.
          break;
        }
        const paidAt = new Date();
        // 2026-10-08: for UPI / wallet methods, pull the acquirer-side
        // reference (NPCI RRN for UPI, buyer VPA) by expanding the
        // PaymentIntent → latest_charge. For card charges this just adds
        // "stripe_card_<brand>" to paidMethod. The call is best-effort —
        // if it fails we still mark the invoice PAID.
        let acquirer = { reference: null as string | null, vpa: null as string | null, paidMethod: null as string | null };
        if (typeof session.payment_intent === "string") {
          try {
            const stripe = buildStripeClient(creds);
            const pi = await stripe.paymentIntents.retrieve(
              session.payment_intent,
              { expand: ["latest_charge"] }
            );
            const latest = pi.latest_charge;
            if (latest && typeof latest !== "string") {
              acquirer = extractProviderReferenceFromObject(latest);
            } else if (typeof latest === "string") {
              acquirer = await fetchChargeForReference(creds, latest);
            }
          } catch (err) {
            console.warn(
              "[STRIPE-SUPPLIER-WEBHOOK] acquirer-ref lookup failed:",
              (err as Error).message
            );
          }
        }
        await prisma.supplierInvoice.update({
          where: { id: invoice.id },
          data: {
            paymentStatus: "PAID",
            status: "PAID",
            paidAt,
            paidMethod: acquirer.paidMethod || "STRIPE",
            amountPaidCents: session.amount_total ?? invoice.totalCents,
            // paymentLinkRef was set to session.id at checkout create;
            // now switch it to the payment_intent id which is what refund
            // webhooks arrive with. Both are stripe-owned refs.
            paymentLinkRef:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.id,
            providerReference: acquirer.reference,
            payerVpa: acquirer.vpa,
          },
        });
        // Phase G #1: subscription activation. No-op for one-off invoices.
        await onSubscriptionInvoicePaid(invoice.id, paidAt);
        // Ops Telegram ping. Fire-and-forget — a failed notify must not
        // block Stripe from getting a 200 back.
        void notifyInvoicePaid({
          invoiceNumber: invoice.invoiceNumber,
          amountCents: session.amount_total ?? invoice.totalCents,
          currency: invoice.currency,
          processor: "Stripe",
        });
        // Phase I #3: customer receipt + partner notification emails.
        void fanOutPaidEmails(invoice, session.amount_total ?? invoice.totalCents);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as {
          amount_refunded: number;
          refunded: boolean;
        };
        await prisma.supplierInvoice.update({
          where: { id: invoice.id },
          data: {
            paymentStatus: charge.refunded ? "REFUNDED" : "PARTIAL_REFUND",
            status: charge.refunded ? "REFUNDED" : "PAID",
          },
        });
        break;
      }
      // Phase I #2a (2026-09-08): Elements-flow success event. Same
      // reconciliation as checkout.session.completed but arrives on the
      // PaymentIntent directly since the customer never went through a
      // Checkout Session. Idempotency: no-op if the invoice is already PAID.
      case "payment_intent.succeeded": {
        const intent = event.data.object as {
          id: string;
          amount: number;
          currency: string;
          metadata?: Record<string, string>;
          latest_charge?: string | { id: string; payment_method_details?: unknown };
          charges?: { data?: Array<Record<string, unknown>> };
        };
        if (invoice.paymentStatus === "PAID") break; // already reconciled
        const paidAt = new Date();
        // 2026-10-08: extract acquirer-side references. First try inline
        // (legacy `charges.data[0]` or already-expanded `latest_charge`
        // object); fall back to a fetch when latest_charge is just an id.
        let acquirer = extractProviderReferenceFromObject(intent);
        if (!acquirer.reference && !acquirer.paidMethod) {
          const latest = intent.latest_charge;
          if (typeof latest === "string") {
            acquirer = await fetchChargeForReference(creds, latest);
          } else if (latest && typeof latest === "object") {
            acquirer = extractProviderReferenceFromObject(latest);
          }
        }
        await prisma.supplierInvoice.update({
          where: { id: invoice.id },
          data: {
            paymentStatus: "PAID",
            status: "PAID",
            paidAt,
            paidMethod: acquirer.paidMethod || "STRIPE",
            amountPaidCents: intent.amount ?? invoice.totalCents,
            // Store the PaymentIntent id so refunds land on the right row.
            paymentLinkRef: intent.id,
            providerReference: acquirer.reference,
            payerVpa: acquirer.vpa,
          },
        });
        await onSubscriptionInvoicePaid(invoice.id, paidAt);
        void notifyInvoicePaid({
          invoiceNumber: invoice.invoiceNumber,
          amountCents: intent.amount ?? invoice.totalCents,
          currency: invoice.currency,
          processor: "Stripe",
        });
        // Phase I #3: customer receipt + partner notification emails.
        void fanOutPaidEmails(invoice, intent.amount ?? invoice.totalCents);
        break;
      }
      case "payment_intent.payment_failed":
      case "charge.failed": {
        // The customer is still on the pay page (or Stripe Checkout, if
        // they used the redirect flow) and can retry — nothing to do
        // internally. Phase I #6 (2026-09-18): if the invoice came from
        // an API-created payment link, tell the partner via their
        // webhook so their back-office can flag the order.
        console.warn(
          `[STRIPE-SUPPLIER-WEBHOOK] payment_failed for invoice ${invoice.id}`
        );
        if (invoice.paymentLinkId) {
          const errObj =
            (event.data.object as {
              last_payment_error?: { code?: string; message?: string };
              failure_code?: string;
              failure_message?: string;
            }) || {};
          const failureCode =
            errObj.last_payment_error?.code || errObj.failure_code || null;
          const failureMessage =
            errObj.last_payment_error?.message || errObj.failure_message || null;
          void fireWebhookForLink({
            paymentLinkId: invoice.paymentLinkId,
            eventType: "payment.failed",
            tenant: {
              id: invoice.supplierTenantId,
              slug: "",
              name: invoice.supplier.name,
              brandName: invoice.supplier.settings?.brandName ?? undefined,
              currency: invoice.currency,
            },
            payment: {
              id: `pay_${invoice.id}`,
              amount: invoice.totalCents,
              currency: invoice.currency.toLowerCase(),
              status: "failed",
              method: "card",
              processor: { name: "stripe" },
              failureCode,
              failureMessage,
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
        break;
      }
      default:
        // Silently accept unhandled events — Stripe sends many types.
        break;
    }
    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("[STRIPE-SUPPLIER-WEBHOOK] dispatch error:", err);
    // 500 lets Stripe retry — DB blip is transient.
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Phase I #3 (2026-09-10): shared payment-success email fan-out.
//
// Called from the paid-transition branches of the webhook. Mirrors what
// /api/pay/invoice/[id]/paid does client-side, so whichever path reaches
// the paid transition first delivers the emails. Both call sites gate on
// the previous paymentStatus so double-fires are impossible.
//
// Fire-and-forget: any SES failure is logged, never thrown — a stalled
// mail must not stop Stripe from getting a 200 back and calling the
// webhook done.
// ---------------------------------------------------------------------------
type PaidInvoice = {
  id: string;
  invoiceNumber: string;
  totalCents: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  paymentLinkId: string | null;
  supplier: {
    name: string;
    supplierProfile: { displayName: string | null; contactEmail: string | null } | null;
    settings: { brandName: string | null; brandPrimaryColor: string | null } | null;
  } | null;
};

async function fanOutPaidEmails(invoice: PaidInvoice, amountCents: number) {
  const supplierDisplayName =
    invoice.supplier?.supplierProfile?.displayName ||
    invoice.supplier?.settings?.brandName ||
    invoice.supplier?.name ||
    "Supplier";
  const brandColor = invoice.supplier?.settings?.brandPrimaryColor || "#0F766E";
  const publicBase =
    process.env.NEXT_PUBLIC_APP_URL || "https://hub.synergydatalabs.com";
  const invoiceUrl = `${publicBase.replace(/\/+$/, "")}/pay/invoice/${invoice.id}`;

  // Phase I #9 (2026-09-19): resolve API-generated flag + partner
  // notification recipients in one query. API-created invoices skip
  // BOTH customer receipts AND partner emails — the partner runs its
  // own transactional email off our outbound webhook instead.
  let apiGenerated = false;
  let link: { notifyEmails: string | null; nickname: string } | null = null;
  if (invoice.paymentLinkId) {
    const row = await prisma.supplierPaymentLink.findUnique({
      where: { id: invoice.paymentLinkId },
      select: { apiGenerated: true, notifyEmails: true, nickname: true },
    });
    apiGenerated = !!row?.apiGenerated;
    link = row ? { notifyEmails: row.notifyEmails, nickname: row.nickname } : null;
  }

  // 1) Customer receipt — skipped when API-generated.
  if (invoice.customerEmail && !apiGenerated) {
    try {
      await sendPaymentReceiptEmail({
        to: invoice.customerEmail,
        customerName: invoice.customerName || undefined,
        supplierDisplayName,
        invoiceNumber: invoice.invoiceNumber,
        totalCents: amountCents,
        currency: invoice.currency,
        paidAtIso: new Date().toISOString(),
        brandPrimaryColor: brandColor,
        invoiceUrl,
      });
    } catch (err) {
      console.error(
        `[STRIPE-SUPPLIER-WEBHOOK] ${invoice.id} customer receipt failed:`,
        err
      );
    }
  }

  // 2) Partner emails — skipped when API-generated (webhook handles it).
  if (link && !apiGenerated) {
    try {
      const recipients = parseNotifyEmails(link.notifyEmails);
      if (recipients.length > 0) {
        await sendPartnerPaymentEmail({
          to: recipients,
          linkNickname: link.nickname,
          supplierDisplayName,
          customerName: invoice.customerName || undefined,
          customerEmail: invoice.customerEmail || undefined,
          invoiceNumber: invoice.invoiceNumber,
          totalCents: amountCents,
          currency: invoice.currency,
          paidAtIso: new Date().toISOString(),
          brandPrimaryColor: brandColor,
        });
      }
    } catch (err) {
      console.error(
        `[STRIPE-SUPPLIER-WEBHOOK] ${invoice.id} partner notify failed:`,
        err
      );
    }
  }
}
