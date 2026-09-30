/**
 * Trip Lifecycle Service
 *
 * Manages the full lifecycle of a cab trip: creation, status transitions,
 * starting the meter, completing the ride with final fare, and cancellations.
 *
 * State machine:
 *   REQUESTED -> SEARCHING -> ASSIGNED -> DRIVER_EN_ROUTE -> DRIVER_ARRIVED
 *   -> IN_PROGRESS -> COMPLETED
 *
 * Any state can transition to CANCELLED (with rules).
 * SEARCHING can transition to NO_DRIVERS.
 *
 * All status changes are recorded in trip_status_log for audit.
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { calculateEstimate, calculateFinal, getCancellationFee } from "./fare-calculator";
import type { FareBreakdown } from "./fare-calculator";
import { dispatchTrip } from "./dispatch-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid trip status values. */
export type TripStatus =
  | "REQUESTED"
  | "SEARCHING"
  | "ASSIGNED"
  | "DRIVER_EN_ROUTE"
  | "DRIVER_ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_DRIVERS";

/** Parameters for creating a new trip. */
export interface CreateTripParams {
  tenantId: string;
  locationId?: string | null;

  /** Customer info */
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerMembershipId?: string | null;

  /** Pickup */
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  pickupNotes?: string | null;

  /** Dropoff */
  dropoffAddress?: string | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  dropoffNotes?: string | null;

  /** Ride options */
  vehicleType?: string;
  rideType?: string;
  passengerCount?: number;
  luggage?: boolean;
  paymentMethod?: string;

  /** Scheduling */
  isScheduled?: boolean;
  scheduledAt?: string | null;

  /** Promo */
  promoCode?: string | null;

  /** Dispatch mode */
  dispatchMode?: "auto" | "manual";
}

/** Filters for trip history queries. */
export interface TripHistoryFilters {
  status?: TripStatus;
  driverProfileId?: string;
  customerPhone?: string;
  dateFrom?: string;
  dateTo?: string;
  rideType?: string;
  page?: number;
  pageSize?: number;
}

/** Paginated trip list result. */
export interface TripListResult {
  trips: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Trip row shape from the database. */
interface TripRow {
  id: string;
  tenant_id: string;
  trip_number: string;
  status: TripStatus;
  driver_profile_id: string | null;
  vehicle_id: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  requested_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  actual_distance_km: number | null;
  actual_duration_minutes: number | null;
  estimated_fare: number;
  promo_code: string | null;
  ride_type: string;
  dispatch_attempts: number;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Status transition map
// ---------------------------------------------------------------------------

/**
 * Allowed status transitions. Each key maps to the set of statuses it can
 * transition to.
 */
const VALID_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  REQUESTED: ["SEARCHING", "ASSIGNED", "CANCELLED"],
  SEARCHING: ["ASSIGNED", "NO_DRIVERS", "CANCELLED"],
  ASSIGNED: ["DRIVER_EN_ROUTE", "CANCELLED"],
  DRIVER_EN_ROUTE: ["DRIVER_ARRIVED", "CANCELLED"],
  DRIVER_ARRIVED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_DRIVERS: ["SEARCHING", "ASSIGNED", "CANCELLED"],
};

// ---------------------------------------------------------------------------
// Trip number generation
// ---------------------------------------------------------------------------

/**
 * Generate the next trip number for a tenant.
 * Format: {prefix}-{YYYYMMDD}-{sequential}
 * e.g. TR-20260419-0042
 *
 * Uses tenant_settings.last_trip_number / last_trip_date for sequencing.
 */
async function generateTripNumber(tenantId: string): Promise<{ tripNumber: string; displayNumber: number }> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const todayCompact = today.replace(/-/g, ""); // YYYYMMDD

  // Atomically increment the trip counter
  const updated: any[] = await prisma.$queryRaw`
    UPDATE tenant_settings
    SET
      last_trip_number = CASE
        WHEN last_trip_date = ${today}::date THEN last_trip_number + 1
        ELSE 1
      END,
      last_trip_date = ${today}::date
    WHERE tenant_id = ${tenantId}::uuid
    RETURNING trip_number_prefix, last_trip_number
  `;

  let prefix = "TR";
  let seq = 1;

