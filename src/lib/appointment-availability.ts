// Appointment availability engine — Phase E R1.
//
// Given a date + a set of services (Products) + optionally a specific
// technician, return the list of free time slots. Feeds:
//   - POS "New Appointment" slot picker (staff side)
//   - Public /book/[tenantSlug] flow (customer side, Round 3)
//
// Data sources (deliberately reuses existing tables — no new ones):
//   - Location.operatingHours (JSON, same shape as reservation flow)
//   - Location.bookingLeadMinutes (min notice before slot start)
//   - StaffSchedule / StaffTimeOff (new in Round 1 — per-tech overrides)
//   - Product.prepTimeMinutes (existing — service duration in minutes)
//   - OrderItem (technicianId, scheduledStart/End) for existing bookings
//
// Slot resolution:
//   1. Determine total service duration = Σ product.prepTimeMinutes.
//   2. Determine location's open/close for that weekday from
//      Location.operatingHours. Closed day → return [].
//   3. Enumerate candidate slots in SLOT_STEP_MINUTES increments from
//      open→(close - totalDuration).
//   4. For each candidate slot, filter out those that:
//        - Conflict with an existing appointment on the same tech
//        - Fall outside the tech's own working hours for that day
//        - Overlap the tech's time-off
//        - Are earlier than now + bookingLeadMinutes
//   5. "No preference" → aggregate free slots across ALL eligible techs.
//      Load-balance surfacing: sort by tech-with-least-bookings-that-day
//      first so the system spreads work evenly.

import prisma from "@/lib/prisma";

// Grid resolution: slots offered every 15 minutes. Tighter grid = more
// slots to pick from but denser UI. 15 is standard for salon booking.
const SLOT_STEP_MINUTES = 15;

// Fallback per-service duration when a Product doesn't have prepTimeMinutes.
const DEFAULT_SLOT_MINUTES = 30;

// Fallback when Location.operatingHours is null (first-time setup).
// Weekdays 9-5, weekends closed.
const DEFAULT_HOURS: Record<number, { open: string; close: string } | null> = {
  0: null, // Sun
  1: { open: "09:00", close: "17:00" },
  2: { open: "09:00", close: "17:00" },
  3: { open: "09:00", close: "17:00" },
  4: { open: "09:00", close: "17:00" },
  5: { open: "09:00", close: "17:00" },
  6: null, // Sat
};

// Same day-key order as src/lib/booking/availability.ts (reservation engine).
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type DayKey = (typeof DAY_KEYS)[number];

interface HoursForDay {
  open: string;
  close: string;
  closed?: boolean;
}

type OperatingHoursJson = Partial<Record<DayKey, HoursForDay>>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AvailableSlot {
  startTime: string;           // "HH:MM"
  endTime: string;             // "HH:MM"
  technicianId: string;
  technicianName: string;
}

export interface AvailabilityInput {
  tenantId: string;
  locationId: string;
  date: string;                // "YYYY-MM-DD"
  serviceProductIds: string[]; // one or more services being booked together
  technicianId?: string;       // omit for "no preference"
}

export interface AvailabilityResult {
  date: string;
  totalDurationMinutes: number;
  slots: AvailableSlot[];      // sorted by startTime, then by tech-load
  closed: boolean;             // true = location closed that day; slots []
  reason?: string;             // human-readable when slots is empty
}

