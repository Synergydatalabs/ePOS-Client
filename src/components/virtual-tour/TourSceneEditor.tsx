"use client";

// ============================================================================
// TourSceneEditor — admin UI to manage hotspots on a 360° scene.
//
// Layout:
//   Top: scene picker (selects which 360° panorama to edit)
//   Center: PannellumViewer in editor mode (click to place hotspot)
//   Right: hotspot list + form for placement
//
// Flow to add a hotspot:
//   1. Pick a scene
//   2. Click "+ Add hotspot" → enter placement mode
//   3. Click somewhere in the panorama → modal opens with yaw/pitch prefilled
//   4. Fill in label + type + target → save
//
// Hotspots show on the canvas immediately. Click an existing hotspot in the
// list to edit or delete it.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import type { TourScene, TourTable, TourHotspot, HotspotType } from "@/lib/virtual-tour/types";

const PannellumViewer = dynamic(() => import("./PannellumViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center bg-black text-white rounded-lg" style={{ height: 500 }}>
      <div className="text-sm">Loading editor…</div>
    </div>
  ),
});

interface TourSceneEditorProps {
  tenantId: string;
  locationId: string;
  scenes: TourScene[];
  tables: TourTable[];
  onChanged: () => void; // parent reloads after API mutations
}

export default function TourSceneEditor({
  tenantId,
  locationId,
  scenes,
  tables,
  onChanged,
}: TourSceneEditorProps) {
  const [activeSceneId, setActiveSceneId] = useState<string | null>(scenes[0]?.id ?? null);
  const [placementMode, setPlacementMode] = useState(false);
  const [newHotspotCoords, setNewHotspotCoords] = useState<{ yaw: number; pitch: number } | null>(null);
  const [editingHotspot, setEditingHotspot] = useState<TourHotspot | null>(null);

  const activeScene = useMemo(
    () => scenes.find((s) => s.id === activeSceneId),
    [scenes, activeSceneId]
  );

  // When scenes list changes (after save), keep activeSceneId valid
  useEffect(() => {
    if (activeSceneId && !scenes.find((s) => s.id === activeSceneId)) {
      setActiveSceneId(scenes[0]?.id ?? null);
    } else if (!activeSceneId && scenes.length > 0) {
      setActiveSceneId(scenes[0].id);
    }
  }, [scenes, activeSceneId]);

  if (scenes.length === 0) {
    return (
      <div className="text-center bg-gray-50 border border-gray-200 rounded-xl p-10">
        <Icon icon="solar:vr-bold" className="w-12 h-12 text-gray-400 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-gray-900 mb-2">No 360° scenes yet</h3>
        <p className="text-sm text-gray-600 max-w-md mx-auto">
          Go to <strong>Media Gallery</strong>, upload an equirectangular 360° panorama
          (2:1 aspect ratio image, e.g. 4000×2000 px), then mark it as &quot;360° panorama&quot;
          with a scene name. It will appear here.
        </p>
      </div>
    );
  }

  const handleCanvasClick = (yaw: number, pitch: number) => {
    if (!placementMode) return;
    setNewHotspotCoords({ yaw, pitch });
    setPlacementMode(false);
  };

  const handleSaveNewHotspot = async (input: HotspotFormData) => {
    if (!activeScene || !newHotspotCoords) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/tour/scenes/${activeScene.id}/hotspots`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            yaw: newHotspotCoords.yaw,
            pitch: newHotspotCoords.pitch,
            ...input,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`Hotspot "${input.label}" added`);
      setNewHotspotCoords(null);
      onChanged();
    } catch (err: any) {
      toast.error(`Failed to add hotspot: ${err?.message ?? "unknown"}`);
    }
  };

  const handleUpdateHotspot = async (id: string, input: Partial<HotspotFormData>) => {
    if (!activeScene) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/tour/scenes/${activeScene.id}/hotspots/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success("Hotspot updated");
      setEditingHotspot(null);
      onChanged();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    }
  };

  const handleDeleteHotspot = async (h: TourHotspot) => {
    if (!activeScene) return;
    if (!confirm(`Delete hotspot "${h.label}"?`)) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/tour/scenes/${activeScene.id}/hotspots/${h.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Hotspot deleted");
      setEditingHotspot(null);
      onChanged();
    } catch (err: any) {
      toast.error(`Delete failed: ${err?.message ?? "unknown"}`);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Center pane: viewer */}
      <div className="lg:col-span-2 space-y-3">
        {/* Scene picker */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Scene:
          </span>
          {scenes.map((s) => {
            const active = s.id === activeSceneId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setActiveSceneId(s.id);
                  setPlacementMode(false);
                }}
                className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                  active
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white border-gray-300 hover:border-indigo-400 text-gray-700"
                }`}
              >
                {s.sceneName || "Untitled"}
                {s.isDefaultScene && (
                  <span className="ml-1 text-xs">★</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Viewer */}
        {activeScene && (
          <div className="relative">
            <PannellumViewer
              key={activeScene.id + (placementMode ? "-place" : "")}
              imageUrl={activeScene.publicUrl}
              initialYaw={activeScene.initialYaw ?? 0}
              initialPitch={activeScene.initialPitch ?? 0}
              initialFov={activeScene.initialFov ?? 90}
              hotspots={activeScene.hotspots}
              onHotspotClick={(h) => setEditingHotspot(h)}
              onCanvasClick={handleCanvasClick}
              height={500}
            />

            {/* Placement mode banner */}
            {placementMode && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-indigo-600 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg pointer-events-none">
                Click anywhere in the panorama to place a hotspot
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between items-center">
          <button
            type="button"
            onClick={() => setPlacementMode(!placementMode)}
            disabled={!activeScene}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 ${
              placementMode
                ? "bg-gray-200 text-gray-700 hover:bg-gray-300"
                : "bg-indigo-600 text-white hover:bg-indigo-700"
            } disabled:opacity-50`}
          >
            <Icon
              icon={placementMode ? "solar:close-circle-bold" : "solar:add-circle-bold"}
              className="w-4 h-4"
            />
            {placementMode ? "Cancel placement" : "Add hotspot"}
          </button>
          <span className="text-xs text-gray-500">
            {activeScene?.hotspots.length ?? 0} hotspot(s) on this scene
          </span>
        </div>
      </div>

      {/* Right pane: hotspot list */}
      <div className="space-y-3">
        <h3 className="font-semibold text-gray-900">Hotspots</h3>
        {!activeScene || activeScene.hotspots.length === 0 ? (
          <div className="text-center bg-gray-50 rounded-lg p-6 text-sm text-gray-500">
            No hotspots yet. Click <strong>Add hotspot</strong> to place one.
          </div>
        ) : (
          <ul className="space-y-2 max-h-[500px] overflow-y-auto">
            {activeScene.hotspots.map((h) => (
              <li
                key={h.id}
                onClick={() => setEditingHotspot(h)}
                className="bg-white border border-gray-200 rounded-lg p-3 hover:border-indigo-400 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <HotspotTypeBadge type={h.hotspotType} />
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {h.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      yaw {h.yaw.toFixed(1)}°, pitch {h.pitch.toFixed(1)}°
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* New hotspot dialog (after canvas click) */}
      {newHotspotCoords && activeScene && (
        <HotspotDialog
          mode="create"
          coords={newHotspotCoords}
          scenes={scenes.filter((s) => s.id !== activeScene.id)}
          tables={tables}
          onClose={() => setNewHotspotCoords(null)}
          onSave={handleSaveNewHotspot}
        />
      )}

      {/* Edit hotspot dialog (after list click) */}
      {editingHotspot && activeScene && (
        <HotspotDialog
          mode="edit"
          coords={{ yaw: editingHotspot.yaw, pitch: editingHotspot.pitch }}
          existing={editingHotspot}
          scenes={scenes.filter((s) => s.id !== activeScene.id)}
          tables={tables}
          onClose={() => setEditingHotspot(null)}
          onSave={(input) => handleUpdateHotspot(editingHotspot.id, input)}
          onDelete={() => handleDeleteHotspot(editingHotspot)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function HotspotTypeBadge({ type }: { type: HotspotType }) {
  const styles: Record<HotspotType, { bg: string; text: string; label: string }> = {
    SCENE_LINK: { bg: "bg-indigo-100", text: "text-indigo-800", label: "Walk" },
    TABLE_LINK: { bg: "bg-amber-100", text: "text-amber-800", label: "Table" },
    EXTERNAL_URL: { bg: "bg-emerald-100", text: "text-emerald-800", label: "Link" },
    INFO: { bg: "bg-gray-100", text: "text-gray-800", label: "Info" },
  };
  const s = styles[type];
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

interface HotspotFormData {
  hotspotType: HotspotType;
  label: string;
  targetSceneMediaId?: string;
  targetTableId?: string;
  externalUrl?: string;
  targetYaw?: number;
  targetPitch?: number;
}

interface HotspotDialogProps {
  mode: "create" | "edit";
  coords: { yaw: number; pitch: number };
  existing?: TourHotspot;
  scenes: TourScene[];
  tables: TourTable[];
  onClose: () => void;
  onSave: (input: HotspotFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
}

function HotspotDialog({
  mode,
  coords,
  existing,
  scenes,
  tables,
  onClose,
  onSave,
  onDelete,
}: HotspotDialogProps) {
  const [hotspotType, setHotspotType] = useState<HotspotType>(
    existing?.hotspotType ?? "SCENE_LINK"
  );
  const [label, setLabel] = useState(existing?.label ?? "");
  const [targetSceneMediaId, setTargetSceneMediaId] = useState<string>(
    existing?.targetSceneMediaId ?? ""
  );
  const [targetTableId, setTargetTableId] = useState<string>(existing?.targetTableId ?? "");
  const [externalUrl, setExternalUrl] = useState<string>(existing?.externalUrl ?? "");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!label.trim()) {
      toast.error("Label required");
      return;
    }
    // Validate target by type
    if (hotspotType === "SCENE_LINK" && !targetSceneMediaId) {
      toast.error("Pick a target scene");
      return;
    }
    if (hotspotType === "TABLE_LINK" && !targetTableId) {
      toast.error("Pick a target table");
      return;
    }
    if (hotspotType === "EXTERNAL_URL" && !externalUrl) {
      toast.error("Enter an external URL");
      return;
    }

    setBusy(true);
    try {
      await onSave({
        hotspotType,
        label: label.trim(),
        ...(hotspotType === "SCENE_LINK" && { targetSceneMediaId }),
        ...(hotspotType === "TABLE_LINK" && { targetTableId }),
        ...(hotspotType === "EXTERNAL_URL" && { externalUrl: externalUrl.trim() }),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            {mode === "create" ? "Add hotspot" : "Edit hotspot"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Position (read-only) */}
          <div className="text-xs text-gray-500">
            Position: yaw {coords.yaw.toFixed(1)}°, pitch {coords.pitch.toFixed(1)}°
          </div>

          {/* Hotspot type */}
          <Field label="Type">
            <select
              value={hotspotType}
              onChange={(e) => setHotspotType(e.target.value as HotspotType)}
              disabled={busy}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="SCENE_LINK">Walk to another scene</option>
              <option value="TABLE_LINK">Book a table</option>
              <option value="INFO">Info popup</option>
              <option value="EXTERNAL_URL">External link</option>
            </select>
          </Field>

          {/* Label */}
          <Field label="Label (shown on hover)">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Go to bar, View menu, Book table 12"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              disabled={busy}
            />
          </Field>

          {/* Conditional target field */}
          {hotspotType === "SCENE_LINK" && (
            <Field label="Target scene">
              <select
                value={targetSceneMediaId}
                onChange={(e) => setTargetSceneMediaId(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="">— Pick a scene —</option>
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sceneName || "Untitled"}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {hotspotType === "TABLE_LINK" && (
            <Field label="Target table">
              <select
                value={targetTableId}
                onChange={(e) => setTargetTableId(e.target.value)}
                disabled={busy}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="">— Pick a table —</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    Table {t.tableNumber}
                    {t.section ? ` (${t.section.name})` : ""} — fits {t.capacity}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {hotspotType === "EXTERNAL_URL" && (
            <Field label="URL">
              <input
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                disabled={busy}
              />
            </Field>
          )}

          {hotspotType === "INFO" && (
            <p className="text-xs text-gray-500">
              Info hotspots show the label as a popup when clicked. No target needed.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-between gap-2">
          {mode === "edit" && onDelete ? (
            <button
              onClick={onDelete}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={busy}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Saving..." : mode === "create" ? "Add" : "Save"}
            </button>
          </div>
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
