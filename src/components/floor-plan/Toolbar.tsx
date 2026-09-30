"use client";

// ============================================================================
// Toolbar — left palette of shapes to add to the floor plan.
//
// Click a shape → adds a new table at canvas center with that shape's defaults.
// Editor parent handles the actual addition; we just emit the shape kind.
//
// Phase 3 will add: drag-to-position, custom polygon tool, free-text label tool.
// ============================================================================

import { Icon } from "@iconify/react";
import type { TableShapeKind } from "@/lib/floor-plan/types";

interface ToolbarProps {
  onAddTable: (shape: TableShapeKind) => void;
  onAddSection: () => void;
  onStartPolygon?: () => void;
  polygonModeActive?: boolean;
  disabled?: boolean;
}

interface ShapePaletteItem {
  shape: TableShapeKind;
  label: string;
  icon: string;
}

const SHAPE_ITEMS: ShapePaletteItem[] = [
  { shape: "ROUND", label: "Round", icon: "solar:record-circle-bold" },
  { shape: "SQUARE", label: "Square", icon: "solar:square-bold" },
  { shape: "RECTANGLE", label: "Rectangle", icon: "solar:rounded-square-bold" },
  { shape: "BOOTH", label: "Booth", icon: "solar:sofa-2-bold" },
  { shape: "BAR", label: "Bar", icon: "solar:wineglass-triangle-bold" },
];

export default function Toolbar({
  onAddTable,
  onAddSection,
  onStartPolygon,
  polygonModeActive = false,
  disabled,
}: ToolbarProps) {
  return (
    <div className="w-44 bg-white border-r border-gray-200 flex flex-col p-3 space-y-4 overflow-y-auto">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Add Table
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {SHAPE_ITEMS.map((item) => (
            <button
              key={item.shape}
              type="button"
              onClick={() => onAddTable(item.shape)}
              disabled={disabled || polygonModeActive}
              className="flex flex-col items-center gap-1 px-2 py-3 rounded-lg border border-gray-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={`Add ${item.label} table`}
            >
              <Icon icon={item.icon} className="w-6 h-6 text-gray-700" />
              <span className="text-xs text-gray-700">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom polygon tool — separate row because it's a "mode" not a one-click */}
      {onStartPolygon && (
        <div className="pt-3 border-t border-gray-200">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Custom Shape
          </h3>
          <button
            type="button"
            onClick={onStartPolygon}
            disabled={disabled}
            className={`w-full flex flex-col items-center gap-1 px-2 py-3 rounded-lg border transition-colors disabled:opacity-50 ${
              polygonModeActive
                ? "border-indigo-500 bg-indigo-100 text-indigo-900"
                : "border-gray-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-gray-700"
            }`}
            title="Draw custom polygon (L-tables, banquettes)"
          >
            <Icon icon="solar:pen-new-square-bold" className="w-6 h-6" />
            <span className="text-xs font-medium">
              {polygonModeActive ? "Drawing..." : "Polygon"}
            </span>
          </button>
          {polygonModeActive && (
            <p className="text-[10px] text-gray-500 mt-2 leading-tight">
              Click to add points. Click first point or double-click to close. Press Esc to cancel.
            </p>
          )}
        </div>
      )}

      <div className="pt-3 border-t border-gray-200">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Sections
        </h3>
        <button
          type="button"
          onClick={onAddSection}
          disabled={disabled || polygonModeActive}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Icon icon="solar:add-square-bold" className="w-4 h-4" />
          New section
        </button>
      </div>

      {/* Quick links to related tools (built in Phase 3) */}
      <div className="pt-3 border-t border-gray-200">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Related
        </h3>
        <div className="space-y-1.5">
          <a
            href="/dashboard/admin/restaurant-media"
            className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-700 hover:bg-gray-100"
          >
            <Icon icon="solar:gallery-bold" className="w-3.5 h-3.5 text-indigo-600" />
            Media gallery
          </a>
          <a
            href="/dashboard/admin/virtual-tour"
            className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-700 hover:bg-gray-100"
          >
            <Icon icon="solar:vr-bold" className="w-3.5 h-3.5 text-indigo-600" />
            Virtual tour
          </a>
          <a
            href="/dashboard/pos/floor-view"
            className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-700 hover:bg-gray-100"
          >
            <Icon icon="solar:sofa-2-bold" className="w-3.5 h-3.5 text-indigo-600" />
            Live floor view
          </a>
        </div>
      </div>
    </div>
  );
}
