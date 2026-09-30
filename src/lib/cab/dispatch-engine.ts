/**
 * Dispatch Engine
 *
 * Handles finding nearby available drivers and assigning them to trips.
 * Supports auto-dispatch (nearest driver first) and manual admin assignment.
 *
 * Key concepts:
 *  - Uses Haversine SQL to sort drivers by distance from pickup
 *  - Creates dispatch_queue entries for tracking attempts
 *  - Auto-expands search radius when no drivers found
 *  - Handles driver accept/reject flow with timeout
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A nearby driver candidate with distance info. */
export interface NearbyDriver {
  driverProfileId: string;
  membershipId: string;
  driverName: string | null;
  vehicleType: string | null;
  vehicleId: string | null;
  plateNumber: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  heading: number | null;
  speed: number | null;
  rating: number;
  totalTrips: number;
  dutyStatus: string;
}

/** A dispatch queue entry. */
export interface DispatchEntry {
  id: string;
  tripId: string;
  driverProfileId: string;
  attemptNumber: number;
  dispatchRadiusKm: number;
  driverDistanceKm: number;
  estimatedEtaMinutes: number | null;
  status: string;
  sentAt: Date | null;
  expiresAt: Date | null;
}

/** Result of a dispatch attempt. */
export interface DispatchResult {
  success: boolean;
  dispatchId: string | null;
  driverProfileId: string | null;
  message: string;
}

