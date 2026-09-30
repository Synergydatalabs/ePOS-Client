/**
 * Cab/Transport System — Service Barrel Export
 *
 * Consolidates all cab-related services into a single import point:
 *   import { calculateEstimate, dispatchTrip, createTrip } from "@/lib/cab";
 */

// Fare calculation engine
export {
  calculateEstimate,
  calculateFinal,
  getCancellationFee,
  haversineDistanceKm,
} from "./fare-calculator";
export type { FareBreakdown, EstimateParams, TripForFinalCalc } from "./fare-calculator";

// Dispatch engine
export {
  findNearestDrivers,
  dispatchTrip,
  assignDriver,
  handleDriverResponse,
  expandSearch,
} from "./dispatch-engine";
export type { NearbyDriver, DispatchEntry, DispatchResult } from "./dispatch-engine";

// Trip lifecycle management
export {
  createTrip,
  updateTripStatus,
  startTrip,
  completeTrip,
  cancelTrip,
  getActiveTrip,
  getTripHistory,
} from "./trip-service";
export type {
  TripStatus,
  CreateTripParams,
  TripHistoryFilters,
  TripListResult,
} from "./trip-service";

// Driver management
export {
  goOnline,
  goOffline,
  updateLocation,
  getDriverStats,
  getNearbyDrivers,
  updateDriverEarnings,
} from "./driver-service";
export type {
  DriverProfile,
  DriverLocationUpdate,
  DriverStats,
  NearbyDriverView,
  DailyEarnings,
} from "./driver-service";
