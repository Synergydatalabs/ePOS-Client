// =============================================================================
// GET /api/cron/subscriptions-bill — daily subscription billing job.
//
// Runs once a day (Windows Task Scheduler on EC2 hits this URL). Scans
// every ACTIVE SupplierSubscription whose nextBillingAt is due, mints the
// next invoice via the same email path a manual "resend" uses, and marks
// each send in supplier_subscription_reminders so a duplicate cron fire
// (network retry, second scheduler tick) is a no-op.
//
// Auth: same `CRON_SECRET` pattern as the other tap-app crons — request
// must carry ?token=<secret>. This endpoint is public otherwise. On EC2
// the scheduler wraps the URL in an https call with the token.
//
// Response is JSON with per-subscription counters so the Windows Task
// Scheduler log has a paper trail of what fired.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolvePublicOrigin } from "@/lib/public-origin";
import {
  generateDueInvoices,
  cancelSupplierSubscription,
} from "@/lib/supplier-subscriptions";
import {
  sendSupplierInvoiceEmail,
} from "@/lib/email";
import { resolveInvoiceVendor } from "@/lib/supplier-invoices";
import { notifyInvoiceCreated } from "@/lib/telegram-notify";

// Dunning cadence (days AFTER an unpaid subscription invoice was issued):
//   D+3   — first reminder
//   D+7   — second reminder
//   D+14  — final notice; auto-cancel the subscription
// Feel free to tweak these constants without touching the reminder-loop
// logic below — the loop reads them by name.
const REMINDER_DAYS = { REMINDER_D3: 3, REMINDER_D7: 7, FINAL_D14: 14 } as const;

export async function GET(request: NextRequest) {
  // Auth
  const token = request.nextUrl.searchParams.get("token");
  const expected = process.env.CRON_SECRET;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = resolvePublicOrigin(request);
  const now = new Date();

  // Step 1 — mint new invoices for subscriptions whose next billing date
  // has arrived. Each minted invoice needs a first-send email; queue those
  // after generation so the cron response can include per-invoice status.
  const generation = await generateDueInvoices(origin, now);

  const emailResults: Array<{ invoiceId: string; ok: boolean; error?: string }> =
    [];
  for (const invoiceId of generation.minted) {
    try {
      await sendGeneratedInvoiceEmail(invoiceId);
      emailResults.push({ invoiceId, ok: true });
    } catch (err: any) {
      emailResults.push({
        invoiceId,
        ok: false,
        error: err?.message || String(err),
      });
    }
  }

  // Step 2 — dunning: for every ACTIVE / PAST_DUE subscription with an
  // unpaid current-period invoice, send the appropriate reminder if we
  // haven't already sent one at that milestone, and cancel at D+14.
  const dunning = await runDunning(now);

  return NextResponse.json({
    ranAt: now.toISOString(),
    generation: {
      due: generation.processed,
      minted: generation.minted.length,
      skipped: generation.skipped.length,
      errors: generation.errors,
    },
    emails: emailResults,
    dunning,
  });
}

// --- Helpers ----------------------------------------------------------------

/**
 * Load the newly-minted invoice + resolve supplier brand + vendor block,
 * then call sendSupplierInvoiceEmail with the same shape the manual
 * "resend" endpoint uses. Also records a FIRST_SEND row in the reminders
 * table so future dunning loops know the buyer got the initial email.
 */
async function sendGeneratedInvoiceEmail(invoiceId: string): Promise<void> {
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: {
        include: {
          product: {
            select: {
              vendorName: true,
              vendorLogoUrl: true,
              vendorBrandColor: true,
              vendorLegalName: true,
              vendorLicenseText: true,
              vendorStatementDescriptor: true,
              vendorSupportEmail: true,
            },
          },
        },
      },
      subscription: { select: { id: true, cancelToken: true, interval: true } },
    },
  });
  if (!invoice || !invoice.paymentLinkUrl) {
    throw new Error(`Invoice ${invoiceId} missing or has no payment link`);
  }
  const origin = new URL(invoice.paymentLinkUrl).origin;
  const supplier = await prisma.tenant.findUnique({
    where: { id: invoice.supplierTenantId },
    select: {
      name: true,
      supplierProfile: { select: { displayName: true, contactEmail: true } },
      settings: { select: { brandName: true, brandPrimaryColor: true } },
    },
  });
  const displayName =
    supplier?.supplierProfile?.displayName ||
    supplier?.settings?.brandName ||
    supplier?.name ||
    "hub";

  await sendSupplierInvoiceEmail({
    to: invoice.customerEmail,
    cc: invoice.customerCcEmails,
    supplierDisplayName: displayName,
    supplierContactEmail: supplier?.supplierProfile?.contactEmail || null,
    invoiceNumber: invoice.invoiceNumber,
    totalCents: invoice.totalCents,
    currency: invoice.currency,
    itemCount: invoice.items.length,
    paymentLinkUrl: invoice.paymentLinkUrl,
    brandPrimaryColor: supplier?.settings?.brandPrimaryColor || null,
    notes: invoice.notes,
    vendor: resolveInvoiceVendor(invoice.items),
    subscription:
      invoice.subscription && invoice.subscriptionSequence
        ? {
            sequence: invoice.subscriptionSequence,
            interval: invoice.subscription.interval,
            cancelUrl: `${origin}/subscriptions/${invoice.subscription.cancelToken}/cancel`,
          }
        : null,
  });

  await prisma.supplierInvoice.update({
    where: { id: invoice.id },
    data: { emailSentAt: new Date(), emailFailedReason: null },
  });

  if (invoice.subscription?.id) {
    await prisma.supplierSubscriptionReminder.create({
      data: {
        subscriptionId: invoice.subscription.id,
        invoiceId: invoice.id,
        kind: "FIRST_SEND",
      },
    });
  }

  // Ops Telegram ping — one message per cron-generated recurring invoice.
  // Fire-and-forget; a Telegram outage must not stop the cron.
  void notifyInvoiceCreated({
    invoiceNumber: invoice.invoiceNumber,
    amountCents: invoice.totalCents,
    currency: invoice.currency,
    subscription: invoice.subscription
      ? {
          interval: invoice.subscription.interval,
          sequence: invoice.subscriptionSequence || 1,
        }
      : null,
  });
}

