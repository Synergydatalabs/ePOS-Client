"use client";

// ============================================================================
// SectionPanel — modal for managing sections.
//
// Opened from Toolbar's "New section" button. Lists existing sections,
// allows creating a new one with a name + color picker.
// Deletion handled via X button per row.
// ============================================================================

import { useState } from "react";
import { Icon } from "@iconify/react";
import { SECTION_COLOR_PRESETS, type SectionDto } from "@/lib/floor-plan/types";

interface SectionPanelProps {
  open: boolean;
  sections: SectionDto[];
  onClose: () => void;
  onCreate: (input: { name: string; color: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function SectionPanel({
  open,
  sections,
  onClose,
  onCreate,
  onDelete,
}: SectionPanelProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(SECTION_COLOR_PRESETS[0]);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), color });
      setName("");
      setColor(SECTION_COLOR_PRESETS[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Manage sections</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
          >
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>

        {/* Create form */}
        <div className="px-5 py-4 border-b border-gray-100 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Section name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bar, Patio, VIP, Window Side..."
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={busy}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
            <div className="flex gap-2 flex-wrap">
              {SECTION_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  disabled={busy}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${
                    color === c ? "border-gray-900 scale-110" : "border-white"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !name.trim()}
            className="w-full py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Adding..." : "Add section"}
          </button>
        </div>

        {/* Existing sections */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {sections.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              No sections yet. Add one above.
            </p>
          ) : (
            <ul className="space-y-2">
              {sections.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200"
                >
                  <span
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="flex-1 text-sm font-medium text-gray-900">{s.name}</span>
                  <button
                    type="button"
                    onClick={() => onDelete(s.id)}
                    className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                  >
                    <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