// ---------------------------------------------------------------------------
// Time helpers — string-based to avoid TZ pitfalls
// ---------------------------------------------------------------------------

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dayOfWeekForISODate(iso: string): number {
  // "2026-08-01" → Date parses as UTC midnight; getUTCDay avoids the
  // one-off-by-a-day bug when the server TZ is west of UTC.
  return new Date(iso + "T00:00:00Z").getUTCDay();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function computeAvailability(
  input: AvailabilityInput
): Promise<AvailabilityResult> {
  const dow = dayOfWeekForISODate(input.date);

  // 1. Business hours for that day — from Location.operatingHours JSON,
  //    same source the reservation engine uses. Falls back to sensible
  //    defaults when the merchant hasn't configured hours yet.
  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
    select: {
      operatingHours: true,
      bookingLeadMinutes: true,
      tenantId: true,
    },
  });
  if (!location || location.tenantId !== input.tenantId) {
    return {
      date: input.date,
      totalDurationMinutes: 0,
      slots: [],
      closed: false,
      reason: "Location not found.",
    };
  }
  const opJson = (location.operatingHours as OperatingHoursJson | null) ?? null;
  const dayKey = DAY_KEYS[dow];
  const configured = opJson?.[dayKey];
  const hours = configured
    ? configured.closed
      ? null
      : { open: configured.open, close: configured.close }
    : DEFAULT_HOURS[dow] ?? null;

  if (!hours) {
    return {
      date: input.date,
      totalDurationMinutes: 0,
      slots: [],
      closed: true,
      reason: "Location is closed on this day.",
    };
  }

  // 2. Total service duration from the selected products.
  let totalDuration = 0;
  if (input.serviceProductIds.length > 0) {
    const products = await prisma.product.findMany({
      where: {
        id: { in: input.serviceProductIds },
        tenantId: input.tenantId,
      },
      select: { id: true, prepTimeMinutes: true },
    });
    for (const p of products) {
      totalDuration += p.prepTimeMinutes ?? DEFAULT_SLOT_MINUTES;
    }
  }
  if (totalDuration === 0) totalDuration = DEFAULT_SLOT_MINUTES;

  const openMin = parseHHMM(hours.open);
  const closeMin = parseHHMM(hours.close);
  if (closeMin - openMin < totalDuration) {
    return {
      date: input.date,
      totalDurationMinutes: totalDuration,
      slots: [],
      closed: false,
      reason:
        "Selected services are longer than the working hours on this day.",
    };
  }

  // 3. Candidate technicians. Explicit pick → one row; "no preference"
  //    → every active POS-staff-or-above membership at this tenant.
  //    (Kitchen staff excluded — they don't do services.)
  const techs = await prisma.membership.findMany({
    where: {
      tenantId: input.tenantId,
      status: "ACTIVE",
      role: { in: ["TENANT_OWNER", "POS_ADMIN", "POS_MANAGER", "POS_STAFF"] },
      ...(input.technicianId ? { id: input.technicianId } : {}),
    },
    select: { id: true, firstName: true, lastName: true },
  });

  if (techs.length === 0) {
    return {
      date: input.date,
      totalDurationMinutes: totalDuration,
      slots: [],
      closed: false,
      reason: "No technicians available.",
    };
  }

  // 4. Per-tech data: schedule for this DOW, time-off active on this
  //    date, existing bookings that day.
  const techIds = techs.map((t) => t.id);
  const dateStart = new Date(input.date + "T00:00:00Z");
  const dateEnd = new Date(input.date + "T23:59:59Z");

  const [schedules, timeOffs, existingItems] = await Promise.all([
    prisma.staffSchedule.findMany({
      where: { membershipId: { in: techIds }, dayOfWeek: dow },
    }),
    prisma.staffTimeOff.findMany({
      where: {
        membershipId: { in: techIds },
        startDate: { lte: dateEnd },
        endDate: { gte: dateStart },
      },
    }),
    // Existing appointment items ON this date for these techs. Only
    // non-cancelled appointment orders count as blockers.
    prisma.orderItem.findMany({
      where: {
        technicianId: { in: techIds },
        order: {
          orderType: "APPOINTMENT",
          appointmentDate: dateStart,
          status: { notIn: ["CANCELLED"] },
        },
      },
      select: {
        technicianId: true,
        scheduledStart: true,
        scheduledEnd: true,
        order: {
          select: { appointmentTime: true },
        },
        product: {
          select: { prepTimeMinutes: true },
        },
      },
    }),
  ]);

  const scheduleByTech = new Map(
    schedules.map((s) => [s.membershipId, s])
  );
  const timeOffTechIds = new Set(timeOffs.map((t) => t.membershipId));

  // Build a per-tech list of {start,end} busy intervals in minutes-since-midnight.
  const busyByTech = new Map<string, Array<{ start: number; end: number }>>();
  for (const item of existingItems) {
    if (!item.technicianId) continue;
    let startMin: number | null = null;
    let endMin: number | null = null;
    if (item.scheduledStart) {
      const s = new Date(item.scheduledStart);
      startMin = s.getUTCHours() * 60 + s.getUTCMinutes();
    } else if (item.order?.appointmentTime) {
      startMin = parseHHMM(item.order.appointmentTime);
    }
    if (item.scheduledEnd) {
      const e = new Date(item.scheduledEnd);
      endMin = e.getUTCHours() * 60 + e.getUTCMinutes();
    } else if (startMin !== null) {
      endMin = startMin + (item.product?.prepTimeMinutes ?? DEFAULT_SLOT_MINUTES);
    }
    if (startMin === null || endMin === null) continue;
    const list = busyByTech.get(item.technicianId) ?? [];
    list.push({ start: startMin, end: endMin });
    busyByTech.set(item.technicianId, list);
  }

  // Earliest allowable slot start = now + lead time (Location config).
  // Turns "no booking within the next hour" into a filter.
  const leadMinutes = location.bookingLeadMinutes ?? 0;
  const earliestMs = Date.now() + leadMinutes * 60_000;

  // 5. Enumerate candidate slot starts and filter per tech.
  const slots: AvailableSlot[] = [];
  const dateMidnightMs = new Date(input.date + "T00:00:00Z").getTime();
  for (const tech of techs) {
    if (timeOffTechIds.has(tech.id)) continue;

    // Effective working window for this tech = intersect business hours
    // with the tech's own schedule for that day.
    const sched = scheduleByTech.get(tech.id);
    let techOpen = openMin;
    let techClose = closeMin;
    if (sched) {
      if (!sched.startTime || !sched.endTime) continue; // off today
      techOpen = Math.max(openMin, parseHHMM(sched.startTime));
      techClose = Math.min(closeMin, parseHHMM(sched.endTime));
      if (techClose - techOpen < totalDuration) continue;
    }

    const busy = busyByTech.get(tech.id) ?? [];
    const techName =
      [tech.firstName, tech.lastName].filter(Boolean).join(" ").trim() ||
      "Unnamed";

    for (let t = techOpen; t + totalDuration <= techClose; t += SLOT_STEP_MINUTES) {
      const slotEnd = t + totalDuration;
      // Lead-time gate: reject slots that start before now+lead.
      // Uses UTC arithmetic — engine treats input.date as a UTC date so
      // the same math works regardless of the server's local TZ.
      const slotStartMs = dateMidnightMs + t * 60_000;
      if (slotStartMs < earliestMs) continue;
      const conflicts = busy.some(
        (b) => Math.max(b.start, t) < Math.min(b.end, slotEnd)
      );
      if (conflicts) continue;
      slots.push({
        startTime: toHHMM(t),
        endTime: toHHMM(slotEnd),
        technicianId: tech.id,
        technicianName: techName,
      });
    }
  }

  // 6. For "no preference" surfacing, load-balance: sort by (startTime,
  //    then tech-load ascending). Tech-load = number of busy intervals
  //    already scheduled today. Spreads work evenly across techs.
  if (!input.technicianId) {
    const loadByTech = new Map<string, number>();
    for (const t of techs) {
      loadByTech.set(t.id, (busyByTech.get(t.id) ?? []).length);
    }
    slots.sort((a, b) => {
      if (a.startTime !== b.startTime)
        return a.startTime.localeCompare(b.startTime);
      const la = loadByTech.get(a.technicianId) ?? 0;
      const lb = loadByTech.get(b.technicianId) ?? 0;
      return la - lb;
    });
  } else {
    slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  return {
    date: input.date,
    totalDurationMinutes: totalDuration,
    slots,
    closed: false,
    reason: slots.length === 0 ? "Fully booked." : undefined,
  };
}
