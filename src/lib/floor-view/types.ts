// ============================================================================
// src/lib/floor-view/types.ts
//
// Shared types for live floor view (staff side).
// ============================================================================

import type { TableShapeKind } from "@/lib/floor-plan/types";

export type LiveTableStatus =
  | "AVAILABLE"
  | "OCCUPIED"
  | "RESERVED"
  | "CLEANING"
  | "BLOCKED";

export interface ServerSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  color: string | null;
  role?: string;
}

export interface ActiveSession {
  id: string;
  guestCount: number;
  totalSpentCents: number;
  startedAt: string;
  status: string;
}

export interface LiveTable {
  id: string;
  tableNumber: string;
  displayLabel?: string | null;
  capacity: number;
  shape: TableShapeKind;
  customPolygon?: unknown;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  sectionId?: string | null;
  isBookable: boolean;
  // Live state
  status: LiveTableStatus;
  seatedAt?: string | null;
  guestCount?: number | null;
  lastStatusChangeAt?: string | null;
  currentServer?: ServerSummary | null;
  activeSession?: ActiveSession | null;
}

export interface LiveSection {
  id: string;
  name: string;
  color: string;
}

export interface LiveFloorPlan {
  id: string;
  name: string;
  floorNumber: number;
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  backgroundUrl: string | null;
  backgroundOpacity: number;
}

export interface LiveReservation {
  id: string;
  customerName: string;
  partySize: number;
  bookedFor: string;
  status: string;
  tableId?: string | null;
  specialOccasion?: string | null;
  notes?: string | null;
}

export interface LiveFloorViewPayload {
  location: { id: string; name: string };
  floorPlan: LiveFloorPlan | null;
  floorPlans: { id: string; name: string; floorNumber: number; isDefault: boolean }[];
  sections: LiveSection[];
  tables: LiveTable[];
  servers: ServerSummary[];
  reservations: LiveReservation[];
  serverTime: string;
}

// ============================================================================
// Status color map — Toast/Heartland convention
// ============================================================================
export const STATUS_COLORS: Record<LiveTableStatus, { bg: string; ring: string; label: string }> = {
  AVAILABLE: { bg: "#FFFFFF", ring: "#9CA3AF", label: "Available" },
  OCCUPIED: { bg: "#10B981", ring: "#059669", label: "Seated" }, // green — server color overrides
  RESERVED: { bg: "#A78BFA", ring: "#7C3AED", label: "Reserved" }, // purple
  CLEANING: { bg: "#FCD34D", ring: "#F59E0B", label: "Cleaning" }, // amber
  BLOCKED: { bg: "#9CA3AF", ring: "#4B5563", label: "Blocked" }, // gray
};

/**
 * Get fill color for a table tile.
 * If a server is assigned to an occupied table, use the server's color.
 * Otherwise fall back to the status color.
 */
export function getTableFillColor(table: LiveTable): string {
  if (table.status === "OCCUPIED" && table.currentServer?.color) {
    return table.currentServer.color;
  }
  return STATUS_COLORS[table.status].bg;
}
