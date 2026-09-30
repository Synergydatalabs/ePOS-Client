"use client";

// ============================================================================
// FloorPlanEditor — the main editor shell.
//
// Orchestrates:
//   - Loading floor plans for the active location
//   - Selecting/switching floors
//   - Maintaining canvas state (tables, selected, dirty)
//   - Save Draft / Publish flow
//
// Konva needs window — we use dynamic import in the page to keep it client-only.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import Toolbar from "./Toolbar";
import TableInspector from "./TableInspector";
import SectionPanel from "./SectionPanel";
import FloorSwitcher from "./FloorSwitcher";
import FloorSettingsDialog from "./FloorSettingsDialog";
import VersionHistoryDialog from "./VersionHistoryDialog";
import {
  type CanvasTable,
  type FloorPlanDetail,
  type FloorPlanSummary,
  type SectionDto,
  type TableDto,
  type TableShapeKind,
  TABLE_SHAPE_DEFAULTS,
} from "@/lib/floor-plan/types";

// Konva must be client-only (uses canvas / window)
const CanvasStage = dynamic(() => import("./CanvasStage"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center bg-gray-50 border border-gray-300 rounded-lg" style={{ width: 800, height: 600 }}>
      <div className="text-gray-500 text-sm">Loading canvas...</div>
    </div>
  ),
});

interface FloorPlanEditorProps {
  tenantId: string;
  locationId: string;
}

// Generate a temporary client-side ID for new (unsaved) tables
let tmpCounter = 0;
const makeTmpId = () => `tmp-${Date.now()}-${++tmpCounter}`;

function tableDtoToCanvas(t: TableDto): CanvasTable {
  return { ...t, _isNew: false, _isDirty: false, _isDeleted: false };
}

