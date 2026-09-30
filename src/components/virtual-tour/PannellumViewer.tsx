"use client";

// ============================================================================
// PannellumViewer — wraps Pannellum 360° library as a React component.
//
// Pannellum is JS-only (not React-native). We instantiate it on a DOM ref
// when the component mounts, destroy on unmount. Image URL changes recreate
// the viewer (Pannellum doesn't support live image swap cleanly).
//
// Provides:
//   - Equirectangular panorama rendering
//   - Drag to look around (mouse + touch)
//   - Mobile gyroscope (Pannellum auto-enables)
//   - Hotspots (click to fire callback)
//   - Optional "click to place hotspot" mode for the editor
// ============================================================================

import { useEffect, useRef } from "react";
import "pannellum/build/pannellum.css";
import type { TourHotspot } from "@/lib/virtual-tour/types";

// Pannellum attaches itself to window — load it as a side-effect import.
// The require() form keeps it out of SSR (window check below).
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("pannellum");
}

interface PannellumViewerProps {
  imageUrl: string;
  initialYaw?: number;
  initialPitch?: number;
  initialFov?: number;
  hotspots?: TourHotspot[];
  autoRotate?: number; // negative spins left-to-right, e.g. -2 (deg/sec)
  showCompass?: boolean;
  showControls?: boolean;
  /** Called when user clicks any hotspot — receives the hotspot data */
  onHotspotClick?: (hotspot: TourHotspot) => void;
  /**
   * Editor mode: click anywhere on the panorama → fires with the spherical
   * coords. Used by TourSceneEditor to place new hotspots.
   */
  onCanvasClick?: (yaw: number, pitch: number) => void;
  /** Fixed height in px (parent is usually responsive width) */
  height?: number | string;
  className?: string;
}

export default function PannellumViewer({
  imageUrl,
  initialYaw = 0,
  initialPitch = 0,
  initialFov = 90,
  hotspots = [],
  autoRotate = 0,
  showCompass = true,
  showControls = true,
  onHotspotClick,
  onCanvasClick,
  height = 500,
  className = "",
}: PannellumViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Store viewer in ref so we can destroy on cleanup
  const viewerRef = useRef<any>(null);
  // Stash latest hotspot handler so the viewer's frozen-at-creation
  // closures pick up new props without rebuilding the viewer
  const hotspotClickRef = useRef(onHotspotClick);
  const canvasClickRef = useRef(onCanvasClick);
  hotspotClickRef.current = onHotspotClick;
  canvasClickRef.current = onCanvasClick;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    // Build hotspot config for Pannellum
    const pannellumHotspots = hotspots.map((h) => ({
      pitch: h.pitch,
      yaw: h.yaw,
      // Pannellum's built-in types are 'info' and 'scene'. We use 'info' for
      // everything and fully control click via clickHandlerFunc.
      type: "info" as const,
      text: h.label,
      cssClass:
        h.hotspotType === "TABLE_LINK"
          ? "tour-hotspot tour-hotspot-table"
          : h.hotspotType === "SCENE_LINK"
            ? "tour-hotspot tour-hotspot-scene"
            : h.hotspotType === "EXTERNAL_URL"
              ? "tour-hotspot tour-hotspot-link"
              : "tour-hotspot tour-hotspot-info",
      clickHandlerFunc: () => {
        hotspotClickRef.current?.(h);
      },
    }));

    const pannellum = (window as any).pannellum;
    if (!pannellum) {
      console.error("Pannellum not loaded");
      return;
    }

    const viewer = pannellum.viewer(containerRef.current, {
      type: "equirectangular",
      panorama: imageUrl,
      autoLoad: true,
      yaw: initialYaw,
      pitch: initialPitch,
      hfov: initialFov,
      minHfov: 50,
      maxHfov: 120,
      compass: showCompass,
      showControls,
      autoRotate: autoRotate ?? 0,
      hotSpots: pannellumHotspots,
      mouseZoom: true,
      doubleClickZoom: false, // avoid conflict with our place-hotspot click
    });

    viewerRef.current = viewer;

    // Wire up click-to-place-hotspot for editor mode
    if (canvasClickRef.current) {
      const onMouseUp = (e: MouseEvent) => {
        if (!canvasClickRef.current) return;
        // Skip clicks on a hotspot — Pannellum already handled those
        const target = e.target as HTMLElement;
        if (target.closest(".pnlm-hotspot")) return;

        try {
          const coords = viewer.mouseEventToCoords(e);
          // coords is [pitch, yaw]
          const pitch = coords[0];
          const yaw = coords[1];
          canvasClickRef.current(yaw, pitch);
        } catch (err) {
          console.warn("Failed to convert click to coords:", err);
        }
      };

      const renderContainer = containerRef.current.querySelector(".pnlm-render-container");
      if (renderContainer) {
        renderContainer.addEventListener("mouseup", onMouseUp as any);
        // Touch fallback
        renderContainer.addEventListener("touchend", onMouseUp as any);
      }

      return () => {
        if (renderContainer) {
          renderContainer.removeEventListener("mouseup", onMouseUp as any);
          renderContainer.removeEventListener("touchend", onMouseUp as any);
        }
        try {
          viewer.destroy();
        } catch {}
        viewerRef.current = null;
      };
    }

    return () => {
      try {
        viewer.destroy();
      } catch {}
      viewerRef.current = null;
    };
    // We rebuild on imageUrl change (new scene). Hotspots ALSO trigger
    // rebuild because Pannellum's hotspot list is set at init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, JSON.stringify(hotspots), initialYaw, initialPitch, initialFov, autoRotate, showCompass, showControls]);

  return (
    <>
      <div
        ref={containerRef}
        className={`relative w-full bg-black rounded-lg overflow-hidden ${className}`}
        style={{ height }}
      />
      {/* Inline hotspot styles — overrides Pannellum's defaults */}
      <style jsx global>{`
        .tour-hotspot {
          height: 32px;
          width: 32px;
          background: rgba(79, 70, 229, 0.92);
          border: 3px solid white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          transition: transform 0.15s, background-color 0.15s;
        }
        .tour-hotspot:hover {
          transform: scale(1.2);
          background: rgba(67, 56, 202, 1);
        }
        .tour-hotspot-table {
          background: rgba(245, 158, 11, 0.95);
        }
        .tour-hotspot-table:hover {
          background: rgba(217, 119, 6, 1);
        }
        .tour-hotspot-scene {
          background: rgba(79, 70, 229, 0.95);
        }
        .tour-hotspot-link {
          background: rgba(16, 185, 129, 0.95);
        }
        .tour-hotspot-info {
          background: rgba(107, 114, 128, 0.95);
        }
        /* Pannellum tooltip styling */
        div.pnlm-tooltip span {
          background: rgba(0, 0, 0, 0.8) !important;
          color: white !important;
          padding: 6px 10px !important;
          border-radius: 6px !important;
          font-size: 13px !important;
          font-weight: 500 !important;
          border: none !important;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }
      `}</style>
    </>
  );
}