  if (updated.length > 0) {
    prefix = updated[0].trip_number_prefix || "TR";
    seq = Number(updated[0].last_trip_number);
  }

  const paddedSeq = String(seq).padStart(4, "0");
  const tripNumber = `${prefix}-${todayCompact}-${paddedSeq}`;

  return { tripNumber, displayNumber: seq };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new trip.
 *
 * Generates a trip number, calculates a fare estimate (if dropoff is provided),
 * inserts the trip record, logs the REQUESTED status, and optionally triggers
 * auto-dispatch.
 *
 * @param params - Trip creation parameters
 * @returns The created trip row
 */
export async function createTrip(params: CreateTripParams): Promise<any> {
  const { tripNumber, displayNumber } = await generateTripNumber(params.tenantId);

  // Calculate fare estimate if dropoff coordinates are provided
  let estimatedFare = 0;
  let fareBreakdown: FareBreakdown | null = null;

  if (params.dropoffLat && params.dropoffLng) {
    fareBreakdown = await calculateEstimate({
      tenantId: params.tenantId,
      pickupLat: params.pickupLat,
      pickupLng: params.pickupLng,
      dropoffLat: params.dropoffLat,
      dropoffLng: params.dropoffLng,
      vehicleType: params.vehicleType ?? "sedan",
      promoCode: params.promoCode,
    });
    estimatedFare = fareBreakdown.total;
  }

  // Insert trip
  const rows: any[] = await prisma.$queryRaw`
    INSERT INTO trips (
      tenant_id, location_id, trip_number, display_number,
      customer_name, customer_phone, customer_email, customer_membership_id,
      pickup_address, pickup_lat, pickup_lng, pickup_notes,
      dropoff_address, dropoff_lat, dropoff_lng, dropoff_notes,
      estimated_distance_km, estimated_duration_minutes, estimated_fare,
      fare_rule_id,
      status, ride_type, passenger_count, luggage,
      payment_method, is_scheduled, scheduled_at,
      promo_code, dispatch_mode,
      requested_at
    ) VALUES (
      ${params.tenantId}::uuid,
      ${params.locationId ?? null}::uuid,
      ${tripNumber},
      ${displayNumber},
      ${params.customerName ?? null},
      ${params.customerPhone ?? null},
      ${params.customerEmail ?? null},
      ${params.customerMembershipId ?? null}::uuid,
      ${params.pickupAddress},
      ${params.pickupLat},
      ${params.pickupLng},
      ${params.pickupNotes ?? null},
      ${params.dropoffAddress ?? null},
      ${params.dropoffLat ?? null},
      ${params.dropoffLng ?? null},
      ${params.dropoffNotes ?? null},
      ${fareBreakdown?.estimatedDistanceKm ?? null},
      ${fareBreakdown?.estimatedDurationMinutes ?? null},
      ${estimatedFare},
      ${fareBreakdown?.fareRuleId ?? null}::uuid,
      'REQUESTED'::"TripStatus",
      ${params.rideType ?? "standard"},
      ${params.passengerCount ?? 1},
      ${params.luggage ?? false},
      ${params.paymentMethod ?? "cash"},
      ${params.isScheduled ?? false},
      ${params.scheduledAt ? params.scheduledAt : null}::timestamptz,
      ${params.promoCode ?? null},
      ${params.dispatchMode ?? "auto"},
      now()
    )
    RETURNING *
  `;

  const trip = rows[0];

  // Log initial status
  await logStatusChange(trip.id, null, "REQUESTED", "system", null);

  // Auto-dispatch if not scheduled and mode is auto
  if (!params.isScheduled && (params.dispatchMode ?? "auto") === "auto") {
    await dispatchTrip(trip.id);
  }

  return trip;
}

/**
 * Update a trip's status with state-machine validation.
 *
 * @param tripId    - Trip to update
 * @param newStatus - Target status
 * @param metadata  - Optional metadata (changedBy, location, notes)
 * @returns The updated trip row
 * @throws Error if the transition is invalid
 */
export async function updateTripStatus(
  tripId: string,
  newStatus: TripStatus,
  metadata?: {
    changedBy?: string;
    changedById?: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
  }
): Promise<any> {
  // Load current trip
  const trips: TripRow[] = await prisma.$queryRaw`
    SELECT id, status, tenant_id FROM trips
    WHERE id = ${tripId}::uuid
    LIMIT 1
  `;

  if (trips.length === 0) {
    throw new Error(`Trip ${tripId} not found`);
  }

  const trip = trips[0];
  const currentStatus = trip.status as TripStatus;

  // Validate transition
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} -> ${newStatus}. ` +
      `Allowed from ${currentStatus}: ${allowed?.join(", ") || "none"}`
    );
  }

  // Determine timestamp column to set
  const timestampUpdates: Record<string, string> = {
    ASSIGNED: "assigned_at",
    DRIVER_ARRIVED: "driver_arrived_at",
    IN_PROGRESS: "started_at",
    COMPLETED: "completed_at",
    CANCELLED: "cancelled_at",
  };

  const tsColumn = timestampUpdates[newStatus];
  let tsClause = Prisma.empty;
  if (tsColumn) {
    tsClause = Prisma.sql`, ${Prisma.raw(tsColumn)} = now()`;
  }

  // Update status
  const updated: any[] = await prisma.$queryRaw`
    UPDATE trips
    SET status = ${newStatus}::"TripStatus",
        updated_at = now()
        ${tsClause}
    WHERE id = ${tripId}::uuid
    RETURNING *
  `;

  // Log status change
  await logStatusChange(
    tripId,
    currentStatus,
    newStatus,
    metadata?.changedBy ?? "system",
    metadata?.changedById ?? null,
    metadata?.notes ?? null,
    metadata?.latitude ?? null,
    metadata?.longitude ?? null
  );

  return updated[0];
}

/**
 * Driver starts the trip (meter on).
 *
 * Validates the trip is in DRIVER_ARRIVED status, then transitions to IN_PROGRESS.
 *
 * @param tripId - Trip to start
 * @returns Updated trip row
 */
export async function startTrip(tripId: string): Promise<any> {
  return updateTripStatus(tripId, "IN_PROGRESS", {
    changedBy: "driver",
    notes: "Trip started - meter on",
  });
}

/**
 * Complete a trip: calculate final fare and create the trip record.
 *
 * Expects actual_distance_km and actual_duration_minutes to be set on the
 * trip row (from GPS tracking). If not set, falls back to estimated values.
 *
 * @param tripId        - Trip to complete
 * @param actualDistance - Actual distance in km (optional, uses trip column if not provided)
 * @param actualDuration - Actual duration in minutes (optional)
 * @param waitingMinutes - Total waiting time in minutes
 * @param tipAmount     - Tip in cents (optional)
 * @returns Updated trip with final fare breakdown
 */
export async function completeTrip(
  tripId: string,
  actualDistance?: number,
  actualDuration?: number,
  waitingMinutes?: number,
  tipAmount?: number
): Promise<any> {
  // Load full trip
  const trips: TripRow[] = await prisma.$queryRaw`
    SELECT * FROM trips WHERE id = ${tripId}::uuid LIMIT 1
  `;

  if (trips.length === 0) {
    throw new Error(`Trip ${tripId} not found`);
  }

  const trip = trips[0];

  if (trip.status !== "IN_PROGRESS") {
    throw new Error(`Cannot complete trip in ${trip.status} status`);
  }

  // Determine actual metrics
  const distance = actualDistance
    ?? Number(trip.actual_distance_km)
    ?? Number(trip.estimated_distance_km)
    ?? 0;
  const duration = actualDuration
    ?? Number(trip.actual_duration_minutes)
    ?? Number(trip.estimated_duration_minutes)
    ?? 0;
  const waiting = waitingMinutes ?? 0;
  const tip = tipAmount ?? 0;

  // Calculate final fare
  const fareBreakdown = await calculateFinal({
    id: trip.id,
    tenant_id: trip.tenant_id,
    actual_distance_km: distance,
    actual_duration_minutes: duration,
    waiting_minutes: waiting,
    started_at: trip.started_at ?? new Date(),
    promo_code: trip.promo_code,
  });

  // Calculate the multiplier label
  const multiplierLabel =
    fareBreakdown.peakMultiplier > 1
      ? `${fareBreakdown.peakMultiplier}x surge`
      : null;

  // Update trip with final fare details
  const updated: any[] = await prisma.$queryRaw`
    UPDATE trips
    SET
      status = 'COMPLETED'::"TripStatus",
      actual_distance_km = ${distance},
      actual_duration_minutes = ${duration},
      base_fare = ${fareBreakdown.baseFare},
      distance_fare = ${fareBreakdown.distanceFare},
      time_fare = ${fareBreakdown.timeFare},
      waiting_fare = ${fareBreakdown.waitingFare},
      surcharge = ${fareBreakdown.surcharge},
      surcharge_label = ${fareBreakdown.surchargeLabel},
      discount_amount = ${fareBreakdown.promoDiscount},
      subtotal = ${fareBreakdown.subtotal},
      tax_amount = ${fareBreakdown.taxAmount},
      tip_amount = ${tip},
      total = ${fareBreakdown.total + tip},
      peak_multiplier = ${fareBreakdown.peakMultiplier},
      fare_rule_id = ${fareBreakdown.fareRuleId}::uuid,
      completed_at = now(),
      updated_at = now()
    WHERE id = ${tripId}::uuid
    RETURNING *
  `;

  // Release the driver
  if (trip.driver_profile_id) {
    await prisma.$queryRaw`
      UPDATE driver_profiles
      SET duty_status = 'online', is_available = true, updated_at = now()
      WHERE id = ${trip.driver_profile_id}::uuid
    `;
  }

  // Log status change
  await logStatusChange(tripId, "IN_PROGRESS", "COMPLETED", "system", null);

  // Increment promo usage if applicable
  if (trip.promo_code && fareBreakdown.promoDiscount > 0) {
    await prisma.$queryRaw`
      UPDATE promo_codes
      SET current_uses = current_uses + 1, updated_at = now()
      WHERE tenant_id = ${trip.tenant_id}::uuid
        AND UPPER(code) = UPPER(${trip.promo_code})
    `;
  }

  return {
    ...updated[0],
    fareBreakdown,
  };
}

/**
 * Cancel a trip.
 *
 * Handles:
 *  - Free cancellation within the grace period
 *  - Cancellation fee after grace period
 *  - Releasing the assigned driver (if any)
 *  - Cancelling pending dispatch queue entries
 *
 * @param tripId      - Trip to cancel
 * @param cancelledBy - Who cancelled: 'customer', 'driver', 'admin', 'system'
 * @param reason      - Reason for cancellation
 * @returns Updated trip with cancellation details
 */
export async function cancelTrip(
  tripId: string,
  cancelledBy: string,
  reason?: string
): Promise<any> {
  // Load trip
  const trips: TripRow[] = await prisma.$queryRaw`
    SELECT * FROM trips WHERE id = ${tripId}::uuid LIMIT 1
  `;

  if (trips.length === 0) {
    throw new Error(`Trip ${tripId} not found`);
  }

  const trip = trips[0];
  const currentStatus = trip.status as TripStatus;

  // Can't cancel completed or already cancelled trips
  if (currentStatus === "COMPLETED" || currentStatus === "CANCELLED") {
    throw new Error(`Cannot cancel trip in ${currentStatus} status`);
  }

  // Calculate cancellation fee
  const requestedAt = new Date(trip.requested_at);
  const minutesSinceBooking = (Date.now() - requestedAt.getTime()) / 60000;
  const cancellationFee = await getCancellationFee(
    trip.tenant_id,
    trip.ride_type ?? "sedan",
    minutesSinceBooking
  );

  // Update trip
  const updated: any[] = await prisma.$queryRaw`
    UPDATE trips
    SET
      status = 'CANCELLED'::"TripStatus",
      cancel_reason = ${reason ?? null},
      cancelled_by = ${cancelledBy},
      total = ${cancellationFee},
      cancelled_at = now(),
      updated_at = now()
    WHERE id = ${tripId}::uuid
    RETURNING *
  `;

  // Release driver if assigned
  if (trip.driver_profile_id) {
    await prisma.$queryRaw`
      UPDATE driver_profiles
      SET duty_status = 'online', is_available = true, updated_at = now()
      WHERE id = ${trip.driver_profile_id}::uuid
    `;
  }

  // Cancel all pending dispatches
  await prisma.$queryRaw`
    UPDATE dispatch_queue
    SET status = 'cancelled'
    WHERE trip_id = ${tripId}::uuid
      AND status IN ('pending', 'sent')
  `;

  // Log
  await logStatusChange(tripId, currentStatus, "CANCELLED", cancelledBy, null, reason);

  return {
    ...updated[0],
    cancellationFee,
    wasFree: cancellationFee === 0,
  };
}

/**
 * Get the active trip for a driver (if any).
 *
 * Returns the trip that is currently in progress or assigned to this driver.
 *
 * @param driverProfileId - Driver to look up
 * @returns The active trip or null
 */
export async function getActiveTrip(driverProfileId: string): Promise<any | null> {
  const trips: any[] = await prisma.$queryRaw`
    SELECT t.*, v.plate_number, v.make, v.model, v.color
    FROM trips t
    LEFT JOIN vehicles v ON v.id = t.vehicle_id
    WHERE t.driver_profile_id = ${driverProfileId}::uuid
      AND t.status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
    ORDER BY t.updated_at DESC
    LIMIT 1
  `;

  return trips.length > 0 ? trips[0] : null;
}

/**
 * Get paginated trip history with filters.
 *
 * @param tenantId - Tenant to query
 * @param filters  - Optional filters (status, driver, customer, dates, etc.)
 * @returns Paginated trip list
 */
export async function getTripHistory(
  tenantId: string,
  filters: TripHistoryFilters = {}
): Promise<TripListResult> {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 20, 100);
  const offset = (page - 1) * pageSize;

  // Build WHERE conditions
  const conditions: Prisma.Sql[] = [
    Prisma.sql`t.tenant_id = ${tenantId}::uuid`,
  ];

  if (filters.status) {
    conditions.push(Prisma.sql`t.status = ${filters.status}::"TripStatus"`);
  }
  if (filters.driverProfileId) {
    conditions.push(
      Prisma.sql`t.driver_profile_id = ${filters.driverProfileId}::uuid`
    );
  }
  if (filters.customerPhone) {
    conditions.push(Prisma.sql`t.customer_phone = ${filters.customerPhone}`);
  }
  if (filters.dateFrom) {
    conditions.push(
      Prisma.sql`t.requested_at >= ${filters.dateFrom}::timestamptz`
    );
  }
  if (filters.dateTo) {
    conditions.push(
      Prisma.sql`t.requested_at <= ${filters.dateTo}::timestamptz`
    );
  }
  if (filters.rideType) {
    conditions.push(Prisma.sql`t.ride_type = ${filters.rideType}`);
  }

  const whereClause = Prisma.join(conditions, " AND ");

  // Count total
  const countRows: { count: bigint }[] = await prisma.$queryRaw`
    SELECT COUNT(*)::bigint AS count
    FROM trips t
    WHERE ${whereClause}
  `;
  const total = Number(countRows[0]?.count ?? 0);

  // Fetch page
  const trips: any[] = await prisma.$queryRaw`
    SELECT t.*,
           dp.rating AS driver_rating_avg,
           v.plate_number, v.make, v.model, v.color
    FROM trips t
    LEFT JOIN driver_profiles dp ON dp.id = t.driver_profile_id
    LEFT JOIN vehicles v ON v.id = t.vehicle_id
    WHERE ${whereClause}
    ORDER BY t.requested_at DESC
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;

  return {
    trips,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Insert a trip_status_log entry.
 */
async function logStatusChange(
  tripId: string,
  fromStatus: string | null,
  toStatus: string,
  changedBy: string,
  changedById: string | null,
  notes?: string | null,
  latitude?: number | null,
  longitude?: number | null
): Promise<void> {
  await prisma.$queryRaw`
    INSERT INTO trip_status_log (
      trip_id, from_status, to_status, changed_by, changed_by_id, notes,
      latitude, longitude
    ) VALUES (
      ${tripId}::uuid,
      ${fromStatus},
      ${toStatus},
      ${changedBy},
      ${changedById}::uuid,
      ${notes ?? null},
      ${latitude ?? null},
      ${longitude ?? null}
    )
  `;
}
