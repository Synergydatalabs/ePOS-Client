"use client";

// ============================================================================
// VirtualTourViewer — the customer-facing multi-scene 360° tour.
//
// Takes the full tour payload (scenes + tables) and lets the user:
//   - View the default scene (or pick from scene selector)
//   - Click SCENE_LINK hotspots to navigate to another scene
//   - Click TABLE_LINK hotspots to fire onTableSelect(tableId)
//   - Click INFO hotspots to see a tooltip popup
//   - Click EXTERNAL_URL hotspots to open in new tab
//
// Wrapped around PannellumViewer; manages scene-switching state.
// ============================================================================

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@iconify/react";
import type { TourScene, TourTable, TourHotspot } from "@/lib/virtual-tour/types";

// Pannellum is client-only (uses window)
const PannellumViewer = dynamic(() => import("./PannellumViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center bg-black text-white rounded-lg" style={{ height: 500 }}>
      <div className="text-sm">Loading 360° tour…</div>
    </div>
  ),
});

interface VirtualTourViewerProps {
  scenes: TourScene[];
  tables: TourTable[];
  /** Called when user clicks a TABLE_LINK hotspot — embed page handles booking flow */
  onTableSelect?: (tableId: string, table: TourTable | undefined) => void;
  /** Optional header rendered above the viewer */
  header?: React.ReactNode;
  height?: number | string;
}

export default function VirtualTourViewer({
  scenes,
  tables,
  onTableSelect,
  header,
  height = 600,
}: VirtualTourViewerProps) {
  // Pick the default scene (or first available)
  const defaultScene = useMemo(
    () => scenes.find((s) => s.isDefaultScene) ?? scenes[0],
    [scenes]
  );

  const [activeSceneId, setActiveSceneId] = useState<string | null>(defaultScene?.id ?? null);
  const [arrivalAngles, setArrivalAngles] = useState<{ yaw?: number; pitch?: number } | null>(null);
  const [infoPopup, setInfoPopup] = useState<{ label: string; x: number; y: number } | null>(null);

  const activeScene = useMemo(
    () => scenes.find((s) => s.id === activeSceneId) ?? defaultScene,
    [scenes, activeSceneId, defaultScene]
  );

  const tableMap = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);

  if (!activeScene) {
    return (
      <div className="flex flex-col items-center justify-center bg-gray-100 rounded-lg p-10 text-center" style={{ height }}>
        <Icon icon="solar:gallery-bold" className="w-12 h-12 text-gray-400 mb-3" />
        <p className="text-gray-600 text-sm">
          No 360° scenes yet. Upload panoramas in the Media Gallery and mark them as 360° to build this tour.
        </p>
      </div>
    );
  }

  const handleHotspotClick = (h: TourHotspot) => {
    setInfoPopup(null);
    switch (h.hotspotType) {
      case "SCENE_LINK":
        if (h.targetSceneMediaId) {
          setActiveSceneId(h.targetSceneMediaId);
          setArrivalAngles({
            yaw: h.targetYaw ?? undefined,
            pitch: h.targetPitch ?? undefined,
          });
        }
        break;
      case "TABLE_LINK":
        if (h.targetTableId) {
          const t = tableMap.get(h.targetTableId);
          onTableSelect?.(h.targetTableId, t);
        }
        break;
      case "EXTERNAL_URL":
        if (h.externalUrl) {
          window.open(h.externalUrl, "_blank", "noopener,noreferrer");
        }
        break;
      case "INFO":
        // Show inline popup
        setInfoPopup({ label: h.label, x: 50, y: 50 });
        setTimeout(() => setInfoPopup(null), 4000);
        break;
    }
  };

  return (
    <div className="w-full">
      {header}

      <div className="relative">
        <PannellumViewer
          key={activeScene.id} // remount on scene change
          imageUrl={activeScene.publicUrl}
          initialYaw={arrivalAngles?.yaw ?? activeScene.initialYaw ?? 0}
          initialPitch={arrivalAngles?.pitch ?? activeScene.initialPitch ?? 0}
          initialFov={activeScene.initialFov ?? 90}
          hotspots={activeScene.hotspots}
          onHotspotClick={handleHotspotClick}
          height={height}
          showCompass
          showControls
        />

        {/* Info popup overlay */}
        {infoPopup && (
          <div className="absolute inset-x-0 top-4 z-10 flex justify-center pointer-events-none">
            <div className="max-w-md bg-black/85 text-white rounded-lg px-4 py-2 text-sm shadow-lg">
              {infoPopup.label}
            </div>
          </div>
        )}

        {/* Scene selector chips */}
        {scenes.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex gap-2 max-w-[90%] overflow-x-auto bg-black/60 rounded-full px-3 py-2 backdrop-blur-sm">
            {scenes.map((s) => {
              const active = s.id === activeScene.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setActiveSceneId(s.id);
                    setArrivalAngles(null);
                  }}
                  className={`px-3 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${
                    active
                      ? "bg-white text-gray-900 font-semibold"
                      : "text-white hover:bg-white/20"
                  }`}
                >
                  {s.sceneName || "Untitled"}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom legend — what hotspot colors mean (educates customers on first use) */}
      <div className="mt-3 flex items-center justify-center gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" /> Walk here
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Book this table
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Link
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-500" /> Info
        </span>
      </div>
    </div>
  );
}
