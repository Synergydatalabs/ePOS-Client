// Appointment reminder dispatcher — Phase E R4.
//
// Mirrors src/lib/reminders/service.ts (reservations) but for
// Order rows with orderType=APPOINTMENT. Three windows: 24h / 12h / 4h.
// Each window is idempotent — the corresponding reminder_XXh_sent_at
// column gets stamped so a re-run in the same tick won't double-send.
//
// Channel choice: SMS via existing sendSms() — customer QR pay + POS
// SMS both use it. Adds email in a future round when appointments have
// email addresses reliably.
//
// Includes the tenant's cancellation window in the reminder body so the
// customer knows when they can still cancel with a refund.

import prisma from "@/lib/prisma";
import { sendSms } from "@/lib/sms/client";

export type ReminderWindow = "24h" | "12h" | "4h";

export interface AppointmentReminderResult {
  window: ReminderWindow;
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  detail: Array<{
    orderId: string;
    ok: boolean;
    error?: string;
  }>;
}

interface RunOptions {
  now?: Date;
  limit?: number;
  dryRun?: boolean;
}

// Window definitions in minutes-before-appointment. The scanner picks
// rows whose appointment is between (window - tolerance) and window
// minutes from now — a run every 10-15 min catches every appointment
// once per window without over-firing.
const WINDOWS: Record<ReminderWindow, { minutesBefore: number; tolerance: number; column: keyof AppointmentReminderTouch }> = {
  "24h": { minutesBefore: 24 * 60, tolerance: 30, column: "reminder24hSentAt" },
  "12h": { minutesBefore: 12 * 60, tolerance: 30, column: "reminder12hSentAt" },
  "4h":  { minutesBefore:  4 * 60, tolerance: 30, column: "reminder4hSentAt"  },
};

// Type alias for the columns we may stamp — helps TS see the update fields.
type AppointmentReminderTouch = {
  reminder24hSentAt: Date | null;
  reminder12hSentAt: Date | null;
  reminder4hSentAt: Date | null;
};

export async function runAppointmentReminders(
  window: ReminderWindow,
  opts: RunOptions = {}
): Promise<AppointmentReminderResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 100;
  const dryRun = !!opts.dryRun;

  const w = WINDOWS[window];

  // Appointment scheduled time is stored as Date (appointmentDate) +
  // "HH:MM" string (appointmentTime). We reconstruct the full DateTime
  // for each row in memory — the DB doesn't need to be smart about it,
  // and the day/time index gives a small candidate set.
  //
  // Fetch superset: any appointment in the next 25 hours (biggest window
  // + safety margin). Filter to the exact window in memory.
  const horizonEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const horizonStart = new Date(now.getTime() + 30 * 60 * 1000); // don't reminder if within 30 min

  const candidates = await prisma.order.findMany({
    where: {
      orderType: "APPOINTMENT",
      status: { notIn: ["CANCELLED", "COMPLETED"] },
      appointmentDate: {
        // Date column — bounds by day is enough to keep set small.
        gte: new Date(new Date(now).setUTCHours(0, 0, 0, 0)),
        lte: horizonEnd,
      },
      [w.column]: null,
      // Must have a phone — that's how we reach them.
      customerPhone: { not: null },
    },
    select: {
      id: true,
      orderNumber: true,
      appointmentDate: true,
      appointmentTime: true,
      customerName: true,
      customerPhone: true,
      location: {
        select: {
          tenantId: true,
          name: true,
          tenant: {
            select: {
              name: true,
              settings: { select: { cancellationWindowMinutes: true } },
            },
          },
        },
      },
    },
    take: limit,
  });

  const result: AppointmentReminderResult = {
    window,
    considered: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    detail: [],
  };

  for (const c of candidates) {
    // Combine appointmentDate + appointmentTime into a scheduled Date.
    // appointmentTime is "HH:MM" — treat as location-local; we store
    // appointmentDate at UTC midnight so adding minutes gives the right
    // wall-clock moment for the scheduled slot.
    if (!c.appointmentDate || !c.appointmentTime) {
      result.skipped++;
      continue;
    }
    const [hh, mm] = c.appointmentTime.split(":").map(Number);
    const scheduled = new Date(c.appointmentDate);
    scheduled.setUTCHours(hh, mm, 0, 0);
    const minutesUntil = (scheduled.getTime() - now.getTime()) / 60_000;

    // Skip if outside the window (candidate list is coarse — this is
    // the precise filter).
    if (
      minutesUntil > w.minutesBefore + w.tolerance ||
      minutesUntil < w.minutesBefore - w.tolerance
    ) {
      result.skipped++;
      continue;
    }

    if (dryRun) {
      result.sent++;
      result.detail.push({ orderId: c.id, ok: true });
      continue;
    }

    try {
      const tenantName = c.location?.tenant.name || "Your appointment";
      const cancelWindow =
        c.location?.tenant.settings?.cancellationWindowMinutes ?? 30;
      const whenLabel = scheduled.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      // Cancellation nudge — makes the reminder actionable, and reduces
      // no-shows because customers know they can cancel cleanly.
      const cancelHint =
        cancelWindow > 0
          ? ` Reply CANCEL up to ${cancelWindow} min before to cancel.`
          : "";
      const body =
        `${tenantName}: reminder — your ${window === "24h" ? "24-hour" : window === "12h" ? "12-hour" : "4-hour"} reminder for your appointment ${whenLabel}.` +
        cancelHint;

      const res = await sendSms({
        tenantId: c.location!.tenantId,
        to: c.customerPhone!,
        body,
        category: "appointment_reminder",
      });

      if (res.ok) {
        await prisma.order.update({
          where: { id: c.id },
          data: { [w.column]: new Date() },
        });
        result.sent++;
        result.detail.push({ orderId: c.id, ok: true });
      } else {
        result.failed++;
        result.detail.push({ orderId: c.id, ok: false, error: res.error });
      }
    } catch (err: any) {
      result.failed++;
      result.detail.push({ orderId: c.id, ok: false, error: err?.message });
    }
  }

  return result;
}
