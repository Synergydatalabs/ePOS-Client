// ============================================================================
// src/lib/booking/availability.ts
//
// Slot computation for the public booking page. Given a date + party size +
// location, returns the list of bookable times.
//
// Logic:
//   1. Start from the location's operating_hours for that day of week
//      (or default 11:00–22:00 if not set)
//   2. Subtract SpecialDate overrides for that date (closed / custom hours)
//   3. Generate slot grid at booking_slot_minutes intervals
//   4. For each slot, count current reservations overlapping that slot
//   5. Subtract that count from total capacity (sum of seats in active tables)
//   6. A slot is "available" if remaining capacity >= partySize
//   7. Filter out slots that violate booking_lead_minutes (too soon)
//
// This is intentionally conservative — we don't track table-level assignment
// at booking time (that's done by host on arrival). Just "is there ANY way
// to seat a party of N at this time?"
// ============================================================================

import prisma from "@/lib/prisma";

export interface AvailableSlot {
  /** ISO datetime (UTC) at the slot start. */
  startsAt: string;
  /** Display time in the location's timezone, e.g. "6:30 PM". */
  label: string;
  /** Remaining seats after existing bookings. */
  remaining: number;
}

interface HoursForDay {
  open: string;   // "HH:MM" 24h
  close: string;
  closed?: boolean;
}

interface OperatingHoursJson {
  mon?: HoursForDay;
  tue?: HoursForDay;
  wed?: HoursForDay;
  thu?: HoursForDay;
  fri?: HoursForDay;
  sat?: HoursForDay;
  sun?: HoursForDay;
}

const DEFAULT_HOURS: HoursForDay = { open: "11:00", close: "22:00", closed: false };
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export interface ComputeAvailabilityInput {
  locationId: string;
  /** Date the guest wants to book (their local date, e.g. "2026-05-20"). */
  date: string;
  /** Party size — slots below this remaining are filtered out. */
  partySize: number;
}

export async function computeAvailability(
  input: ComputeAvailabilityInput
): Promise<AvailableSlot[]> {
  const loc = await prisma.location.findUnique({
    where: { id: input.locationId },
    include: {
      tables: {
        where: { isActive: true, isBookable: true },
        select: { capacity: true },
      },
      tenant: { select: { timezone: true } },
    },
  });
  if (!loc) return [];

  const timezone = loc.tenant.timezone || "America/Toronto";
  const slotMinutes = loc.bookingSlotMinutes ?? 30;
  const leadMinutes = loc.bookingLeadMinutes ?? 60;
  const maxParty = loc.bookingMaxPartySize ?? 12;

  if (input.partySize > maxParty) return [];

  // Day-of-week for the target date (use noon to avoid TZ edge cases)
  const targetDate = new Date(`${input.date}T12:00:00`);
  const dayKey = DAY_KEYS[targetDate.getDay()];

  // Hours for this day
  const hoursJson = (loc.operatingHours as OperatingHoursJson | null) ?? null;
  let hours: HoursForDay = hoursJson?.[dayKey] ?? DEFAULT_HOURS;

  // Special date override
  const specialDate = await prisma.specialDate.findUnique({
    where: {
      locationId_date: {
        locationId: loc.id,
        date: new Date(`${input.date}T00:00:00`),
      },
    },
  }).catch(() => null);

  if (specialDate) {
    if (specialDate.blockReservations || specialDate.blockOnline) {
      return [];
    }
    if (specialDate.customOpenTime && specialDate.customCloseTime) {
      hours = { open: specialDate.customOpenTime, close: specialDate.customCloseTime };
    }
  }

  if (hours.closed) return [];

  // Build slot grid in location timezone
  const slots = generateSlots(input.date, hours, slotMinutes, timezone);

  // Filter: drop slots earlier than now + leadMinutes
  const earliest = new Date(Date.now() + leadMinutes * 60_000);
  const futureSlots = slots.filter((s) => new Date(s.startsAt) >= earliest);

  if (futureSlots.length === 0) return [];

  // Total capacity = sum of table capacities (no overrides for now)
  const totalCapacity = loc.tables.reduce(
    (sum: number, t: { capacity: number | null }) => sum + (t.capacity || 0),
    0
  );
  if (totalCapacity === 0) return [];

  // Fetch all reservations overlapping the day window so we can count per slot
  const dayStart = new Date(`${input.date}T00:00:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const reservations = await prisma.reservation.findMany({
    where: {
      locationId: loc.id,
      status: { in: ["CONFIRMED", "PENDING_DEPOSIT", "ARRIVED", "SEATED"] },
      bookedFor: { gte: new Date(dayStart.getTime() - 6 * 60 * 60 * 1000), lt: dayEnd },
    },
    select: { bookedFor: true, partySize: true, estimatedDurationMinutes: true },
  });

  // For each slot, compute "how many seats already booked during this slot"
  const result: AvailableSlot[] = [];
  for (const slot of futureSlots) {
    const slotStart = new Date(slot.startsAt).getTime();
    const slotEnd = slotStart + slotMinutes * 60_000;

    const occupied = reservations.reduce(
      (sum: number, r: { bookedFor: Date; partySize: number; estimatedDurationMinutes: number }) => {
        const rStart = r.bookedFor.getTime();
        const rEnd = rStart + (r.estimatedDurationMinutes ?? 90) * 60_000;
        // Overlap test
        if (rEnd <= slotStart || rStart >= slotEnd) return sum;
        return sum + r.partySize;
      },
      0
    );

    const remaining = Math.max(0, totalCapacity - occupied);
    if (remaining >= input.partySize) {
      result.push({ ...slot, remaining });
    }
  }

  return result;
}

// ----------------------------------------------------------------------------

function generateSlots(
  date: string,
  hours: HoursForDay,
  slotMinutes: number,
  timezone: string
): Array<{ startsAt: string; label: string; remaining: number }> {
  const [openH, openM] = hours.open.split(":").map(Number);
  const [closeH, closeM] = hours.close.split(":").map(Number);
  if (Number.isNaN(openH) || Number.isNaN(closeH)) return [];

  // Build slots from open until close - slotMinutes (you can't book the very
  // last slot since it would extend past close)
  const slots: Array<{ startsAt: string; label: string; remaining: number }> = [];

  // We construct the "local" datetime by hand and let JS convert to UTC.
  // For accurate TZ handling we'd use luxon/date-fns-tz; for v1 we live with
  // server-local TZ being close enough (admin and server both run America/Toronto).
  const baseLocal = new Date(`${date}T00:00:00`);
  const openMs = baseLocal.getTime() + (openH * 60 + openM) * 60_000;
  const closeMs = baseLocal.getTime() + (closeH * 60 + closeM) * 60_000;

  for (let t = openMs; t + slotMinutes * 60_000 <= closeMs; t += slotMinutes * 60_000) {
    const d = new Date(t);
    slots.push({
      startsAt: d.toISOString(),
      label: d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      remaining: 0, // filled in by caller
    });
  }
  return slots;
}
