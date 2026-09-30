/**
 * Fare Calculation Engine
 *
 * Computes ride fare estimates (before booking) and final fares (at trip completion).
 * All monetary values are in cents (CAD). Uses the fare_rules table for pricing config.
 *
 * Supports:
 *  - Base fare + per-km + per-minute charges
 *  - Waiting time charges (with configurable free minutes)
 *  - Long-distance reduced rate after threshold
 *  - Peak-hour / night / weekend / holiday multipliers
 *  - Zone surcharges (flat or percentage)
 *  - Promo code discounts (percentage, flat, or free ride)
 *  - HST/GST tax calculation
 *  - Minimum fare enforcement
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Breakdown of every fare component returned to the caller. */
export interface FareBreakdown {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  waitingFare: number;
  surcharge: number;
  surchargeLabel: string | null;
  subtotalBeforeMultiplier: number;
  peakMultiplier: number;
  subtotalAfterMultiplier: number;
  promoDiscount: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  minimumApplied: boolean;
  currency: string;
  /** The fare_rule id that was used */
  fareRuleId: string;
  /** Estimated distance in km (may be null for final calc) */
  estimatedDistanceKm: number | null;
  /** Estimated duration in minutes */
  estimatedDurationMinutes: number | null;
}

/** Parameters for a pre-booking estimate. */
export interface EstimateParams {
  tenantId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  vehicleType?: string;
  /** ISO date-time string; defaults to now */
  requestedAt?: string;
  promoCode?: string | null;
  /** Optional pre-resolved zone surcharge */
  zoneSurcharge?: { type: "flat" | "percentage"; amount: number; label: string } | null;
}

/** Row shape returned from the fare_rules table. */
interface FareRule {
  id: string;
  base_fare: number;
  minimum_fare: number;
  per_km_rate: number;
  per_minute_rate: number;
  booking_fee: number;
  waiting_rate_per_minute: number;
  free_waiting_minutes: number;
  long_distance_km: number;
  long_distance_rate: number;
  peak_multiplier: number;
  peak_hours: PeakHourEntry[] | null;
  night_multiplier: number;
  night_start: string;
  night_end: string;
  weekend_multiplier: number;
  holiday_multiplier: number;
  cancellation_fee: number;
  free_cancel_minutes: number;
  tax_included: boolean;
}

interface PeakHourEntry {
  start: string; // "HH:mm"
  end: string;
  multiplier: number;
}

