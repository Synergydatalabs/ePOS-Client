/**
 * Driver Management Service
 *
 * Handles driver duty status (online/offline), real-time GPS location updates,
 * statistics retrieval, nearby driver queries (for admin dispatch views),
 * and daily earnings recalculation.
 *
 * All monetary values are in cents (CAD).
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Driver profile summary with current status. */
export interface DriverProfile {
  id: string;
  membershipId: string;
  tenantId: string;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  vehicleId: string | null;
  dutyStatus: string;
  isAvailable: boolean;
  rating: number;
  totalTrips: number;
  totalEarnings: number;
  acceptanceRate: number;
  cancellationRate: number;
  commissionType: string;
  commissionValue: number;
}

/** Real-time driver location entry. */
export interface DriverLocationUpdate {
  driverProfileId: string;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
}

/** Driver statistics summary. */
export interface DriverStats {
  driverProfileId: string;
  rating: number;
  totalTrips: number;
  totalEarnings: number;
  acceptanceRate: number;
  cancellationRate: number;
  /** Stats for today */
  todayTrips: number;
  todayEarnings: number;
  todayTips: number;
  todayOnlineHours: number;
  /** Stats for this week (Mon-Sun) */
  weekTrips: number;
  weekEarnings: number;
  weekTips: number;
  /** Stats for this month */
  monthTrips: number;
  monthEarnings: number;
  monthTips: number;
}

/** Nearby driver for admin dispatch view (includes location). */
export interface NearbyDriverView {
  driverProfileId: string;
  membershipId: string;
  vehicleType: string | null;
  plateNumber: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  distanceKm: number;
  dutyStatus: string;
  isAvailable: boolean;
  rating: number;
  currentTripId: string | null;
}

