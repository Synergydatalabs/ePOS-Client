// ============================================================================
// src/lib/reservations/types.ts
//
// Shared types for reservations admin (and later, customer-facing booking).
// ============================================================================

export type ReservationStatus =
  | "PENDING_DEPOSIT"
  | "CONFIRMED"
  | "ARRIVED"
  | "SEATED"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED";

export type ReservationSource =
  | "WEBSITE"
  | "GOOGLE"
  | "PHONE"
  | "WALK_IN"
  | "WHATSAPP"
  | "PARTNER"
  | "INTERNAL";

export interface GuestProfileSummary {
  id: string;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  visitCount?: number;
  vipTier?: number;
  tags?: string[];
  allergies?: string[];
  dietaryRestrictions?: string[];
  lastVisitAt?: string | null;
}

export interface ReservationTableInfo {
  id: string;
  tableNumber: string;
  displayLabel?: string | null;
  capacity: number;
  section?: { id: string; name: string; color?: string } | null;
}

export interface Reservation {
  id: string;
  locationId: string;
  tableId?: string | null;
  guestProfileId?: string | null;

  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  partySize: number;
  bookedFor: string;
  estimatedDurationMinutes: number;

  status: ReservationStatus;
  source: ReservationSource;
  specialOccasion?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
  guestTags?: string[];

  arrivedAt?: string | null;
  seatedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;

  table?: ReservationTableInfo | null;
  guestProfile?: GuestProfileSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpecialDate {
  id: string;
  date: string;
  label: string;
  blockReservations: boolean;
  blockWalkins: boolean;
  blockOnline: boolean;
  customOpenTime?: string | null;
  customCloseTime?: string | null;
  publicMessage?: string | null;
}

// ============================================================================
// UI helpers
// ============================================================================

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  PENDING_DEPOSIT: "Pending payment",
  CONFIRMED: "Confirmed",
  ARRIVED: "Arrived",
  SEATED: "Seated",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
};

export const STATUS_COLOR: Record<ReservationStatus, { bg: string; text: string }> = {
  PENDING_DEPOSIT: { bg: "bg-amber-100", text: "text-amber-800" },
  CONFIRMED: { bg: "bg-blue-100", text: "text-blue-800" },
  ARRIVED: { bg: "bg-purple-100", text: "text-purple-800" },
  SEATED: { bg: "bg-emerald-100", text: "text-emerald-800" },
  COMPLETED: { bg: "bg-gray-100", text: "text-gray-700" },
  NO_SHOW: { bg: "bg-red-100", text: "text-red-800" },
  CANCELLED: { bg: "bg-gray-100", text: "text-gray-500" },
};

/**
 * Common occasion presets (chips in the create flow).
 */
export const COMMON_OCCASIONS = [
  "Birthday",
  "Anniversary",
  "Engagement",
  "Business meal",
  "Date night",
  "Family gathering",
  "Special event",
] as const;

/**
 * Common time slots (used in 3-tap quick picker).
 * Override per-restaurant via settings later.
 */
export function generateTimeSlots(
  startHour: number = 11,
  endHour: number = 22,
  intervalMinutes: number = 30
): string[] {
  const slots: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += intervalMinutes) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
}
