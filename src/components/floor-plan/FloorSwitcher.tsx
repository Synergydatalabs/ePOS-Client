"use client";

// ============================================================================
// FloorSwitcher — horizontal tabs to switch between a location's floor plans.
//
// Phase 2 supports tabs + an "Add floor" button. Phase 3 will add reorder
// (drag tabs) and inline rename.
// ============================================================================

import { Icon } from "@iconify/react";
import type { FloorPlanSummary } from "@/lib/floor-plan/types";

interface FloorSwitcherProps {
  floors: FloorPlanSummary[];
  activeFloorId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  hasUnsavedChanges?: boolean;
}

export default function FloorSwitcher({
  floors,
  activeFloorId,
  onSelect,
  onCreate,
  hasUnsavedChanges,
}: FloorSwitcherProps) {
  return (
    <div className="border-b border-gray-200 bg-white px-4 flex items-center gap-1 overflow-x-auto">
      {floors.map((f) => {
        const active = f.id === activeFloorId;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelect(f.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
              active
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300"
            }`}
          >
            <Icon
              icon={f.isDefault ? "solar:home-bold" : "solar:layers-bold"}
              className="w-4 h-4"
            />
            {f.name}
            {active && hasUnsavedChanges && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved changes" />
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onCreate}
        className="px-3 py-3 text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1 whitespace-nowrap"
        title="Create new floor plan"
      >
        <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
        Add floor
      </button>
    </div>
  );
}
