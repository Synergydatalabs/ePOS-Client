"use client";

// ============================================================================
// TableInspector — right sidebar showing properties of the selected table.
//
// Edits flow up to parent via onChange. Empty state shown when nothing
// selected. Delete button removes the table from canvas (marks _isDeleted).
// ============================================================================

import { Icon } from "@iconify/react";
import {
  type CanvasTable,
  type SectionDto,
  type TableShapeKind,
  SHAPE_DISPLAY_NAMES,
} from "@/lib/floor-plan/types";

interface TableInspectorProps {
  selectedTable: CanvasTable | null;
  sections: SectionDto[];
  onChange: (updates: Partial<CanvasTable>) => void;
  onDelete: () => void;
}

const SHAPE_OPTIONS: TableShapeKind[] = ["ROUND", "SQUARE", "RECTANGLE", "BOOTH", "BAR"];

export default function TableInspector({
  selectedTable,
  sections,
  onChange,
  onDelete,
}: TableInspectorProps) {
  if (!selectedTable) {
    return (
      <div className="w-72 bg-white border-l border-gray-200 p-6 flex flex-col items-center justify-center text-center">
        <Icon icon="solar:hand-pointing-bold" className="w-12 h-12 text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">
          Click a table on the canvas to edit its properties
        </p>
      </div>
    );
  }

  const t = selectedTable;

  return (
    <div className="w-72 bg-white border-l border-gray-200 p-4 overflow-y-auto space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Table properties</h3>
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
          title="Delete table"
        >
          <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
        </button>
      </div>

      {/* Table number */}
      <Field label="Table number">
        <input
          type="text"
          value={t.tableNumber}
          onChange={(e) => onChange({ tableNumber: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="1, A-12, Patio-3..."
        />
      </Field>

      {/* Display label (optional alt) */}
      <Field label="Display label (optional)">
        <input
          type="text"
          value={t.displayLabel ?? ""}
          onChange={(e) => onChange({ displayLabel: e.target.value || undefined })}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Window Seat, VIP Booth..."
        />
      </Field>

      {/* Shape */}
      <Field label="Shape">
        <select
          value={t.shape}
          onChange={(e) => onChange({ shape: e.target.value as TableShapeKind })}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {SHAPE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {SHAPE_DISPLAY_NAMES[s]}
            </option>
          ))}
        </select>
      </Field>

      {/* Section */}
      <Field label="Section">
        <select
          value={t.sectionId ?? ""}
          onChange={(e) =>
            onChange({ sectionId: e.target.value || null })
          }
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">— None —</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      {/* Capacity */}
      <Field label="Capacity (seats)">
        <input
          type="number"
          min={1}
          max={50}
          value={t.capacity}
          onChange={(e) => onChange({ capacity: parseInt(e.target.value) || 1 })}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </Field>

      {/* Min/Max party size */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Min party">
          <input
            type="number"
            min={1}
            value={t.minPartySize}
            onChange={(e) =>
              onChange({ minPartySize: parseInt(e.target.value) || 1 })
            }
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Field>
        <Field label="Max party">
          <input
            type="number"
            min={1}
            value={t.maxPartySize ?? t.capacity}
            onChange={(e) =>
              onChange({ maxPartySize: parseInt(e.target.value) || undefined })
            }
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Field>
      </div>

      {/* Dimensions (read-only — drag to resize in Phase 3) */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Width">
          <input
            type="number"
            value={Math.round(t.width)}
            onChange={(e) => onChange({ width: parseInt(e.target.value) || 80 })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Field>
        <Field label="Height">
          <input
            type="number"
            value={Math.round(t.height)}
            onChange={(e) => onChange({ height: parseInt(e.target.value) || 80 })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Field>
      </div>

      {/* Bookable toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={t.isBookable}
          onChange={(e) => onChange({ isBookable: e.target.checked })}
          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span className="text-sm text-gray-700">Available for reservations</span>
      </label>

      {/* Position info (read-only display) */}
      <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
        Position: ({Math.round(t.x)}, {Math.round(t.y)})
        {t._isNew && (
          <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
            New (unsaved)
          </span>
        )}
        {t._isDirty && !t._isNew && (
          <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
            Modified
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
