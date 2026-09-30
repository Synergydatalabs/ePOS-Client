// POST /api/pay/invoice/[invoiceId]/paid
//
// Phase I #3 (2026-09-10) — reliable payment success hook.
//
// The Stripe webhook (webhooks/payment/stripe/supplier-invoice) already
// flips the invoice to PAID and fires Telegram + subscription activation,
// but supplier webhook configuration is a common source of failure — we
// saw notifications going silent because a supplier hadn't subscribed
// their endpoint to `payment_intent.succeeded`, or hadn't stored the
// webhook secret. The pay page (both /l/[slug] and /pay/invoice/[id])
// KNOWS when confirmPayment returns succeeded — so it also hits THIS
// endpoint. We:
//   1. Idempotently mark the invoice PAID (no-op if already paid).
//   2. Fire the same Telegram / subscription hooks the webhook fires.
//   3. Send the customer their receipt email.
//   4. Send partner notification emails if the invoice came from a
//      payment-link that has notifyEmails configured.
//
// The webhook stays in place as a defense-in-depth backup — Stripe's
// retry keeps things eventually-consistent if a customer closes the tab
// before this endpoint hits us.
//
// Auth: none (invoice UUID is the capability, same as GET /api/pay/invoice/[id]).
// Idempotency: every write path checks paymentStatus first — safe to hammer.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { onSubscriptionInvoicePaid } from "@/lib/supplier-subscriptions";
import { notifyInvoicePaid } from "@/lib/telegram-notify";
import {
  sendPaymentReceiptEmail,
  sendPartnerPaymentEmail,
} from "@/lib/email";
import { parseNotifyEmails } from "@/lib/payment-link.service";
// Phase I #5 v2 (2026-09-14): per-link outbound webhook. When the
// invoice was born from a payment link, that link may have webhook
// fields set (URL + template + secret) — this call fires them.
// Fire-and-forget so partner endpoint issues never block the
// customer's success page.
import { fireWebhookForLink } from "@/lib/webhooks/dispatch";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  try {
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        totalCents: true,
        currency: true,
        customerName: true,
        customerEmail: true,
        supplierTenantId: true,
        paymentStatus: true,
        status: true,
        paidAt: true,
        paymentLinkId: true,
        supplier: {
          select: {
            // Phase I #5 (2026-09-14): id/slug/timezone needed by the
            // webhook context builder — the fire-webhook fan-out below
            // reads them.
            id: true,
            slug: true,
            timezone: true,
            name: true,
            supplierProfile: {
              select: { displayName: true, legalName: true, contactEmail: true },
            },
            settings: { select: { brandName: true, brandPrimaryColor: true } },
          },
        },
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status === "CANCELLED") {
      return NextResponse.json({ error: "Invoice cancelled" }, { status: 410 });
    }

    // Idempotency: if the webhook has already handled this we still return
    // 200 so the client success path is happy. We DO NOT re-fire Telegram
    // or emails here — the webhook did that. First writer wins.
    const alreadyPaid = invoice.paymentStatus === "PAID";
    if (!alreadyPaid) {
      const paidAt = new Date();
      await prisma.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          paymentStatus: "PAID",
          status: "PAID",
          paidAt,
          paidMethod: "STRIPE",
          // amountPaidCents left to what the webhook sets on its arrival —
          // if we set it here to totalCents we could overwrite a partial
          // (unusual for card, but safer to defer).
        },
      });
      // Subscription lifecycle — no-op for one-off invoices.
      await onSubscriptionInvoicePaid(invoice.id, paidAt).catch((err) =>
        console.error(`[PAID] ${invoice.id} subscription hook failed:`, err)
      );
    }

    // ---- Fan-out notifications only on the FIRST paid transition -----------
    // (Webhook's own success branch runs the same block. Whichever fires
    // first wins the "not paid → paid" gate.)
    if (!alreadyPaid) {
      const supplierDisplayName =
        invoice.supplier?.supplierProfile?.displayName ||
        invoice.supplier?.settings?.brandName ||
        invoice.supplier?.name ||
        "Supplier";
      const brandColor =
        invoice.supplier?.settings?.brandPrimaryColor || "#0F766E";

      // Phase I #9 (2026-09-19): if the invoice was born from an
      // API-generated payment link, skip OUR customer receipt + partner
      // notification emails — the partner (their site) sends its own.
      // Still fires the outbound webhook (below) so the partner knows.
      let apiGenerated = false;
      let linkData: { notifyEmails: string | null; nickname: string } | null = null;
      if (invoice.paymentLinkId) {
        const link = await prisma.supplierPaymentLink.findUnique({
          where: { id: invoice.paymentLinkId },
          select: { apiGenerated: true, notifyEmails: true, nickname: true },
        });
        apiGenerated = !!link?.apiGenerated;
        linkData = link
          ? { notifyEmails: link.notifyEmails, nickname: link.nickname }
          : null;
      }

      // 1) Ops Telegram — always fires (internal ops notification).
      void notifyInvoicePaid({
        invoiceNumber: invoice.invoiceNumber,
        amountCents: invoice.totalCents,
        currency: invoice.currency,
        processor: "Stripe",
      });

      // 2) Customer receipt — skipped when API-generated (partner handles).
      if (invoice.customerEmail && !apiGenerated) {
        void sendPaymentReceiptEmail({
          to: invoice.customerEmail,
          customerName: invoice.customerName || undefined,
          supplierDisplayName,
          invoiceNumber: invoice.invoiceNumber,
          totalCents: invoice.totalCents,
          currency: invoice.currency,
          paidAtIso: new Date().toISOString(),
          brandPrimaryColor: brandColor,
          invoiceUrl: buildInvoiceUrl(invoice.id),
        }).catch((err) =>
          console.error(`[PAID] ${invoice.id} customer receipt failed:`, err)
        );
      }

      // 3) Partner notification email — skipped when API-generated
      // (partner uses the outbound webhook instead of an email cc).
      if (linkData && !apiGenerated) {
        const recipients = parseNotifyEmails(linkData.notifyEmails);
        if (recipients.length > 0) {
          void sendPartnerPaymentEmail({
            to: recipients,
            linkNickname: linkData.nickname,
            supplierDisplayName,
            customerName: invoice.customerName || undefined,
            customerEmail: invoice.customerEmail || undefined,
            invoiceNumber: invoice.invoiceNumber,
            totalCents: invoice.totalCents,
            currency: invoice.currency,
            paidAtIso: new Date().toISOString(),
            brandPrimaryColor: brandColor,
          }).catch((err) =>
            console.error(`[PAID] ${invoice.id} partner notify failed:`, err)
          );
        }
      }

      // 4) Phase I #5 v2 (2026-09-14): per-link webhook. Fires only
      // for invoices born from a payment link that has webhook fields
      // configured — standalone invoices skip this branch entirely.
      if (invoice.paymentLinkId) {
        void fireWebhookForLink({
          paymentLinkId: invoice.paymentLinkId,
          eventType: "payment.succeeded",
          tenant: {
            id: invoice.supplier?.id ?? invoice.supplierTenantId,
            slug: invoice.supplier?.slug ?? "",
            name: supplierDisplayName,
            brandName: invoice.supplier?.settings?.brandName ?? undefined,
            timezone: invoice.supplier?.timezone ?? undefined,
            currency: invoice.currency,
          },
          payment: {
            id: invoice.id,
            amount: invoice.totalCents,
            currency: invoice.currency,
            status: "succeeded",
            paidAt: new Date(),
            method: "card",
            processor: { name: "stripe" },
          },
          customer: invoice.customerEmail
            ? {
                email: invoice.customerEmail,
                name: invoice.customerName ?? undefined,
              }
            : undefined,
          source: {
            kind: "invoice",
            invoice: {
              id: invoice.id,
              number: invoice.invoiceNumber,
              total: invoice.totalCents,
            },
          },
          // Metadata field will be added on SupplierInvoice + PaymentLink
          // when the partner-configurable metadata bridge lands.
          metadata: {},
        });
      }
    }

    return NextResponse.json({ success: true, alreadyPaid });
  } catch (err: any) {
    console.error(`[PAID] ${invoiceId} error:`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function buildInvoiceUrl(id: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL || "https://hub.synergydatalabs.com";
  return `${base.replace(/\/+$/, "")}/pay/invoice/${id}`;
}