/** Daily earnings summary row. */
export interface DailyEarnings {
  id: string;
  driverProfileId: string;
  earningDate: string;
  totalTrips: number;
  totalFares: number;
  totalTips: number;
  totalCommission: number;
  totalNet: number;
  onlineHours: number;
  totalDistanceKm: number;
  cashCollected: number;
  cardCollected: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

// ---------------------------------------------------------------------------
// Duty Status Management
// ---------------------------------------------------------------------------

/**
 * Set a driver's duty status to 'online' and mark as available.
 *
 * @param driverProfileId - The driver profile to bring online
 * @returns Updated driver profile
 */
export async function goOnline(driverProfileId: string): Promise<DriverProfile> {
  const rows: any[] = await prisma.$queryRaw`
    UPDATE driver_profiles
    SET duty_status = 'online',
        is_available = true,
        updated_at = now()
    WHERE id = ${driverProfileId}::uuid
    RETURNING *
  `;

  if (rows.length === 0) {
    throw new Error(`Driver profile ${driverProfileId} not found`);
  }

  return mapDriverProfile(rows[0]);
}

/**
 * Set a driver's duty status to 'offline' and mark as unavailable.
 *
 * If the driver has an active trip, this will be rejected.
 *
 * @param driverProfileId - The driver profile to bring offline
 * @returns Updated driver profile
 */
export async function goOffline(driverProfileId: string): Promise<DriverProfile> {
  // Check for active trips
  const activeTrips: any[] = await prisma.$queryRaw`
    SELECT id FROM trips
    WHERE driver_profile_id = ${driverProfileId}::uuid
      AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
    LIMIT 1
  `;

  if (activeTrips.length > 0) {
    throw new Error(
      `Cannot go offline while on an active trip (${activeTrips[0].id})`
    );
  }

  const rows: any[] = await prisma.$queryRaw`
    UPDATE driver_profiles
    SET duty_status = 'offline',
        is_available = false,
        updated_at = now()
    WHERE id = ${driverProfileId}::uuid
    RETURNING *
  `;

  if (rows.length === 0) {
    throw new Error(`Driver profile ${driverProfileId} not found`);
  }

  return mapDriverProfile(rows[0]);
}

// ---------------------------------------------------------------------------
// Location Tracking
// ---------------------------------------------------------------------------

/**
 * Record a new GPS location for a driver.
 *
 * Called frequently from the driver app (every 5-15 seconds while online).
 * Inserts into driver_locations for real-time tracking and trip route building.
 *
 * @param driverProfileId - Driver sending the location
 * @param lat             - Latitude (decimal degrees)
 * @param lng             - Longitude (decimal degrees)
 * @param heading         - Compass heading 0-360 (optional)
 * @param speed           - Speed in km/h (optional)
 * @param accuracy        - GPS accuracy in meters (optional)
 */
export async function updateLocation(
  driverProfileId: string,
  lat: number,
  lng: number,
  heading?: number | null,
  speed?: number | null,
  accuracy?: number | null
): Promise<void> {
  // Get tenant_id from driver profile
  const profiles: { tenant_id: string }[] = await prisma.$queryRaw`
    SELECT tenant_id FROM driver_profiles
    WHERE id = ${driverProfileId}::uuid
    LIMIT 1
  `;

  if (profiles.length === 0) {
    throw new Error(`Driver profile ${driverProfileId} not found`);
  }

  const tenantId = profiles[0].tenant_id;

  await prisma.$queryRaw`
    INSERT INTO driver_locations (
      driver_profile_id, tenant_id,
      latitude, longitude, heading, speed, accuracy,
      recorded_at
    ) VALUES (
      ${driverProfileId}::uuid,
      ${tenantId}::uuid,
      ${lat},
      ${lng},
      ${heading ?? null},
      ${speed ?? null},
      ${accuracy ?? null},
      now()
    )
  `;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Get comprehensive driver statistics.
 *
 * Pulls aggregate stats from the driver_profiles table (lifetime) and
 * driver_earnings table (daily/weekly/monthly breakdowns).
 *
 * @param driverProfileId - Driver to get stats for
 * @returns DriverStats object
 */
export async function getDriverStats(
  driverProfileId: string
): Promise<DriverStats> {
  // Lifetime stats from driver_profiles
  const profiles: any[] = await prisma.$queryRaw`
    SELECT id, rating, total_trips, total_earnings,
           acceptance_rate, cancellation_rate
    FROM driver_profiles
    WHERE id = ${driverProfileId}::uuid
    LIMIT 1
  `;

  if (profiles.length === 0) {
    throw new Error(`Driver profile ${driverProfileId} not found`);
  }

  const profile = profiles[0];

  // Today's earnings
  const todayRows: any[] = await prisma.$queryRaw`
    SELECT
      COALESCE(total_trips, 0) AS total_trips,
      COALESCE(total_fares, 0) AS total_fares,
      COALESCE(total_tips, 0) AS total_tips,
      COALESCE(total_net, 0) AS total_net,
      COALESCE(online_hours, 0) AS online_hours
    FROM driver_earnings
    WHERE driver_profile_id = ${driverProfileId}::uuid
      AND earning_date = CURRENT_DATE
    LIMIT 1
  `;

  const today = todayRows[0] ?? {
    total_trips: 0,
    total_fares: 0,
    total_tips: 0,
    total_net: 0,
    online_hours: 0,
  };

  // This week (Monday to Sunday)
  const weekRows: any[] = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(total_trips), 0) AS total_trips,
      COALESCE(SUM(total_net), 0) AS total_net,
      COALESCE(SUM(total_tips), 0) AS total_tips
    FROM driver_earnings
    WHERE driver_profile_id = ${driverProfileId}::uuid
      AND earning_date >= date_trunc('week', CURRENT_DATE)
      AND earning_date <= CURRENT_DATE
  `;

  const week = weekRows[0] ?? { total_trips: 0, total_net: 0, total_tips: 0 };

  // This month
  const monthRows: any[] = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(total_trips), 0) AS total_trips,
      COALESCE(SUM(total_net), 0) AS total_net,
      COALESCE(SUM(total_tips), 0) AS total_tips
    FROM driver_earnings
    WHERE driver_profile_id = ${driverProfileId}::uuid
      AND earning_date >= date_trunc('month', CURRENT_DATE)
      AND earning_date <= CURRENT_DATE
  `;

  const month = monthRows[0] ?? { total_trips: 0, total_net: 0, total_tips: 0 };

  return {
    driverProfileId,
    rating: Number(profile.rating),
    totalTrips: Number(profile.total_trips),
    totalEarnings: Number(profile.total_earnings),
    acceptanceRate: Number(profile.acceptance_rate),
    cancellationRate: Number(profile.cancellation_rate),
    todayTrips: Number(today.total_trips),
    todayEarnings: Number(today.total_net),
    todayTips: Number(today.total_tips),
    todayOnlineHours: Number(today.online_hours),
    weekTrips: Number(week.total_trips),
    weekEarnings: Number(week.total_net),
    weekTips: Number(week.total_tips),
    monthTrips: Number(month.total_trips),
    monthEarnings: Number(month.total_net),
    monthTips: Number(month.total_tips),
  };
}

// ---------------------------------------------------------------------------
// Nearby Drivers (Admin View)
// ---------------------------------------------------------------------------

/**
 * Get all nearby drivers for the admin dispatch map view.
 *
 * Returns all online drivers (both available and on-trip) within a radius,
 * along with their current trip info if applicable.
 *
 * @param tenantId  - Tenant to query
 * @param lat       - Center latitude
 * @param lng       - Center longitude
 * @param radiusKm  - Search radius in km (default 10)
 * @returns Array of nearby drivers with location and status
 */
export async function getNearbyDrivers(
  tenantId: string,
  lat: number,
  lng: number,
  radiusKm: number = 10
): Promise<NearbyDriverView[]> {
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
      dp.duty_status,
      dp.is_available,
      dp.rating,
      v.vehicle_type,
      v.plate_number,
      v.make,
      v.model,
      v.color,
      ll.latitude,
      ll.longitude,
      ll.heading,
      ll.speed,
      (
        ${EARTH_RADIUS_KM} * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(${lat})) * cos(radians(ll.latitude))
            * cos(radians(ll.longitude) - radians(${lng}))
            + sin(radians(${lat})) * sin(radians(ll.latitude))
          ))
        )
      ) AS distance_km,
      active_trip.id AS current_trip_id
    FROM latest_locations ll
    JOIN driver_profiles dp ON dp.id = ll.driver_profile_id
    LEFT JOIN vehicles v ON v.id = dp.vehicle_id
    LEFT JOIN LATERAL (
      SELECT id FROM trips
      WHERE driver_profile_id = dp.id
        AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
      ORDER BY updated_at DESC
      LIMIT 1
    ) active_trip ON true
    WHERE dp.tenant_id = ${tenantId}::uuid
      AND dp.duty_status IN ('online', 'on_trip')
    HAVING (
      ${EARTH_RADIUS_KM} * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(${lat})) * cos(radians(ll.latitude))
          * cos(radians(ll.longitude) - radians(${lng}))
          + sin(radians(${lat})) * sin(radians(ll.latitude))
        ))
      )
    ) <= ${radiusKm}
    ORDER BY distance_km ASC
  `;

  return rows.map((row) => ({
    driverProfileId: row.driver_profile_id,
    membershipId: row.membership_id,
    vehicleType: row.vehicle_type,
    plateNumber: row.plate_number,
    make: row.make,
    model: row.model,
    color: row.color,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    heading: row.heading ? Number(row.heading) : null,
    speed: row.speed ? Number(row.speed) : null,
    distanceKm: Math.round(Number(row.distance_km) * 100) / 100,
    dutyStatus: row.duty_status,
    isAvailable: row.is_available,
    rating: Number(row.rating),
    currentTripId: row.current_trip_id ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Earnings Management
// ---------------------------------------------------------------------------

/**
 * Recalculate a driver's daily earnings summary.
 *
 * Aggregates all completed trips for the given date, computes commission,
 * and upserts the driver_earnings row.
 *
 * @param driverProfileId - Driver to recalculate
 * @param date            - The date to recalculate (YYYY-MM-DD string)
 * @returns The upserted earnings row
 */
export async function updateDriverEarnings(
  driverProfileId: string,
  date: string
): Promise<DailyEarnings> {
  // Load driver's commission settings
  const drivers: any[] = await prisma.$queryRaw`
    SELECT tenant_id, commission_type, commission_value
    FROM driver_profiles
    WHERE id = ${driverProfileId}::uuid
    LIMIT 1
  `;

  if (drivers.length === 0) {
    throw new Error(`Driver profile ${driverProfileId} not found`);
  }

  const driver = drivers[0];
  const tenantId = driver.tenant_id;

  // Aggregate completed trips for the date
  const tripStats: any[] = await prisma.$queryRaw`
    SELECT
      COUNT(*) AS trip_count,
      COALESCE(SUM(total), 0) AS total_fares,
      COALESCE(SUM(tip_amount), 0) AS total_tips,
      COALESCE(SUM(actual_distance_km), 0) AS total_distance_km,
      COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total + tip_amount ELSE 0 END), 0) AS cash_collected,
      COALESCE(SUM(CASE WHEN payment_method != 'cash' THEN total + tip_amount ELSE 0 END), 0) AS card_collected
    FROM trips
    WHERE driver_profile_id = ${driverProfileId}::uuid
      AND status = 'COMPLETED'
      AND completed_at::date = ${date}::date
  `;

  const stats = tripStats[0];
  const totalFares = Number(stats.total_fares);
  const totalTips = Number(stats.total_tips);
  const totalTrips = Number(stats.trip_count);
  const totalDistanceKm = Number(stats.total_distance_km);
  const cashCollected = Number(stats.cash_collected);
  const cardCollected = Number(stats.card_collected);

  // Calculate commission
  let commission = 0;
  const commissionType = driver.commission_type;
  const commissionValue = Number(driver.commission_value);

  if (commissionType === "percentage") {
    commission = Math.round((totalFares * commissionValue) / 100);
  } else if (commissionType === "flat") {
    commission = Math.round(commissionValue * totalTrips * 100); // flat per trip in dollars -> cents
  }
  // 'none' = 0

  const totalNet = totalFares - commission + totalTips;

  // Estimate online hours from first-to-last trip of the day
  const hoursRows: any[] = await prisma.$queryRaw`
    SELECT
      EXTRACT(EPOCH FROM (MAX(completed_at) - MIN(requested_at))) / 3600.0 AS hours
    FROM trips
    WHERE driver_profile_id = ${driverProfileId}::uuid
      AND status = 'COMPLETED'
      AND completed_at::date = ${date}::date
  `;

  const onlineHours = Math.round((Number(hoursRows[0]?.hours) || 0) * 100) / 100;

  // Upsert driver_earnings
  const rows: any[] = await prisma.$queryRaw`
    INSERT INTO driver_earnings (
      driver_profile_id, tenant_id, earning_date,
      total_trips, total_fares, total_tips, total_commission, total_net,
      online_hours, total_distance_km, cash_collected, card_collected
    ) VALUES (
      ${driverProfileId}::uuid, ${tenantId}::uuid, ${date}::date,
      ${totalTrips}, ${totalFares}, ${totalTips}, ${commission}, ${totalNet},
      ${onlineHours}, ${totalDistanceKm}, ${cashCollected}, ${cardCollected}
    )
    ON CONFLICT (driver_profile_id, earning_date)
    DO UPDATE SET
      total_trips = EXCLUDED.total_trips,
      total_fares = EXCLUDED.total_fares,
      total_tips = EXCLUDED.total_tips,
      total_commission = EXCLUDED.total_commission,
      total_net = EXCLUDED.total_net,
      online_hours = EXCLUDED.online_hours,
      total_distance_km = EXCLUDED.total_distance_km,
      cash_collected = EXCLUDED.cash_collected,
      card_collected = EXCLUDED.card_collected,
      updated_at = now()
    RETURNING *
  `;

  // Also update the lifetime total on the driver profile
  await prisma.$queryRaw`
    UPDATE driver_profiles
    SET
      total_trips = (
        SELECT COALESCE(SUM(total_trips), 0)
        FROM driver_earnings
        WHERE driver_profile_id = ${driverProfileId}::uuid
      ),
      total_earnings = (
        SELECT COALESCE(SUM(total_net), 0)
        FROM driver_earnings
        WHERE driver_profile_id = ${driverProfileId}::uuid
      ),
      updated_at = now()
    WHERE id = ${driverProfileId}::uuid
  `;

  const row = rows[0];
  return {
    id: row.id,
    driverProfileId: row.driver_profile_id,
    earningDate: row.earning_date,
    totalTrips: Number(row.total_trips),
    totalFares: Number(row.total_fares),
    totalTips: Number(row.total_tips),
    totalCommission: Number(row.total_commission),
    totalNet: Number(row.total_net),
    onlineHours: Number(row.online_hours),
    totalDistanceKm: Number(row.total_distance_km),
    cashCollected: Number(row.cash_collected),
    cardCollected: Number(row.card_collected),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a raw driver_profiles row to a typed DriverProfile object.
 */
function mapDriverProfile(row: any): DriverProfile {
  return {
    id: row.id,
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    licenseNumber: row.license_number,
    licenseExpiry: row.license_expiry,
    vehicleId: row.vehicle_id,
    dutyStatus: row.duty_status,
    isAvailable: row.is_available,
    rating: Number(row.rating),
    totalTrips: Number(row.total_trips),
    totalEarnings: Number(row.total_earnings),
    acceptanceRate: Number(row.acceptance_rate),
    cancellationRate: Number(row.cancellation_rate),
    commissionType: row.commission_type,
    commissionValue: Number(row.commission_value),
  };
}
