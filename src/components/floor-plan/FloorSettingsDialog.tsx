"use client";

// ============================================================================
// FloorSettingsDialog — modal to edit floor plan metadata:
//   - name (inline rename, replaces the browser prompt)
//   - canvas width / height
//   - grid size
//   - background image upload + opacity slider
//   - delete floor plan
//
// Calls PATCH /api/.../floor-plans/[id] for metadata, plus the bg uploader
// (which calls the upload presign/confirm endpoints).
// ============================================================================

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import BackgroundUploader from "./BackgroundUploader";
import type { FloorPlanSummary, FloorPlanDetail } from "@/lib/floor-plan/types";

interface FloorSettingsDialogProps {
  open: boolean;
  tenantId: string;
  locationId: string;
  floor: FloorPlanDetail | FloorPlanSummary | null;
  onClose: () => void;
  onSaved: () => void;       // parent reloads floor data
  onDeleted: () => void;     // parent picks another floor
}

export default function FloorSettingsDialog({
  open,
  tenantId,
  locationId,
  floor,
  onClose,
  onSaved,
  onDeleted,
}: FloorSettingsDialogProps) {
  const [name, setName] = useState("");
  const [canvasWidth, setCanvasWidth] = useState(1200);
  const [canvasHeight, setCanvasHeight] = useState(800);
  const [gridSize, setGridSize] = useState(20);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.5);
  const [busy, setBusy] = useState(false);

  // Initialize from floor when dialog opens
  useEffect(() => {
    if (open && floor) {
      setName(floor.name);
      setCanvasWidth(floor.canvasWidth);
      setCanvasHeight(floor.canvasHeight);
      setGridSize(floor.gridSize);
      setBackgroundUrl(floor.backgroundUrl ?? null);
      setBackgroundOpacity(floor.backgroundOpacity);
    }
  }, [open, floor]);

  if (!open || !floor) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Floor name is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans/${floor.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            canvasWidth,
            canvasHeight,
            gridSize,
            backgroundUrl,
            backgroundOpacity,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Save failed (${res.status})`);
      }
      toast.success("Floor settings saved");
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(`Save failed: ${err?.message || "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete floor plan "${floor.name}"? This will remove it from the editor but preserve order history.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans/${floor.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Delete failed (${res.status})`);
      }
      toast.success("Floor plan deleted");
      onDeleted();
      onClose();
    } catch (err: any) {
      toast.error(`Delete failed: ${err?.message || "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Floor plan settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
          >
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Name */}
          <Field label="Floor name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Main Dining, Patio..."
              disabled={busy}
            />
          </Field>

          {/* Dimensions */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Canvas width (px)">
              <input
                type="number"
                min={400}
                max={8000}
                step={100}
                value={canvasWidth}
                onChange={(e) => setCanvasWidth(parseInt(e.target.value) || 1200)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={busy}
              />
            </Field>
            <Field label="Canvas height (px)">
              <input
                type="number"
                min={400}
                max={8000}
                step={100}
                value={canvasHeight}
                onChange={(e) => setCanvasHeight(parseInt(e.target.value) || 800)}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={busy}
              />
            </Field>
          </div>

          {/* Grid */}
          <Field label={`Grid size: ${gridSize}px`}>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={gridSize}
              onChange={(e) => setGridSize(parseInt(e.target.value))}
              className="w-full"
              disabled={busy}
            />
            <p className="text-xs text-gray-500 mt-1">
              Smaller = finer placement. Tables snap to nearest grid intersection.
            </p>
          </Field>

          {/* Background image */}
          <Field label="Background image (architect drawing)">
            <BackgroundUploader
              tenantId={tenantId}
              currentUrl={backgroundUrl}
              onUploaded={(url) => setBackgroundUrl(url)}
              onCleared={() => setBackgroundUrl(null)}
            />
          </Field>

          {/* Opacity */}
          {backgroundUrl && (
            <Field label={`Background opacity: ${Math.round(backgroundOpacity * 100)}%`}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(backgroundOpacity * 100)}
                onChange={(e) => setBackgroundOpacity(parseInt(e.target.value) / 100)}
                className="w-full"
                disabled={busy}
              />
              <p className="text-xs text-gray-500 mt-1">
                Lower opacity = background fades, tables stand out more.
              </p>
            </Field>
          )}

          {/* Danger zone */}
          <div className="pt-3 border-t border-gray-200">
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="w-full text-sm text-red-700 border border-red-200 rounded-md py-2 hover:bg-red-50 disabled:opacity-50"
            >
              Delete this floor plan
            </button>
            <p className="text-xs text-gray-500 mt-1 text-center">
              Soft-deletes — tables preserved for order history.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 rounded-md text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy || !name.trim()}
            className="px-4 py-1.5 rounded-md text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save settings"}
          </button>
        </div>
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