/** Tenant dispatch settings. */
interface DispatchSettings {
  dispatch_mode: string;
  dispatch_radius_km: number;
  dispatch_timeout_seconds: number;
  max_dispatch_attempts: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Earth radius in km (for SQL Haversine). */
const EARTH_RADIUS_KM = 6371;

/** Default dispatch radius if no tenant setting. */
const DEFAULT_RADIUS_KM = 5;

/** Default timeout for a driver to respond (seconds). */
const DEFAULT_TIMEOUT_SECONDS = 30;

/** Maximum allowed dispatch attempts. */
const MAX_ATTEMPTS_HARD_LIMIT = 10;

/** How much to increase radius per expansion step (km). */
const RADIUS_EXPANSION_STEP_KM = 3;

/** Maximum search radius (km). */
const MAX_RADIUS_KM = 50;

/** Average city speed (km/h) for ETA estimation. */
const AVG_SPEED_KMH = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load tenant dispatch settings from tenant_settings.
 */
async function loadDispatchSettings(
  tenantId: string
): Promise<DispatchSettings> {
  const rows: DispatchSettings[] = await prisma.$queryRaw`
    SELECT
      dispatch_mode,
      dispatch_radius_km,
      dispatch_timeout_seconds,
      max_dispatch_attempts
    FROM tenant_settings
    WHERE tenant_id = ${tenantId}::uuid
    LIMIT 1
  `;

  if (rows.length > 0) {
    return {
      dispatch_mode: rows[0].dispatch_mode ?? "auto",
      dispatch_radius_km: Number(rows[0].dispatch_radius_km) || DEFAULT_RADIUS_KM,
      dispatch_timeout_seconds:
        Number(rows[0].dispatch_timeout_seconds) || DEFAULT_TIMEOUT_SECONDS,
      max_dispatch_attempts:
        Math.min(
          Number(rows[0].max_dispatch_attempts) || 5,
          MAX_ATTEMPTS_HARD_LIMIT
        ),
    };
  }

  return {
    dispatch_mode: "auto",
    dispatch_radius_km: DEFAULT_RADIUS_KM,
    dispatch_timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
    max_dispatch_attempts: 5,
  };
}

/**
 * Estimate ETA in minutes based on straight-line distance.
 */
function estimateEta(distanceKm: number): number {
  // Road factor 1.3 + average city speed
  return Math.ceil((distanceKm * 1.3) / AVG_SPEED_KMH * 60);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the nearest available drivers to a pickup location.
 *
 * Queries driver_locations (latest position within the last hour) joined with
 * driver_profiles. Only returns drivers who are online and available, and who
 * are within the specified radius.
 *
 * @param tenantId   - The tenant / cab company
 * @param pickupLat  - Pickup latitude
 * @param pickupLng  - Pickup longitude
 * @param radiusKm   - Search radius in kilometres
 * @param vehicleType - Vehicle type filter (null = any)
 * @param limit      - Maximum drivers to return (default 10)
 * @returns Sorted array of nearby drivers (closest first)
 */
export async function findNearestDrivers(
  tenantId: string,
  pickupLat: number,
  pickupLng: number,
  radiusKm: number = DEFAULT_RADIUS_KM,
  vehicleType: string | null = null,
  limit: number = 10
): Promise<NearbyDriver[]> {
  // Build the vehicle type filter dynamically
  const vehicleTypeFilter = vehicleType
    ? Prisma.sql`AND dp.vehicle_id IS NOT NULL
                  AND v.vehicle_type = ${vehicleType}`
    : Prisma.empty;

  const rows: any[] = await prisma.$queryRaw`
    WITH latest_locations AS (
      SELECT DISTINCT ON (dl.driver_profile_id)
        dl.driver_profile_id,
        dl.latitude,
        dl.longitude,
        dl.heading,
        dl.speed
      FROM driver_locations dl
      WHERE dl.tenant_id = ${tenantId}::uuid
        AND dl.recorded_at > now() - INTERVAL '1 hour'
      ORDER BY dl.driver_profile_id, dl.recorded_at DESC
    )
    SELECT
      dp.id AS driver_profile_id,
      dp.membership_id,
      ll.latitude,
      ll.longitude,
      ll.heading,
      ll.speed,
      dp.rating,
      dp.total_trips,
      dp.duty_status,
      v.vehicle_type,
      v.id AS vehicle_id,
      v.plate_number,
      (
        ${EARTH_RADIUS_KM} * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(${pickupLat})) * cos(radians(ll.latitude))
            * cos(radians(ll.longitude) - radians(${pickupLng}))
            + sin(radians(${pickupLat})) * sin(radians(ll.latitude))
          ))
        )
      ) AS distance_km
    FROM latest_locations ll
    JOIN driver_profiles dp ON dp.id = ll.driver_profile_id
    LEFT JOIN vehicles v ON v.id = dp.vehicle_id
    WHERE dp.tenant_id = ${tenantId}::uuid
      AND dp.duty_status = 'online'
      AND dp.is_available = true
      ${vehicleTypeFilter}
    HAVING (
      ${EARTH_RADIUS_KM} * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(${pickupLat})) * cos(radians(ll.latitude))
          * cos(radians(ll.longitude) - radians(${pickupLng}))
          + sin(radians(${pickupLat})) * sin(radians(ll.latitude))
        ))
      )
    ) <= ${radiusKm}
    ORDER BY distance_km ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    driverProfileId: row.driver_profile_id,
    membershipId: row.membership_id,
    driverName: null, // Would need membership join; kept lean
    vehicleType: row.vehicle_type,
    vehicleId: row.vehicle_id,
    plateNumber: row.plate_number,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    distanceKm: Math.round(Number(row.distance_km) * 100) / 100,
    heading: row.heading ? Number(row.heading) : null,
    speed: row.speed ? Number(row.speed) : null,
    rating: Number(row.rating),
    totalTrips: Number(row.total_trips),
    dutyStatus: row.duty_status,
  }));
}

/**
 * Auto-dispatch a trip to the nearest available driver.
 *
 * Steps:
 *  1. Load trip details from DB
 *  2. Get dispatch settings
 *  3. Find nearest drivers
 *  4. Create a dispatch_queue entry for the closest driver
 *  5. Update trip status to SEARCHING (if not already)
 *
 * @param tripId - Trip to dispatch
 * @returns DispatchResult with status
 */
export async function dispatchTrip(tripId: string): Promise<DispatchResult> {
  // Load trip
  const trips: any[] = await prisma.$queryRaw`
    SELECT id, tenant_id, pickup_lat, pickup_lng, status, dispatch_attempts,
           ride_type
    FROM trips
    WHERE id = ${tripId}::uuid
    LIMIT 1
  `;

  if (trips.length === 0) {
    return { success: false, dispatchId: null, driverProfileId: null, message: "Trip not found" };
  }

  const trip = trips[0];
  const tenantId = trip.tenant_id;
  const settings = await loadDispatchSettings(tenantId);

  // Check max attempts
  const currentAttempts = Number(trip.dispatch_attempts);
  if (currentAttempts >= settings.max_dispatch_attempts) {
    // Mark trip as NO_DRIVERS
    await prisma.$queryRaw`
      UPDATE trips
      SET status = 'NO_DRIVERS', updated_at = now()
      WHERE id = ${tripId}::uuid
    `;
    await logStatusChange(tripId, trip.status, "NO_DRIVERS", "system", null);
    return {
      success: false,
      dispatchId: null,
      driverProfileId: null,
      message: "Max dispatch attempts reached. No drivers available.",
    };
  }

  // Get list of drivers who already rejected this trip
  const rejectedDriverIds: { driver_profile_id: string }[] = await prisma.$queryRaw`
    SELECT driver_profile_id
    FROM dispatch_queue
    WHERE trip_id = ${tripId}::uuid
      AND status IN ('rejected', 'expired')
  `;
  const excludeIds = rejectedDriverIds.map((r) => r.driver_profile_id);

  // Find nearest drivers
  let drivers = await findNearestDrivers(
    tenantId,
    Number(trip.pickup_lat),
    Number(trip.pickup_lng),
    settings.dispatch_radius_km,
    null, // any vehicle type
    5
  );

  // Exclude previously rejected/expired drivers
  if (excludeIds.length > 0) {
    drivers = drivers.filter(
      (d) => !excludeIds.includes(d.driverProfileId)
    );
  }

  if (drivers.length === 0) {
    return {
      success: false,
      dispatchId: null,
      driverProfileId: null,
      message: "No available drivers in range",
    };
  }

  // Pick the nearest driver
  const chosen = drivers[0];
  const eta = estimateEta(chosen.distanceKm);
  const timeoutMs = settings.dispatch_timeout_seconds * 1000;

  // Create dispatch queue entry
  const newAttempt = currentAttempts + 1;
  const dispatchRows: { id: string }[] = await prisma.$queryRaw`
    INSERT INTO dispatch_queue (
      trip_id, tenant_id, driver_profile_id,
      attempt_number, dispatch_radius_km, driver_distance_km,
      estimated_eta_minutes, status, sent_at, expires_at
    ) VALUES (
      ${tripId}::uuid, ${tenantId}::uuid, ${chosen.driverProfileId}::uuid,
      ${newAttempt}, ${settings.dispatch_radius_km}, ${chosen.distanceKm},
      ${eta}, 'sent', now(),
      now() + ${settings.dispatch_timeout_seconds + " seconds"}::interval
    )
    RETURNING id
  `;

  // Update trip dispatch_attempts and status
  const newStatus = trip.status === "REQUESTED" ? "SEARCHING" : trip.status;
  await prisma.$queryRaw`
    UPDATE trips
    SET dispatch_attempts = ${newAttempt},
        status = ${newStatus}::"TripStatus",
        updated_at = now()
    WHERE id = ${tripId}::uuid
  `;

  if (newStatus !== trip.status) {
    await logStatusChange(tripId, trip.status, newStatus, "system", null);
  }

  return {
    success: true,
    dispatchId: dispatchRows[0]?.id ?? null,
    driverProfileId: chosen.driverProfileId,
    message: `Dispatched to driver. ETA: ${eta} min, distance: ${chosen.distanceKm} km`,
  };
}

/**
 * Manual admin assignment of a driver to a trip.
 *
 * @param tripId         - Trip to assign
 * @param driverProfileId - Driver to assign
 * @returns DispatchResult
 */
export async function assignDriver(
  tripId: string,
  driverProfileId: string
): Promise<DispatchResult> {
  // Verify trip exists and is in a dispatchable state
  const trips: any[] = await prisma.$queryRaw`
    SELECT id, tenant_id, status FROM trips
    WHERE id = ${tripId}::uuid
    LIMIT 1
  `;

  if (trips.length === 0) {
    return { success: false, dispatchId: null, driverProfileId: null, message: "Trip not found" };
  }

  const trip = trips[0];
  const validStatuses = ["REQUESTED", "SEARCHING", "NO_DRIVERS"];
  if (!validStatuses.includes(trip.status)) {
    return {
      success: false,
      dispatchId: null,
      driverProfileId: null,
      message: `Cannot assign driver when trip is in ${trip.status} status`,
    };
  }

  // Verify driver exists, is online, and is available
  const drivers: any[] = await prisma.$queryRaw`
    SELECT id, vehicle_id, duty_status, is_available
    FROM driver_profiles
    WHERE id = ${driverProfileId}::uuid
      AND tenant_id = ${trip.tenant_id}::uuid
    LIMIT 1
  `;

  if (drivers.length === 0) {
    return {
      success: false,
      dispatchId: null,
      driverProfileId: null,
      message: "Driver profile not found",
    };
  }

  const driver = drivers[0];
  if (driver.duty_status !== "online" || !driver.is_available) {
    return {
      success: false,
      dispatchId: null,
      driverProfileId: null,
      message: "Driver is not available",
    };
  }

  // Create dispatch entry (manual)
  const dispatchRows: { id: string }[] = await prisma.$queryRaw`
    INSERT INTO dispatch_queue (
      trip_id, tenant_id, driver_profile_id,
      attempt_number, status, sent_at
    ) VALUES (
      ${tripId}::uuid, ${trip.tenant_id}::uuid, ${driverProfileId}::uuid,
      0, 'accepted', now()
    )
    RETURNING id
  `;

  // Directly assign the driver to the trip
  await prisma.$queryRaw`
    UPDATE trips
    SET driver_profile_id = ${driverProfileId}::uuid,
        vehicle_id = ${driver.vehicle_id}::uuid,
        status = 'ASSIGNED'::"TripStatus",
        dispatch_mode = 'manual',
        assigned_at = now(),
        updated_at = now()
    WHERE id = ${tripId}::uuid
  `;

  // Mark driver as on_trip
  await prisma.$queryRaw`
    UPDATE driver_profiles
    SET duty_status = 'on_trip', is_available = false, updated_at = now()
    WHERE id = ${driverProfileId}::uuid
  `;

  await logStatusChange(tripId, trip.status, "ASSIGNED", "admin", null);

  return {
    success: true,
    dispatchId: dispatchRows[0]?.id ?? null,
    driverProfileId,
    message: "Driver manually assigned to trip",
  };
}

/**
 * Handle a driver's response to a dispatch request.
 *
 * @param dispatchId - The dispatch_queue entry id
 * @param accepted   - Whether the driver accepted or rejected
 * @returns DispatchResult
 */
export async function handleDriverResponse(
  dispatchId: string,
  accepted: boolean
): Promise<DispatchResult> {
  // Load dispatch entry
  const entries: any[] = await prisma.$queryRaw`
    SELECT dq.id, dq.trip_id, dq.driver_profile_id, dq.status, dq.tenant_id,
           t.status AS trip_status
    FROM dispatch_queue dq
    JOIN trips t ON t.id = dq.trip_id
    WHERE dq.id = ${dispatchId}::uuid
    LIMIT 1
  `;

  if (entries.length === 0) {
    return {
      success: false,
      dispatchId,
      driverProfileId: null,
      message: "Dispatch entry not found",
    };
  }

  const entry = entries[0];

  if (entry.status !== "sent") {
    return {
      success: false,
      dispatchId,
      driverProfileId: entry.driver_profile_id,
      message: `Dispatch already ${entry.status}`,
    };
  }

  if (accepted) {
    // Accept: update dispatch entry, assign driver to trip
    await prisma.$queryRaw`
      UPDATE dispatch_queue
      SET status = 'accepted', responded_at = now()
      WHERE id = ${dispatchId}::uuid
    `;

    // Get driver's vehicle
    const driverRows: any[] = await prisma.$queryRaw`
      SELECT vehicle_id FROM driver_profiles
      WHERE id = ${entry.driver_profile_id}::uuid
      LIMIT 1
    `;

    const vehicleId = driverRows[0]?.vehicle_id ?? null;

    // Assign driver to trip
    await prisma.$queryRaw`
      UPDATE trips
      SET driver_profile_id = ${entry.driver_profile_id}::uuid,
          vehicle_id = ${vehicleId}::uuid,
          status = 'ASSIGNED'::"TripStatus",
          assigned_at = now(),
          updated_at = now()
      WHERE id = ${entry.trip_id}::uuid
    `;

    // Mark driver as on_trip
    await prisma.$queryRaw`
      UPDATE driver_profiles
      SET duty_status = 'on_trip', is_available = false, updated_at = now()
      WHERE id = ${entry.driver_profile_id}::uuid
    `;

    // Cancel any other pending dispatches for this trip
    await prisma.$queryRaw`
      UPDATE dispatch_queue
      SET status = 'cancelled'
      WHERE trip_id = ${entry.trip_id}::uuid
        AND id != ${dispatchId}::uuid
        AND status IN ('pending', 'sent')
    `;

    await logStatusChange(
      entry.trip_id,
      entry.trip_status,
      "ASSIGNED",
      "driver",
      entry.driver_profile_id
    );

    return {
      success: true,
      dispatchId,
      driverProfileId: entry.driver_profile_id,
      message: "Driver accepted the trip",
    };
  } else {
    // Reject: update dispatch entry, update driver acceptance rate
    await prisma.$queryRaw`
      UPDATE dispatch_queue
      SET status = 'rejected', responded_at = now()
      WHERE id = ${dispatchId}::uuid
    `;

    // Update driver acceptance_rate
    await prisma.$queryRaw`
      UPDATE driver_profiles
      SET acceptance_rate = GREATEST(0,
        (SELECT
          ROUND(
            COUNT(*) FILTER (WHERE status = 'accepted')::decimal /
            NULLIF(COUNT(*) FILTER (WHERE status IN ('accepted', 'rejected')), 0) * 100,
            2
          )
        FROM dispatch_queue
        WHERE driver_profile_id = ${entry.driver_profile_id}::uuid
          AND status IN ('accepted', 'rejected')
        )
      ),
      updated_at = now()
      WHERE id = ${entry.driver_profile_id}::uuid
    `;

    // Try to dispatch to the next driver
    const nextResult = await dispatchTrip(entry.trip_id);

    return {
      success: false,
      dispatchId,
      driverProfileId: entry.driver_profile_id,
      message: `Driver rejected. ${nextResult.message}`,
    };
  }
}

/**
 * Expand the search radius and re-dispatch after failed attempts.
 *
 * Increases the search radius by RADIUS_EXPANSION_STEP_KM and tries again.
 *
 * @param tripId - Trip to re-dispatch with expanded radius
 * @returns DispatchResult
 */
export async function expandSearch(tripId: string): Promise<DispatchResult> {
  // Load trip
  const trips: any[] = await prisma.$queryRaw`
    SELECT id, tenant_id, pickup_lat, pickup_lng, status, dispatch_attempts
    FROM trips
    WHERE id = ${tripId}::uuid
    LIMIT 1
  `;

  if (trips.length === 0) {
    return { success: false, dispatchId: null, driverProfileId: null, message: "Trip not found" };
  }

  const trip = trips[0];
  const settings = await loadDispatchSettings(trip.tenant_id);

  // Calculate new radius (based on attempt count)
  const currentAttempts = Number(trip.dispatch_attempts);
  const newRadius = Math.min(
    settings.dispatch_radius_km + currentAttempts * RADIUS_EXPANSION_STEP_KM,
    MAX_RADIUS_KM
  );

  // Temporarily update tenant's dispatch radius for this search
  // (We pass it directly to findNearestDrivers instead)

  // Get list of drivers who already rejected/expired for this trip
  const rejectedDriverIds: { driver_profile_id: string }[] = await prisma.$queryRaw`
    SELECT driver_profile_id
    FROM dispatch_queue
    WHERE trip_id = ${tripId}::uuid
      AND status IN ('rejected', 'expired')
  `;
  const excludeIds = rejectedDriverIds.map((r) => r.driver_profile_id);

  // Find drivers in expanded radius
  let drivers = await findNearestDrivers(
    trip.tenant_id,
    Number(trip.pickup_lat),
    Number(trip.pickup_lng),
    newRadius,
    null,
    5
  );

  drivers = drivers.filter(
    (d) => !excludeIds.includes(d.driverProfileId)
  );

  if (drivers.length === 0) {
    // Check if we've exhausted attempts
    if (currentAttempts >= settings.max_dispatch_attempts) {
      await prisma.$queryRaw`
        UPDATE trips
        SET status = 'NO_DRIVERS'::"TripStatus", updated_at = now()
        WHERE id = ${tripId}::uuid
      `;
      await logStatusChange(tripId, trip.status, "NO_DRIVERS", "system", null);
      return {
        success: false,
        dispatchId: null,
        driverProfileId: null,
        message: `No drivers found within ${newRadius} km. Search exhausted.`,
      };
    }

    return {
      success: false,
      dispatchId: null,
      driverProfileId: null,
      message: `No new drivers within expanded ${newRadius} km radius`,
    };
  }

  // Dispatch to nearest new driver
  const chosen = drivers[0];
  const eta = estimateEta(chosen.distanceKm);
  const newAttempt = currentAttempts + 1;

  const dispatchRows: { id: string }[] = await prisma.$queryRaw`
    INSERT INTO dispatch_queue (
      trip_id, tenant_id, driver_profile_id,
      attempt_number, dispatch_radius_km, driver_distance_km,
      estimated_eta_minutes, status, sent_at,
      expires_at
    ) VALUES (
      ${tripId}::uuid, ${trip.tenant_id}::uuid, ${chosen.driverProfileId}::uuid,
      ${newAttempt}, ${newRadius}, ${chosen.distanceKm},
      ${eta}, 'sent', now(),
      now() + ${settings.dispatch_timeout_seconds + " seconds"}::interval
    )
    RETURNING id
  `;

  // Update trip
  await prisma.$queryRaw`
    UPDATE trips
    SET dispatch_attempts = ${newAttempt}, updated_at = now()
    WHERE id = ${tripId}::uuid
  `;

  return {
    success: true,
    dispatchId: dispatchRows[0]?.id ?? null,
    driverProfileId: chosen.driverProfileId,
    message: `Expanded search to ${newRadius} km. Dispatched to driver (${chosen.distanceKm} km away, ETA ${eta} min)`,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Log a trip status change to the trip_status_log table.
 */
async function logStatusChange(
  tripId: string,
  fromStatus: string | null,
  toStatus: string,
  changedBy: string,
  changedById: string | null
): Promise<void> {
  await prisma.$queryRaw`
    INSERT INTO trip_status_log (trip_id, from_status, to_status, changed_by, changed_by_id)
    VALUES (${tripId}::uuid, ${fromStatus}, ${toStatus}, ${changedBy}, ${changedById}::uuid)
  `;
}