/** Promo code row shape. */
interface PromoRow {
  id: string;
  discount_type: string;
  discount_value: number;
  max_discount: number | null;
  min_fare: number;
  current_uses: number;
  max_uses: number | null;
  max_uses_per_user: number;
  first_ride_only: boolean;
  valid_until: Date | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canadian HST rate (Ontario). Adjust per province if needed. */
const HST_RATE = 0.13;

/** Earth radius in km for Haversine calculation. */
const EARTH_RADIUS_KM = 6371;

// ---------------------------------------------------------------------------
// Haversine
// ---------------------------------------------------------------------------

/**
 * Calculates the great-circle distance between two coordinates using the
 * Haversine formula.
 *
 * @param lat1 - Latitude of point A (degrees)
 * @param lng1 - Longitude of point A (degrees)
 * @param lat2 - Latitude of point B (degrees)
 * @param lng2 - Longitude of point B (degrees)
 * @returns Distance in kilometres
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// ---------------------------------------------------------------------------
// Fare rule loader
// ---------------------------------------------------------------------------

/**
 * Loads the applicable fare rule for a tenant + vehicle type.
 * Falls back to the default rule, then to the first active rule.
 */
async function loadFareRule(
  tenantId: string,
  vehicleType: string
): Promise<FareRule> {
  // Try exact vehicle-type match first
  const rows: FareRule[] = await prisma.$queryRaw`
    SELECT id, base_fare, minimum_fare, per_km_rate, per_minute_rate, booking_fee,
           waiting_rate_per_minute, free_waiting_minutes,
           long_distance_km, long_distance_rate,
           peak_multiplier, peak_hours,
           night_multiplier, night_start, night_end,
           weekend_multiplier, holiday_multiplier,
           cancellation_fee, free_cancel_minutes,
           tax_included
    FROM fare_rules
    WHERE tenant_id = ${tenantId}::uuid
      AND vehicle_type = ${vehicleType}
      AND is_active = true
    ORDER BY is_default DESC
    LIMIT 1
  `;

  if (rows.length > 0) return rows[0];

  // Fallback: default rule for tenant (any vehicle type)
  const defaults: FareRule[] = await prisma.$queryRaw`
    SELECT id, base_fare, minimum_fare, per_km_rate, per_minute_rate, booking_fee,
           waiting_rate_per_minute, free_waiting_minutes,
           long_distance_km, long_distance_rate,
           peak_multiplier, peak_hours,
           night_multiplier, night_start, night_end,
           weekend_multiplier, holiday_multiplier,
           cancellation_fee, free_cancel_minutes,
           tax_included
    FROM fare_rules
    WHERE tenant_id = ${tenantId}::uuid
      AND is_default = true
      AND is_active = true
    LIMIT 1
  `;

  if (defaults.length > 0) return defaults[0];

  // Last resort: any active rule
  const any: FareRule[] = await prisma.$queryRaw`
    SELECT id, base_fare, minimum_fare, per_km_rate, per_minute_rate, booking_fee,
           waiting_rate_per_minute, free_waiting_minutes,
           long_distance_km, long_distance_rate,
           peak_multiplier, peak_hours,
           night_multiplier, night_start, night_end,
           weekend_multiplier, holiday_multiplier,
           cancellation_fee, free_cancel_minutes,
           tax_included
    FROM fare_rules
    WHERE tenant_id = ${tenantId}::uuid
      AND is_active = true
    ORDER BY created_at
    LIMIT 1
  `;

  if (any.length > 0) return any[0];

  throw new Error(`No active fare rule found for tenant ${tenantId}`);
}

// ---------------------------------------------------------------------------
// Time-of-day helpers
// ---------------------------------------------------------------------------

/**
 * Parse an "HH:mm" string into total minutes since midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Determine the active time-based multiplier for a given Date.
 * Priority: peak hours entry > night > weekend > 1.0
 */
function getTimeMultiplier(rule: FareRule, at: Date): number {
  const minuteOfDay = at.getHours() * 60 + at.getMinutes();
  const dayOfWeek = at.getDay(); // 0=Sun, 6=Sat

  // Check peak hours first (highest priority)
  if (rule.peak_hours && Array.isArray(rule.peak_hours)) {
    for (const peak of rule.peak_hours) {
      const start = parseTimeToMinutes(peak.start);
      const end = parseTimeToMinutes(peak.end);
      if (start <= end) {
        if (minuteOfDay >= start && minuteOfDay < end) {
          return Number(peak.multiplier);
        }
      } else {
        // Spans midnight
        if (minuteOfDay >= start || minuteOfDay < end) {
          return Number(peak.multiplier);
        }
      }
    }
  }

  // Night multiplier
  const nightMultiplier = Number(rule.night_multiplier);
  if (nightMultiplier > 1) {
    const nightStart = parseTimeToMinutes(rule.night_start);
    const nightEnd = parseTimeToMinutes(rule.night_end);
    if (nightStart > nightEnd) {
      // e.g. 22:00 - 06:00
      if (minuteOfDay >= nightStart || minuteOfDay < nightEnd) {
        return nightMultiplier;
      }
    } else {
      if (minuteOfDay >= nightStart && minuteOfDay < nightEnd) {
        return nightMultiplier;
      }
    }
  }

  // Weekend multiplier
  const weekendMultiplier = Number(rule.weekend_multiplier);
  if (weekendMultiplier > 1 && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return weekendMultiplier;
  }

  return 1.0;
}

// ---------------------------------------------------------------------------
// Promo code helpers
// ---------------------------------------------------------------------------

/**
 * Validate and load a promo code. Returns null if invalid.
 */
async function loadPromoCode(
  tenantId: string,
  code: string
): Promise<PromoRow | null> {
  const rows: PromoRow[] = await prisma.$queryRaw`
    SELECT id, discount_type, discount_value, max_discount, min_fare,
           current_uses, max_uses, max_uses_per_user, first_ride_only,
           valid_until
    FROM promo_codes
    WHERE tenant_id = ${tenantId}::uuid
      AND UPPER(code) = UPPER(${code})
      AND is_active = true
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const promo = rows[0];

  // Check expiry
  if (promo.valid_until && new Date(promo.valid_until) < new Date()) {
    return null;
  }

  // Check max uses
  if (promo.max_uses !== null && promo.current_uses >= promo.max_uses) {
    return null;
  }

  return promo;
}

/**
 * Calculate the discount amount in cents for a given promo code.
 */
function calculatePromoDiscount(promo: PromoRow, subtotal: number): number {
  if (subtotal < promo.min_fare) return 0;

  let discount = 0;
  switch (promo.discount_type) {
    case "percentage":
      // discount_value stored as basis-points-like: 1000 = 10%
      discount = Math.round((subtotal * promo.discount_value) / 10000);
      break;
    case "flat":
      discount = promo.discount_value;
      break;
    case "free_ride":
      discount = subtotal;
      break;
    default:
      return 0;
  }

  // Apply cap if set
  if (promo.max_discount !== null && discount > promo.max_discount) {
    discount = promo.max_discount;
  }

  // Never discount more than the subtotal
  return Math.min(discount, subtotal);
}

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

/**
 * Shared fare computation used by both estimate and final calculation.
 */
function computeFare(
  rule: FareRule,
  distanceKm: number,
  durationMinutes: number,
  waitingMinutes: number,
  multiplier: number,
  surcharge: { type: "flat" | "percentage"; amount: number; label: string } | null,
  promoDiscount: number
): FareBreakdown {
  // --- Base fare (flag drop + booking fee) ---
  const baseFare = Number(rule.base_fare) + Number(rule.booking_fee);

  // --- Distance fare ---
  const longDistKm = Number(rule.long_distance_km);
  const perKmRate = Number(rule.per_km_rate);
  const longDistRate = Number(rule.long_distance_rate);

  let distanceFare: number;
  if (distanceKm <= longDistKm) {
    distanceFare = Math.round(distanceKm * perKmRate);
  } else {
    const normalPortion = longDistKm * perKmRate;
    const longPortion = (distanceKm - longDistKm) * longDistRate;
    distanceFare = Math.round(normalPortion + longPortion);
  }

  // --- Time fare ---
  const timeFare = Math.round(durationMinutes * Number(rule.per_minute_rate));

  // --- Waiting fare ---
  const freeWaiting = Number(rule.free_waiting_minutes);
  const chargeableWaiting = Math.max(0, waitingMinutes - freeWaiting);
  const waitingFare = Math.round(
    chargeableWaiting * Number(rule.waiting_rate_per_minute)
  );

  // --- Subtotal before multiplier ---
  const subtotalBeforeMultiplier = baseFare + distanceFare + timeFare + waitingFare;

  // --- Apply time multiplier (peak / night / weekend) ---
  const subtotalAfterMultiplier = Math.round(subtotalBeforeMultiplier * multiplier);

  // --- Zone surcharge ---
  let surchargeAmount = 0;
  let surchargeLabel: string | null = null;
  if (surcharge) {
    surchargeLabel = surcharge.label;
    if (surcharge.type === "flat") {
      surchargeAmount = surcharge.amount;
    } else if (surcharge.type === "percentage") {
      // surcharge.amount is in basis points (e.g. 500 = 5%)
      surchargeAmount = Math.round(
        (subtotalAfterMultiplier * surcharge.amount) / 10000
      );
    }
  }

  // --- Subtotal after surcharge ---
  let subtotal = subtotalAfterMultiplier + surchargeAmount;

  // --- Apply promo discount ---
  const clampedDiscount = Math.min(promoDiscount, subtotal);
  subtotal -= clampedDiscount;

  // --- Enforce minimum fare ---
  const minimumFare = Number(rule.minimum_fare);
  let minimumApplied = false;
  if (subtotal < minimumFare) {
    subtotal = minimumFare;
    minimumApplied = true;
  }

  // --- Tax (HST for Canadian context) ---
  let taxAmount = 0;
  if (!rule.tax_included) {
    taxAmount = Math.round(subtotal * HST_RATE);
  }

  const total = subtotal + taxAmount;

  return {
    baseFare,
    distanceFare,
    timeFare,
    waitingFare,
    surcharge: surchargeAmount,
    surchargeLabel,
    subtotalBeforeMultiplier,
    peakMultiplier: multiplier,
    subtotalAfterMultiplier,
    promoDiscount: clampedDiscount,
    subtotal,
    taxAmount,
    total,
    minimumApplied,
    currency: "CAD",
    fareRuleId: rule.id,
    estimatedDistanceKm: null,
    estimatedDurationMinutes: null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate a fare estimate before booking.
 *
 * Uses the Haversine straight-line distance multiplied by a road-factor
 * (1.3x) to approximate actual driving distance, and an average speed
 * assumption to estimate duration.
 *
 * @param params - Pickup/dropoff coords, vehicle type, optional promo code
 * @returns FareBreakdown with estimated totals
 */
export async function calculateEstimate(
  params: EstimateParams
): Promise<FareBreakdown> {
  const vehicleType = params.vehicleType ?? "sedan";
  const rule = await loadFareRule(params.tenantId, vehicleType);

  // Straight-line distance with road factor
  const straightLineKm = haversineDistanceKm(
    params.pickupLat,
    params.pickupLng,
    params.dropoffLat,
    params.dropoffLng
  );
  const ROAD_FACTOR = 1.3;
  const estimatedDistanceKm = Math.round(straightLineKm * ROAD_FACTOR * 100) / 100;

  // Estimate duration based on average city driving speed (30 km/h)
  const AVG_SPEED_KMH = 30;
  const estimatedDurationMinutes = Math.round(
    (estimatedDistanceKm / AVG_SPEED_KMH) * 60
  );

  // Determine time multiplier
  const requestedAt = params.requestedAt
    ? new Date(params.requestedAt)
    : new Date();
  const multiplier = getTimeMultiplier(rule, requestedAt);

  // Resolve promo discount
  let promoDiscount = 0;
  let promo: PromoRow | null = null;
  if (params.promoCode) {
    promo = await loadPromoCode(params.tenantId, params.promoCode);
  }

  // We need to compute a preliminary subtotal to calculate percentage promos
  if (promo) {
    const prelimBreakdown = computeFare(
      rule,
      estimatedDistanceKm,
      estimatedDurationMinutes,
      0, // no waiting for estimates
      multiplier,
      params.zoneSurcharge ?? null,
      0 // no discount yet
    );
    promoDiscount = calculatePromoDiscount(promo, prelimBreakdown.subtotal);
  }

  const breakdown = computeFare(
    rule,
    estimatedDistanceKm,
    estimatedDurationMinutes,
    0, // no waiting for estimates
    multiplier,
    params.zoneSurcharge ?? null,
    promoDiscount
  );

  breakdown.estimatedDistanceKm = estimatedDistanceKm;
  breakdown.estimatedDurationMinutes = estimatedDurationMinutes;

  return breakdown;
}

/** Shape of a completed trip row used for final calculation. */
export interface TripForFinalCalc {
  id: string;
  tenant_id: string;
  vehicle_type?: string;
  actual_distance_km: number;
  actual_duration_minutes: number;
  /** Total minutes driver waited before the ride started */
  waiting_minutes?: number;
  started_at: Date | string;
  /** Pre-resolved zone surcharge (optional) */
  zone_surcharge?: { type: "flat" | "percentage"; amount: number; label: string } | null;
  promo_code?: string | null;
  tip_amount?: number;
}

/**
 * Calculate the final fare after a trip completes.
 *
 * Uses actual distance, actual duration, and real waiting time from the trip.
 *
 * @param trip - The completed trip data with actual metrics
 * @returns FareBreakdown with final totals
 */
export async function calculateFinal(
  trip: TripForFinalCalc
): Promise<FareBreakdown> {
  const vehicleType = trip.vehicle_type ?? "sedan";
  const rule = await loadFareRule(trip.tenant_id, vehicleType);

  const startedAt =
    trip.started_at instanceof Date
      ? trip.started_at
      : new Date(trip.started_at);

  const multiplier = getTimeMultiplier(rule, startedAt);
  const waitingMinutes = trip.waiting_minutes ?? 0;

  // Resolve promo
  let promoDiscount = 0;
  let promo: PromoRow | null = null;
  if (trip.promo_code) {
    promo = await loadPromoCode(trip.tenant_id, trip.promo_code);
  }

  if (promo) {
    const prelimBreakdown = computeFare(
      rule,
      Number(trip.actual_distance_km),
      Number(trip.actual_duration_minutes),
      waitingMinutes,
      multiplier,
      trip.zone_surcharge ?? null,
      0
    );
    promoDiscount = calculatePromoDiscount(promo, prelimBreakdown.subtotal);
  }

  const breakdown = computeFare(
    rule,
    Number(trip.actual_distance_km),
    Number(trip.actual_duration_minutes),
    waitingMinutes,
    multiplier,
    trip.zone_surcharge ?? null,
    promoDiscount
  );

  breakdown.estimatedDistanceKm = Number(trip.actual_distance_km);
  breakdown.estimatedDurationMinutes = Number(trip.actual_duration_minutes);

  return breakdown;
}

/**
 * Look up the cancellation fee from the fare rule.
 *
 * @returns Cancellation fee in cents, or 0 if within the free-cancel window
 */
export async function getCancellationFee(
  tenantId: string,
  vehicleType: string,
  minutesSinceBooking: number
): Promise<number> {
  const rule = await loadFareRule(tenantId, vehicleType);
  if (minutesSinceBooking <= Number(rule.free_cancel_minutes)) {
    return 0;
  }
  return Number(rule.cancellation_fee);
}
