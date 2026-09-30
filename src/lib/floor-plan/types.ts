// ============================================================================
// src/lib/floor-plan/types.ts
//
// Shared types for floor plan editor + live view.
// API responses and frontend state both use these shapes.
// ============================================================================

export type TableShapeKind =
  | "ROUND"
  | "SQUARE"
  | "RECTANGLE"
  | "BOOTH"
  | "BAR"
  | "CUSTOM";

export interface FloorPlanSummary {
  id: string;
  locationId: string;
  name: string;
  floorNumber: number;
  displayOrder: number;
  description?: string | null;
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  backgroundUrl?: string | null;
  backgroundOpacity: number;
  isActive: boolean;
  isDefault: boolean;
  hasUnsavedChanges: boolean;
  currentVersion: number;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FloorPlanDetail extends FloorPlanSummary {
  sections: SectionDto[];
  tables: TableDto[];
}

export interface SectionDto {
  id: string;
  floorPlanId: string;
  name: string;
  color: string;
  displayOrder: number;
  revenueCenter?: string | null;
  minPartySize?: number | null;
  maxPartySize?: number | null;
  isBookable: boolean;
  description?: string | null;
}

export interface TableDto {
  id: string;
  locationId: string;
  floorPlanId?: string | null;
  sectionId?: string | null;
  tableNumber: string;
  displayLabel?: string | null;
  name?: string | null;
  capacity: number;
  minPartySize: number;
  maxPartySize?: number | null;
  shape: TableShapeKind;
  /**
   * For shape=CUSTOM: array of [x,y] points in LOCAL coordinates
   * (relative to the table's bounding box origin). null for non-custom shapes.
   */
  customPolygon?: number[][] | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  revenueCenter?: string | null;
  isBookable: boolean;
  isActive: boolean;
}

// ============================================================================
// API request/response shapes
// ============================================================================

export interface CreateFloorPlanInput {
  name: string;
  floorNumber?: number;
  description?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  isDefault?: boolean;
}

export interface UpdateFloorPlanInput {
  name?: string;
  floorNumber?: number;
  description?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  gridSize?: number;
  backgroundUrl?: string | null;
  backgroundOpacity?: number;
  isActive?: boolean;
  isDefault?: boolean;
}

export interface CreateSectionInput {
  name: string;
  color?: string;
  displayOrder?: number;
  revenueCenter?: string;
  minPartySize?: number;
  maxPartySize?: number;
  isBookable?: boolean;
  description?: string;
}

export interface SaveTablesInput {
  /** Tables to upsert (insert if no id, update if id exists). */
  upsert: Array<{
    id?: string;
    tableNumber: string;
    displayLabel?: string;
    name?: string;
    capacity?: number;
    minPartySize?: number;
    maxPartySize?: number;
    shape?: TableShapeKind;
    sectionId?: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    zIndex?: number;
    revenueCenter?: string;
    isBookable?: boolean;
    isActive?: boolean;
  }>;
  /** Table IDs to delete (removed from canvas) */
  deleteIds?: string[];
}

// ============================================================================
// Canvas state — what the editor manages locally (richer than DTOs)
// ============================================================================

/**
 * Local representation of a table during editing. Adds an `_isNew` flag
 * for unsaved tables (no DB id yet) and `_isDirty` for tracking changes.
 */
export interface CanvasTable extends Omit<TableDto, "id"> {
  /** Real DB id, or temp client id like "tmp-1234" */
  id: string;
  _isNew?: boolean;
  _isDirty?: boolean;
  _isDeleted?: boolean; // marked for deletion on next save
}

// ============================================================================
// Defaults
// ============================================================================

export const TABLE_SHAPE_DEFAULTS: Record<TableShapeKind, { width: number; height: number }> = {
  ROUND: { width: 80, height: 80 },
  SQUARE: { width: 80, height: 80 },
  RECTANGLE: { width: 120, height: 70 },
  BOOTH: { width: 140, height: 90 },
  BAR: { width: 200, height: 50 },
  CUSTOM: { width: 100, height: 100 },
};

export const SHAPE_DISPLAY_NAMES: Record<TableShapeKind, string> = {
  ROUND: "Round",
  SQUARE: "Square",
  RECTANGLE: "Rectangle",
  BOOTH: "Booth",
  BAR: "Bar",
  CUSTOM: "Custom",
};

export const SECTION_COLOR_PRESETS = [
  "#3B82F6", // blue
  "#10B981", // green
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // purple
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#84CC16", // lime
] as const;
