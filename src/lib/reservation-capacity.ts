// Reservation capacity + duration — Phase E R2.
//
// Two helpers shared by the create endpoint AND future admin tools:
//   1. resolveDurationMinutes(partySize, matrix): party-size → minutes,
//      driven by TenantSettings.partySizeDurationMap. Falls back to
//      DEFAULT_MATRIX when the tenant hasn't customized.
//   2. checkOverbooking(...): given a proposed booking, returns whether
//      total booked capacity across overlapping reservations (plus the
//      new one) would exceed the location's active bookable-table
//      capacity. Enforces the "don't take reservations you can't seat"
//      invariant that the naive create path lacked.
//
// Kept in a lib so the same rules run whether the reservation was
// created by staff, by a walk-in system, or by the public /book flow.

import prisma from "@/lib/prisma";

// Bucket keys mirror the default JSON. New keys added here MUST be added
// to the default map in schema.prisma + the migration too.
const DEFAULT_MATRIX: Record<string, number> = {
  "1-2": 60,
  "3-4": 90,
  "5-6": 120,
  "7+": 150,
};

/**
 * Party-size → minutes. Accepts either a Prisma-loaded JsonValue or a
 * plain object. Missing / malformed maps fall back to DEFAULT_MATRIX so
 * a fresh tenant works before they touch settings.
 */
export function resolveDurationMinutes(
  partySize: number,
  matrixJson: unknown
): number {
  const matrix = normalizeMatrix(matrixJson);
  // Buckets: "1-2", "3-4", "5-6", "7+", or numeric "N" (exact match).
  // Order longest-open-ended-first so "7+" catches large parties.
  const keys = Object.keys(matrix).sort((a, b) => {
    const ao = a.endsWith("+");
    const bo = b.endsWith("+");
    if (ao !== bo) return ao ? 1 : -1;
    return a.localeCompare(b);
  });
  for (const key of keys) {
    if (matchesBucket(key, partySize)) return matrix[key];
  }
  // Nothing matched — use the largest defined value (safest for capacity).
  const max = Math.max(...Object.values(matrix));
  return Number.isFinite(max) && max > 0 ? max : 90;
}

function normalizeMatrix(json: unknown): Record<string, number> {
  if (!json || typeof json !== "object") return DEFAULT_MATRIX;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
  }
  return Object.keys(out).length > 0 ? out : DEFAULT_MATRIX;
}

function matchesBucket(key: string, size: number): boolean {
  if (key.endsWith("+")) {
    const min = Number(key.slice(0, -1));
    return Number.isFinite(min) && size >= min;
  }
  if (key.includes("-")) {
    const [loStr, hiStr] = key.split("-");
    const lo = Number(loStr);
    const hi = Number(hiStr);
    return Number.isFinite(lo) && Number.isFinite(hi) && size >= lo && size <= hi;
  }
  const exact = Number(key);
  return Number.isFinite(exact) && size === exact;
}

// ---------------------------------------------------------------------------
// Overbooking check
// ---------------------------------------------------------------------------

export interface OverbookingCheckInput {
  locationId: string;
  bookedFor: Date;
  durationMinutes: number;
  partySize: number;
  turnBufferMinutes: number;
  /** Set when EDITING an existing reservation so we don't count it. */
  excludeReservationId?: string;
}

export interface OverbookingCheckResult {
  ok: boolean;
  totalCapacity: number;
  bookedDuringWindow: number;
  wouldExceedBy: number;
  reason?: string;
}

/**
 * Reject the reservation if committing it would push booked seats past
 * the location's total capacity at ANY point in its window (including
 * the turn buffer at both ends).
 *
 * Uses the same "sum of partySize for overlapping reservations" strategy
 * as src/lib/booking/availability.ts so the two agree — a slot the
 * public availability call surfaced won't get rejected by this check.
 */
export async function checkOverbooking(
  input: OverbookingCheckInput
): Promise<OverbookingCheckResult> {
  const start = input.bookedFor.getTime();
  const end = start + input.durationMinutes * 60_000;
  const bufferMs = input.turnBufferMinutes * 60_000;

  // Look at reservations whose OWN window overlaps ours — including
  // buffer on both sides so back-to-back parties don't collide.
  //
  // Pull a superset (any reservation on the same day) and filter in
  // memory — tiny volume compared to a day's total bookings, avoids the
  // subquery complexity of trying to compare (bookedFor + duration).
  const dayStart = new Date(input.bookedFor);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [location, sameDayReservations] = await Promise.all([
    prisma.location.findUnique({
      where: { id: input.locationId },
      select: {
        tables: {
          where: { isActive: true, isBookable: true },
          select: { capacity: true },
        },
      },
    }),
    prisma.reservation.findMany({
      where: {
        locationId: input.locationId,
        status: { in: ["CONFIRMED", "PENDING_DEPOSIT", "ARRIVED", "SEATED"] },
        // Cast a wide net — any reservation that STARTS within +/- 6h of
        // the day boundaries. We narrow with in-memory overlap check.
        bookedFor: {
          gte: new Date(dayStart.getTime() - 6 * 60 * 60 * 1000),
          lt: new Date(dayEnd.getTime() + 6 * 60 * 60 * 1000),
        },
        ...(input.excludeReservationId
          ? { id: { not: input.excludeReservationId } }
          : {}),
      },
      select: {
        bookedFor: true,
        partySize: true,
        estimatedDurationMinutes: true,
      },
    }),
  ]);

  if (!location) {
    return {
      ok: false,
      totalCapacity: 0,
      bookedDuringWindow: 0,
      wouldExceedBy: 0,
      reason: "Location not found",
    };
  }
  const totalCapacity = location.tables.reduce(
    (sum, t) => sum + (t.capacity || 0),
    0
  );
  if (totalCapacity === 0) {
    return {
      ok: false,
      totalCapacity: 0,
      bookedDuringWindow: 0,
      wouldExceedBy: input.partySize,
      reason:
        "No bookable tables configured for this location — capacity is zero.",
    };
  }

  // Sum party sizes for any reservation whose [start-buffer, end+buffer]
  // overlaps ours.
  const overlapping = sameDayReservations.filter((r) => {
    const rStart = r.bookedFor.getTime() - bufferMs;
    const rEnd =
      r.bookedFor.getTime() + (r.estimatedDurationMinutes ?? 90) * 60_000 + bufferMs;
    return rStart < end && rEnd > start;
  });
  const bookedDuringWindow = overlapping.reduce((sum, r) => sum + r.partySize, 0);

  const wouldExceedBy = Math.max(
    0,
    bookedDuringWindow + input.partySize - totalCapacity
  );

  return {
    ok: wouldExceedBy === 0,
    totalCapacity,
    bookedDuringWindow,
    wouldExceedBy,
    reason:
      wouldExceedBy > 0
        ? `Overbooked: ${bookedDuringWindow + input.partySize} seats needed, ${totalCapacity} available.`
        : undefined,
  };
}