/**
 * Dunning loop. For each subscription with an unpaid current-period invoice:
 *   - If D+3 milestone hit and no REMINDER_D3 sent yet → send reminder + log
 *   - If D+7 milestone hit and no REMINDER_D7 sent yet → send reminder + log
 *   - If D+14 milestone hit → send final notice, log FINAL_D14 +
 *     CANCELLATION_NOTICE, cancel the subscription (cancelledBy=SYSTEM_DUNNING)
 *
 * Only the LATEST invoice per subscription is considered — a buyer who
 * pays the current invoice late will re-activate on the next generation.
 */
async function runDunning(now: Date): Promise<{
  processed: number;
  reminders: Array<{ subscriptionId: string; kind: string }>;
  cancelled: Array<{ subscriptionId: string }>;
  errors: Array<{ subscriptionId: string; error: string }>;
}> {
  const subs = await prisma.supplierSubscription.findMany({
    where: {
      status: { in: ["ACTIVE", "PAST_DUE"] },
    },
    include: {
      invoices: {
        where: { paymentStatus: { not: "PAID" }, status: { not: "CANCELLED" } },
        orderBy: { subscriptionSequence: "desc" },
        take: 1,
        select: {
          id: true,
          subscriptionSequence: true,
          sentAt: true,
          paymentStatus: true,
        },
      },
      reminders: {
        select: { invoiceId: true, kind: true },
      },
    },
    take: 500,
  });

  const reminders: Array<{ subscriptionId: string; kind: string }> = [];
  const cancelled: Array<{ subscriptionId: string }> = [];
  const errors: Array<{ subscriptionId: string; error: string }> = [];

  for (const sub of subs) {
    try {
      const currentInv = sub.invoices[0];
      if (!currentInv) continue;
      const ageDays =
        (now.getTime() - currentInv.sentAt.getTime()) / (24 * 60 * 60 * 1000);
      const alreadySent = new Set(
        sub.reminders
          .filter((r) => r.invoiceId === currentInv.id)
          .map((r) => r.kind)
      );

      // D+14 → cancel
      if (ageDays >= REMINDER_DAYS.FINAL_D14 && !alreadySent.has("FINAL_D14")) {
        await sendDunningReminder(sub.id, currentInv.id, "FINAL_D14");
        await cancelSupplierSubscription({
          subscriptionId: sub.id,
          cancelledBy: "SYSTEM_DUNNING",
          cancellationReason: `Auto-cancelled after ${REMINDER_DAYS.FINAL_D14} days unpaid`,
          triggeringInvoiceId: currentInv.id,
        });
        cancelled.push({ subscriptionId: sub.id });
        reminders.push({ subscriptionId: sub.id, kind: "FINAL_D14" });
        continue;
      }

      // D+7
      if (
        ageDays >= REMINDER_DAYS.REMINDER_D7 &&
        !alreadySent.has("REMINDER_D7")
      ) {
        await sendDunningReminder(sub.id, currentInv.id, "REMINDER_D7");
        reminders.push({ subscriptionId: sub.id, kind: "REMINDER_D7" });
        continue;
      }

      // D+3
      if (
        ageDays >= REMINDER_DAYS.REMINDER_D3 &&
        !alreadySent.has("REMINDER_D3")
      ) {
        await sendDunningReminder(sub.id, currentInv.id, "REMINDER_D3");
        // Also flip status to PAST_DUE so the supplier's list highlights
        // it — subsequent generation is blocked by the check-and-mint
        // idempotency until the current invoice is paid.
        if (sub.status !== "PAST_DUE") {
          await prisma.supplierSubscription.update({
            where: { id: sub.id },
            data: { status: "PAST_DUE" },
          });
        }
        reminders.push({ subscriptionId: sub.id, kind: "REMINDER_D3" });
      }
    } catch (err: any) {
      errors.push({
        subscriptionId: sub.id,
        error: err?.message || String(err),
      });
    }
  }

  return {
    processed: subs.length,
    reminders,
    cancelled,
    errors,
  };
}

/**
 * Send a dunning reminder email. Reuses sendSupplierInvoiceEmail — same
 * template, same branding — but the caller records the reminder kind
 * afterwards so we don't spam. In future we can add a purpose-specific
 * template ("Second reminder for invoice X"); for now the buyer just
 * gets the same "Pay X" email again which is what most SaaS billers do.
 */
async function sendDunningReminder(
  subscriptionId: string,
  invoiceId: string,
  kind: "REMINDER_D3" | "REMINDER_D7" | "FINAL_D14" | "CANCELLATION_NOTICE"
): Promise<void> {
  try {
    await sendGeneratedInvoiceEmail(invoiceId);
    // sendGeneratedInvoiceEmail always logs FIRST_SEND — we need to
    // upgrade the row to the specific reminder kind.
    await prisma.supplierSubscriptionReminder.create({
      data: {
        subscriptionId,
        invoiceId,
        kind,
      },
    });
  } catch (err: any) {
    await prisma.supplierSubscriptionReminder.create({
      data: {
        subscriptionId,
        invoiceId,
        kind,
        succeeded: false,
        errorReason: err?.message || String(err),
      },
    });
    throw err;
  }
}