export default function FloorPlanEditor({ tenantId, locationId }: FloorPlanEditorProps) {
  // List of all floors at this location
  const [floors, setFloors] = useState<FloorPlanSummary[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);

  // Detail of active floor
  const [activeFloor, setActiveFloor] = useState<FloorPlanDetail | null>(null);
  const [sections, setSections] = useState<SectionDto[]>([]);
  const [tables, setTables] = useState<CanvasTable[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [sectionPanelOpen, setSectionPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editor preferences (per-session)
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [lastAutoSaveAt, setLastAutoSaveAt] = useState<Date | null>(null);

  // Polygon drawing mode (Phase 3b — custom shapes)
  const [polygonModeActive, setPolygonModeActive] = useState(false);

  // Refs for autosave debounce
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ────────────────────────── data fetching ──────────────────────────

  const loadFloors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: FloorPlanSummary[] = data.plans || [];
      setFloors(list);

      // Auto-select first/default floor on initial load
      if (!activeFloorId && list.length > 0) {
        const def = list.find((f) => f.isDefault) ?? list[0];
        setActiveFloorId(def.id);
      } else if (activeFloorId && !list.some((f) => f.id === activeFloorId)) {
        // Active floor was deleted — pick another
        setActiveFloorId(list[0]?.id ?? null);
      }
    } catch (err: any) {
      toast.error(`Couldn't load floor plans: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId, activeFloorId]);

  const loadActiveFloor = useCallback(async () => {
    if (!activeFloorId) {
      setActiveFloor(null);
      setSections([]);
      setTables([]);
      setDeletedIds([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans/${activeFloorId}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const plan: FloorPlanDetail = data.plan;
      setActiveFloor(plan);
      setSections(plan.sections);
      setTables(plan.tables.map(tableDtoToCanvas));
      setDeletedIds([]);
      setSelectedTableId(null);
    } catch (err: any) {
      toast.error(`Couldn't load floor: ${err.message}`);
    }
  }, [tenantId, locationId, activeFloorId]);

  useEffect(() => {
    loadFloors();
  }, [loadFloors]);

  useEffect(() => {
    loadActiveFloor();
  }, [loadActiveFloor]);

  // ────────────────────────── autosave ──────────────────────────
  //
  // Debounced — every 30 seconds of inactivity, if dirty, save silently.
  // The 30s is the "settled" timer: any new change resets it, so we never
  // save in the middle of a drag.
  useEffect(() => {
    if (!autosaveEnabled || !activeFloor) return;
    const hasChanges =
      deletedIds.length > 0 || tables.some((t) => t._isNew || t._isDirty);
    if (!hasChanges) return;

    // Clear existing timer
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      handleSaveDraft({ silent: true });
    }, 30_000);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, deletedIds, autosaveEnabled, activeFloor?.id]);

  // ────────────────────────── canvas helpers ──────────────────────────

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedTableId) ?? null,
    [tables, selectedTableId]
  );

  const isDirty =
    deletedIds.length > 0 || tables.some((t) => t._isNew || t._isDirty);

  /**
   * Called when user finishes drawing a custom polygon on the canvas.
   * `points` is a flat array [x1,y1,x2,y2,...] in canvas coords.
   *
   * We convert it into a new CanvasTable:
   *   - shape: CUSTOM
   *   - x/y: bounding box top-left (so position is normalized)
   *   - width/height: bounding box dimensions
   *   - customPolygon: points translated to LOCAL coords (relative to x,y)
   *
   * Future point editing (drag individual vertices) comes in Phase 3c.
   */
  const handlePolygonComplete = (points: number[]) => {
    if (!activeFloor || points.length < 6) {
      setPolygonModeActive(false);
      return;
    }

    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i];
      const y = points[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    if (width < 30 || height < 30) {
      toast.error("Polygon too small — minimum 30×30 px");
      setPolygonModeActive(false);
      return;
    }

    // Translate to local coords (relative to bounding box origin)
    const localPolygon: number[][] = [];
    for (let i = 0; i < points.length; i += 2) {
      localPolygon.push([points[i] - minX, points[i + 1] - minY]);
    }

    // Auto-number
    const existingNums = tables
      .filter((t) => /^\d+$/.test(t.tableNumber))
      .map((t) => parseInt(t.tableNumber, 10));
    const nextNum = (existingNums.length > 0 ? Math.max(...existingNums) : 0) + 1;

    const newTable: CanvasTable = {
      id: makeTmpId(),
      locationId,
      floorPlanId: activeFloor.id,
      sectionId: null,
      tableNumber: String(nextNum),
      displayLabel: null,
      name: null,
      capacity: 4,
      minPartySize: 1,
      maxPartySize: null,
      shape: "CUSTOM",
      customPolygon: localPolygon,
      x: minX,
      y: minY,
      width,
      height,
      rotation: 0,
      zIndex: 0,
      revenueCenter: null,
      isBookable: true,
      isActive: true,
      _isNew: true,
      _isDirty: true,
    };

    setTables((prev) => [...prev, newTable]);
    setSelectedTableId(newTable.id);
    setPolygonModeActive(false);
    toast.success(`Custom shape added — table ${nextNum}`);
  };

  const handleAddTable = (shape: TableShapeKind) => {
    if (!activeFloor) return;
    const sizes = TABLE_SHAPE_DEFAULTS[shape];

    // Drop new table near canvas center, with small random offset to avoid stacking
    const cx = activeFloor.canvasWidth / 2 - sizes.width / 2;
    const cy = activeFloor.canvasHeight / 2 - sizes.height / 2;
    const jitter = () => (Math.random() - 0.5) * 40;

    // Auto-generate table number based on existing
    const existingNums = tables
      .filter((t) => /^\d+$/.test(t.tableNumber))
      .map((t) => parseInt(t.tableNumber, 10));
    const nextNum = (existingNums.length > 0 ? Math.max(...existingNums) : 0) + 1;

    const newTable: CanvasTable = {
      id: makeTmpId(),
      locationId,
      floorPlanId: activeFloor.id,
      sectionId: null,
      tableNumber: String(nextNum),
      displayLabel: null,
      name: null,
      capacity: 4,
      minPartySize: 1,
      maxPartySize: null,
      shape,
      x: cx + jitter(),
      y: cy + jitter(),
      width: sizes.width,
      height: sizes.height,
      rotation: 0,
      zIndex: 0,
      revenueCenter: null,
      isBookable: true,
      isActive: true,
      _isNew: true,
      _isDirty: true,
    };

    setTables((prev) => [...prev, newTable]);
    setSelectedTableId(newTable.id);
  };

  const handleMoveTable = (id: string, x: number, y: number) => {
    setTables((prev) =>
      prev.map((t) => (t.id === id ? { ...t, x, y, _isDirty: true } : t))
    );
  };

  /** Konva Transformer end — resize + rotation in one event. */
  const handleTransformTable = (
    id: string,
    updates: { x: number; y: number; width: number; height: number; rotation: number }
  ) => {
    setTables((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              x: updates.x,
              y: updates.y,
              width: updates.width,
              height: updates.height,
              rotation: updates.rotation,
              _isDirty: true,
            }
          : t
      )
    );
  };

  const handleUpdateTable = (updates: Partial<CanvasTable>) => {
    if (!selectedTableId) return;
    setTables((prev) =>
      prev.map((t) =>
        t.id === selectedTableId ? { ...t, ...updates, _isDirty: true } : t
      )
    );
  };

  const handleDeleteTable = () => {
    if (!selectedTableId) return;
    const t = tables.find((x) => x.id === selectedTableId);
    if (!t) return;

    // New (never-saved) tables: just drop from state
    if (t._isNew) {
      setTables((prev) => prev.filter((x) => x.id !== selectedTableId));
    } else {
      // Already-saved tables: mark _isDeleted (hidden from canvas) and queue for server delete
      setTables((prev) =>
        prev.map((x) =>
          x.id === selectedTableId ? { ...x, _isDeleted: true } : x
        )
      );
      setDeletedIds((prev) => [...prev, selectedTableId]);
    }
    setSelectedTableId(null);
  };

  // ────────────────────────── sections ──────────────────────────

  const handleCreateSection = async (input: { name: string; color: string }) => {
    if (!activeFloor) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans/${activeFloor.id}/sections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSections((prev) => [...prev, data.section]);
      toast.success(`Section "${input.name}" created`);
    } catch (err: any) {
      toast.error(`Couldn't create section: ${err.message}`);
    }
  };

  const handleDeleteSection = async (id: string) => {
    if (!activeFloor) return;
    if (!confirm("Delete this section? Tables in it will be unassigned.")) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans/${activeFloor.id}/sections`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [id] }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSections((prev) => prev.filter((s) => s.id !== id));
      // Unassign tables that were in this section
      setTables((prev) =>
        prev.map((t) => (t.sectionId === id ? { ...t, sectionId: null, _isDirty: true } : t))
      );
    } catch (err: any) {
      toast.error(`Couldn't delete section: ${err.message}`);
    }
  };

  // ────────────────────────── save / publish ──────────────────────────

  /**
   * Save draft to backend.
   * @param opts.silent — true for autosave (no toast, no busy spinner UI)
   */
  const handleSaveDraft = async (opts: { silent?: boolean } = {}) => {
    if (!activeFloor) return;
    if (!opts.silent) setSaving(true);
    try {
      const upsert = tables
        .filter((t) => !t._isDeleted)
        .filter((t) => t._isNew || t._isDirty)
        .map((t) => ({
          id: t._isNew ? undefined : t.id,
          tableNumber: t.tableNumber,
          displayLabel: t.displayLabel ?? undefined,
          name: t.name ?? undefined,
          capacity: t.capacity,
          minPartySize: t.minPartySize,
          maxPartySize: t.maxPartySize ?? undefined,
          shape: t.shape,
          customPolygon: t.customPolygon ?? undefined,
          sectionId: t.sectionId ?? undefined,
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
          rotation: t.rotation,
          zIndex: t.zIndex,
          revenueCenter: t.revenueCenter ?? undefined,
          isBookable: t.isBookable,
          isActive: true,
        }));

      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans/${activeFloor.id}/tables`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ upsert, deleteIds: deletedIds }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      if (!opts.silent) toast.success("Draft saved");
      // Reload to get fresh DB IDs for newly-created tables
      await loadActiveFloor();
      if (opts.silent) setLastAutoSaveAt(new Date());
    } catch (err: any) {
      if (!opts.silent) {
        toast.error(`Save failed: ${err.message}`);
      } else {
        // Autosave failures stay quiet but log
        console.warn("[autosave] failed:", err);
      }
    } finally {
      if (!opts.silent) setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!activeFloor) return;
    if (isDirty) {
      if (!confirm("Save and publish all pending changes?")) return;
      await handleSaveDraft();
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans/${activeFloor.id}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(`Published version ${data.version}`);
      await loadFloors();
      await loadActiveFloor();
    } catch (err: any) {
      toast.error(`Publish failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ────────────────────────── new floor creation ──────────────────────────

  const handleCreateFloor = async () => {
    const name = prompt("Floor name (e.g. Main Dining, Patio):");
    if (!name?.trim()) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      await loadFloors();
      setActiveFloorId(data.plan.id);
      toast.success(`Created "${data.plan.name}"`);
    } catch (err: any) {
      toast.error(`Create failed: ${err.message}`);
    }
  };

  // ────────────────────────── render ──────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (floors.length === 0) {
    return (
      <div className="text-center py-20 max-w-md mx-auto">
        <Icon icon="solar:layers-bold" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No floor plans yet</h2>
        <p className="text-gray-600 mb-6 text-sm">
          Create your first floor plan to start arranging tables, sections, and seating.
        </p>
        <button
          onClick={handleCreateFloor}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
        >
          <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
          Create floor plan
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Floor tabs */}
      <FloorSwitcher
        floors={floors}
        activeFloorId={activeFloorId}
        onSelect={setActiveFloorId}
        onCreate={handleCreateFloor}
        hasUnsavedChanges={isDirty}
      />

      {/* Action bar */}
      <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-700 flex items-center gap-2">
          {activeFloor ? (
            <>
              <span className="font-medium">{activeFloor.name}</span>
              <span className="text-gray-500">
                {tables.filter((t) => !t._isDeleted).length} tables · {sections.length} sections
              </span>
              {isDirty && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">
                  Unsaved changes
                </span>
              )}
              {!isDirty && lastAutoSaveAt && (
                <span className="text-xs text-gray-400" title={lastAutoSaveAt.toLocaleString()}>
                  Autosaved {timeAgo(lastAutoSaveAt)}
                </span>
              )}
            </>
          ) : (
            "Select a floor"
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Toggles */}
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={(e) => setSnapEnabled(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
            />
            <Icon icon="solar:transmission-bold" className="w-3.5 h-3.5" />
            Snap
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autosaveEnabled}
              onChange={(e) => setAutosaveEnabled(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
            />
            <Icon icon="solar:diskette-bold" className="w-3.5 h-3.5" />
            Autosave
          </label>

          {/* Vertical divider */}
          <span className="h-5 w-px bg-gray-300 mx-1" />

          <button
            onClick={() => setHistoryOpen(true)}
            disabled={!activeFloor}
            title="View version history"
            className="p-1.5 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            <Icon icon="solar:history-bold" className="w-4 h-4" />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            disabled={!activeFloor}
            title="Floor plan settings"
            className="p-1.5 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            <Icon icon="solar:settings-bold" className="w-4 h-4" />
          </button>

          <span className="h-5 w-px bg-gray-300 mx-1" />

          <button
            onClick={() => handleSaveDraft()}
            disabled={saving || !isDirty}
            className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save draft"}
          </button>
          <button
            onClick={handlePublish}
            disabled={saving}
            className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>

      {/* Main 3-pane layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: shape palette + sections button */}
        <Toolbar
          onAddTable={handleAddTable}
          onAddSection={() => setSectionPanelOpen(true)}
          onStartPolygon={() => setPolygonModeActive(true)}
          polygonModeActive={polygonModeActive}
          disabled={!activeFloor}
        />

        {/* Center: canvas */}
        <div className="flex-1 overflow-auto p-6 bg-gray-100">
          {activeFloor ? (
            <CanvasStage
              width={activeFloor.canvasWidth}
              height={activeFloor.canvasHeight}
              gridSize={activeFloor.gridSize}
              backgroundUrl={activeFloor.backgroundUrl ?? undefined}
              backgroundOpacity={activeFloor.backgroundOpacity}
              snapEnabled={snapEnabled}
              tables={tables}
              sections={sections}
              selectedTableId={selectedTableId}
              polygonDrawMode={polygonModeActive}
              onSelectTable={setSelectedTableId}
              onMoveTable={handleMoveTable}
              onTransformTable={handleTransformTable}
              onPolygonComplete={handlePolygonComplete}
              onPolygonCancel={() => setPolygonModeActive(false)}
            />
          ) : (
            <div className="text-gray-400 text-sm">No floor selected</div>
          )}
        </div>

        {/* Right: inspector */}
        <TableInspector
          selectedTable={selectedTable}
          sections={sections}
          onChange={handleUpdateTable}
          onDelete={handleDeleteTable}
        />
      </div>

      {/* Section panel modal */}
      <SectionPanel
        open={sectionPanelOpen}
        sections={sections}
        onClose={() => setSectionPanelOpen(false)}
        onCreate={handleCreateSection}
        onDelete={handleDeleteSection}
      />

      {/* Floor settings (canvas size, grid, BG image, opacity) */}
      <FloorSettingsDialog
        open={settingsOpen}
        tenantId={tenantId}
        locationId={locationId}
        floor={activeFloor}
        onClose={() => setSettingsOpen(false)}
        onSaved={async () => {
          await loadFloors();
          await loadActiveFloor();
        }}
        onDeleted={async () => {
          setActiveFloorId(null);
          await loadFloors();
        }}
      />

      {/* Version history viewer + rollback */}
      <VersionHistoryDialog
        open={historyOpen}
        tenantId={tenantId}
        locationId={locationId}
        floorPlanId={activeFloorId}
        onClose={() => setHistoryOpen(false)}
        onRestored={async () => {
          await loadFloors();
          await loadActiveFloor();
        }}
      />
    </div>
  );
}

/** Human-readable "X seconds/minutes ago" for autosave indicator. */
function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}
