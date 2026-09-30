// ============================================================================
// src/lib/reminders/service.ts
//
// Reservation reminder dispatcher. Two windows:
//   - 24-hour reminder: sent ~24h before booked_for (catches "did I really
//     book this?" cancellations early, frees up the slot)
//   - 2-hour reminder:  sent ~2h before — last-chance reminder
//
// Idempotency: each reservation has reminder_24h_sent_at + reminder_2h_sent_at
// columns. We only send if the column is NULL and the window is current.
//
// Channel choice: prefer WhatsApp if guest has a phone and platform/tenant
// has Meta creds; fall back to SMS otherwise. Both is a future option but
// would 2x cost so we don't do it by default.
//
// Safe to run every 10–15 minutes. Bounded query (50 reservations per tick)
// so it can't blow up even if reminders backlog.
// ============================================================================

import prisma from "@/lib/prisma";
import { sendSms } from "@/lib/sms/client";
import { sendWhatsApp } from "@/lib/whatsapp/client";
import { reservationReminderMessage } from "@/lib/sms/templates";
import { reservationReminderText } from "@/lib/whatsapp/templates";
import { resolveMetaCredentialsForTenant } from "@/lib/whatsapp/credentials";

export type ReminderWindow = "24h" | "2h";

export interface ReminderRunResult {
  window: ReminderWindow;
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  detail: Array<{
    reservationId: string;
    channel: "SMS" | "WHATSAPP" | "NONE";
    ok: boolean;
    error?: string;
  }>;
}

interface RunOptions {
  /** Override "now" for tests. Defaults to new Date(). */
  now?: Date;
  /** Max reservations to process in this run. Default 50. */
  limit?: number;
  /** If true, don't actually send — just report what WOULD be sent. */
  dryRun?: boolean;
}

/**
 * Find reservations whose booked_for is in the target window and which
 * haven't received this window's reminder yet, then send.
 *
 * 24h window:  now + 23.5h <= booked_for < now + 25h    (allows ±1h jitter)
 * 2h window:   now + 1.5h  <= booked_for < now + 2.75h  (allows ±45 min jitter)
 *
 * Wider-than-strict windows mean a single cron tick missed (CI down,
 * deployment, etc.) doesn't permanently skip reminders for that batch.
 */
export async function runReservationReminders(
  window: ReminderWindow,
  opts: RunOptions = {}
): Promise<ReminderRunResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  const dryRun = !!opts.dryRun;

  const ranges = computeWindowRange(window, now);

  // The "not yet sent" filter is a NULL check on the right column.
  const notYetSent =
    window === "24h"
      ? { reminder24hSentAt: null }
      : { reminder2hSentAt: null };

  const reservations = await prisma.reservation.findMany({
    where: {
      status: { in: ["CONFIRMED", "PENDING_DEPOSIT"] },
      bookedFor: { gte: ranges.startInclusive, lt: ranges.endExclusive },
      ...notYetSent,
      // Only reservations with a contact channel
      OR: [{ customerPhone: { not: null } }, { customerEmail: { not: null } }],
    },
    include: {
      location: {
        include: {
          tenant: { select: { id: true, name: true } },
        },
      },
    },
    take: limit,
    orderBy: { bookedFor: "asc" },
  });

  const result: ReminderRunResult = {
    window,
    considered: reservations.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    detail: [],
  };

  for (const r of reservations) {
    if (!r.customerPhone) {
      // Email-only reminders not implemented in v1
      result.skipped++;
      result.detail.push({ reservationId: r.id, channel: "NONE", ok: false, error: "no phone" });
      continue;
    }

    const tenantId = r.location.tenant.id;
    const channel = await pickChannel(tenantId);

    const ctx = {
      restaurantName: r.location.tenant.name,
      customerName: r.customerName,
      partySize: r.partySize,
      bookedFor: r.bookedFor,
    };

    if (dryRun) {
      result.detail.push({ reservationId: r.id, channel, ok: true });
      continue;
    }

    let ok = false;
    let err: string | undefined;

    try {
      if (channel === "WHATSAPP") {
        const wa = await sendWhatsApp({
          kind: "text",
          tenantId,
          to: r.customerPhone,
          body: reservationReminderText(ctx),
          category: `reservation_reminder_${window}`,
        });
        ok = wa.ok;
        err = wa.error;
      } else {
        const sms = await sendSms({
          tenantId,
          to: r.customerPhone,
          body: reservationReminderMessage(ctx),
          category: `reservation_reminder_${window}`,
        });
        ok = sms.ok;
        err = sms.error;
      }

      // Mark sent regardless of provider success — we tried, don't retry the
      // same reminder in 10 min when next cron fires. If sends are failing,
      // operator should see it in logs / status badges and fix root cause.
      await prisma.reservation.update({
        where: { id: r.id },
        data:
          window === "24h"
            ? { reminder24hSentAt: new Date() }
            : { reminder2hSentAt: new Date(), reminderSentAt: new Date() },
      });
    } catch (e: any) {
      err = e?.message || String(e);
    }

    if (ok) result.sent++;
    else result.failed++;
    result.detail.push({ reservationId: r.id, channel, ok, error: err });
  }

  return result;
}

// ----------------------------------------------------------------------------

function computeWindowRange(
  window: ReminderWindow,
  now: Date
): { startInclusive: Date; endExclusive: Date } {
  const HOUR = 60 * 60 * 1000;
  if (window === "24h") {
    // 23.5h to 25h from now — a 1.5h window that survives a missed tick
    return {
      startInclusive: new Date(now.getTime() + 23.5 * HOUR),
      endExclusive: new Date(now.getTime() + 25 * HOUR),
    };
  }
  // 2h window: 1.5h to 2.75h from now (1.25h wide)
  return {
    startInclusive: new Date(now.getTime() + 1.5 * HOUR),
    endExclusive: new Date(now.getTime() + 2.75 * HOUR),
  };
}

/**
 * Pick the best channel for a given tenant.
 *   - WhatsApp if tenant has connected creds OR shared platform creds work
 *   - SMS otherwise (we always have Twilio at the platform level)
 *
 * This intentionally doesn't check guest opt-in flags — the booking flow
 * is treated as implicit consent (you wouldn't book a table if you didn't
 * want to be reminded). For marketing/cold sends we'd respect opt-in.
 */
async function pickChannel(tenantId: string): Promise<"WHATSAPP" | "SMS"> {
  const wa = await resolveMetaCredentialsForTenant(tenantId);
  if (wa) return "WHATSAPP";
  return "SMS";
}
