"use client";

// ============================================================================
// CanvasStage (Phase 3a)
//
// Konva stage rendering:
//   - Background image underlay (architect drawing) with opacity
//   - Grid (visual reference, snapping target)
//   - Tables via <TableShape>
//   - Konva Transformer for selected table — rotation + resize handles
//
// New in Phase 3:
//   - Snap to nearest grid intersection on drag end
//   - Resize handles via Transformer (drag corner = resize, drag rotation icon = rotate)
//   - Background image rendered behind grid
//   - Optional alignment hint lines (TODO: phase 3b)
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Line, Rect, Circle, Image as KonvaImage, Transformer } from "react-konva";
import Konva from "konva";
import useImage from "use-image";
import TableShape from "./TableShape";
import type { CanvasTable, SectionDto } from "@/lib/floor-plan/types";

interface CanvasStageProps {
  width: number;
  height: number;
  gridSize: number;
  backgroundUrl?: string | null;
  backgroundOpacity?: number;
  snapEnabled?: boolean;
  tables: CanvasTable[];
  sections: SectionDto[];
  selectedTableId: string | null;
  /**
   * Polygon drawing mode. When set, clicks on the canvas add vertices
   * instead of deselecting. Double-click closes the polygon.
   */
  polygonDrawMode?: boolean;
  onSelectTable: (id: string | null) => void;
  onMoveTable: (id: string, x: number, y: number) => void;
  onTransformTable: (
    id: string,
    updates: { x: number; y: number; width: number; height: number; rotation: number }
  ) => void;
  /**
   * Called when user finishes drawing a polygon (double-click or 8+ points).
   * Receives flat points array in canvas coordinates: [x1,y1,x2,y2,...].
   */
  onPolygonComplete?: (points: number[]) => void;
  /** Called when user cancels polygon drawing (Esc key) */
  onPolygonCancel?: () => void;
}

/**
 * Snap a coordinate to the nearest grid intersection.
 */
function snapTo(value: number, gridSize: number, enabled: boolean): number {
  if (!enabled || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

export default function CanvasStage({
  width,
  height,
  gridSize,
  backgroundUrl,
  backgroundOpacity = 0.5,
  snapEnabled = true,
  tables,
  sections,
  selectedTableId,
  polygonDrawMode = false,
  onSelectTable,
  onMoveTable,
  onTransformTable,
  onPolygonComplete,
  onPolygonCancel,
}: CanvasStageProps) {
  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  const visibleTables = tables.filter((t) => !t._isDeleted);

  // Background image — useImage handles the async load
  const [bgImage] = useImage(backgroundUrl ?? "", "anonymous");

  // Transformer ref — attached to selected node for resize/rotate handles
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  // Polygon drawing state — array of [x,y] in canvas coords
  const [polygonPoints, setPolygonPoints] = useState<number[][]>([]);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Reset polygon when mode toggles off
  useEffect(() => {
    if (!polygonDrawMode) {
      setPolygonPoints([]);
      setMousePos(null);
    }
  }, [polygonDrawMode]);

  // Escape key cancels polygon drawing
  useEffect(() => {
    if (!polygonDrawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPolygonPoints([]);
        onPolygonCancel?.();
      } else if (e.key === "Enter" && polygonPoints.length >= 3) {
        finishPolygon();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygonDrawMode, polygonPoints]);

  const finishPolygon = () => {
    if (polygonPoints.length < 3) return;
    const flat = polygonPoints.flat();
    onPolygonComplete?.(flat);
    setPolygonPoints([]);
    setMousePos(null);
  };

  // Reattach transformer when selection changes
  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;

    if (!selectedTableId) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    // Find the Konva node by attribute id
    const node = stage.findOne(`#table-${selectedTableId}`);
    if (node) {
      transformer.nodes([node]);
      transformer.getLayer()?.batchDraw();
    } else {
      transformer.nodes([]);
    }
  }, [selectedTableId, tables.length]);

  return (
    <div
      className="border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm"
      style={{ width, height }}
    >
      <Stage
        ref={stageRef as any}
        width={width}
        height={height}
        onMouseMove={(e) => {
          if (!polygonDrawMode) return;
          const stage = e.target.getStage();
          if (!stage) return;
          const pos = stage.getPointerPosition();
          if (pos) setMousePos({ x: pos.x, y: pos.y });
        }}
        onClick={(e) => {
          const stage = e.target.getStage();
          if (!stage) return;

          if (polygonDrawMode) {
            // Polygon mode: clicks add vertices regardless of target.
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const x = snapEnabled ? snapTo(pos.x, gridSize, true) : pos.x;
            const y = snapEnabled ? snapTo(pos.y, gridSize, true) : pos.y;

            // Click near first point → close polygon
            if (polygonPoints.length >= 3) {
              const [fx, fy] = polygonPoints[0];
              const dx = x - fx;
              const dy = y - fy;
              if (Math.sqrt(dx * dx + dy * dy) < 15) {
                finishPolygon();
                return;
              }
            }

            setPolygonPoints((prev) => [...prev, [x, y]]);
            return;
          }

          // Normal mode: click on empty stage → deselect
          if (e.target === stage) {
            onSelectTable(null);
          }
        }}
        onDblClick={(e) => {
          if (polygonDrawMode && polygonPoints.length >= 3) {
            e.evt.preventDefault();
            finishPolygon();
          }
        }}
      >
        {/* Background layer: canvas fill + bg image + grid */}
        <Layer listening={false}>
          <Rect width={width} height={height} fill="#FAFAFA" />

          {bgImage && (
            <KonvaImage
              image={bgImage}
              width={width}
              height={height}
              opacity={backgroundOpacity}
              listening={false}
            />
          )}

          {renderGrid(width, height, gridSize)}
        </Layer>

        {/* Tables layer */}
        <Layer>
          {visibleTables.map((t) => {
            const section = t.sectionId ? sectionMap.get(t.sectionId) : undefined;
            return (
              <TableShape
                key={t.id}
                id={`table-${t.id}`}
                table={t}
                isSelected={t.id === selectedTableId}
                sectionColor={section?.color}
                onClick={() => onSelectTable(t.id)}
                onDragEnd={(x, y) => {
                  onMoveTable(
                    t.id,
                    snapTo(x, gridSize, snapEnabled),
                    snapTo(y, gridSize, snapEnabled)
                  );
                }}
                onTransform={(updates) => onTransformTable(t.id, updates)}
              />
            );
          })}

          {/* Polygon drawing overlay — shows in-progress polygon */}
          {polygonDrawMode && polygonPoints.length > 0 && (
            <>
              {/* Lines connecting placed points */}
              <Line
                points={[
                  ...polygonPoints.flat(),
                  ...(mousePos ? [mousePos.x, mousePos.y] : []),
                ]}
                stroke="#4F46E5"
                strokeWidth={2}
                closed={false}
                listening={false}
                dash={[6, 4]}
              />
              {/* Vertex markers */}
              {polygonPoints.map((pt, i) => (
                <Circle
                  key={i}
                  x={pt[0]}
                  y={pt[1]}
                  radius={i === 0 && polygonPoints.length >= 3 ? 8 : 5}
                  fill={i === 0 ? "#FBBF24" : "#FFFFFF"}
                  stroke="#4F46E5"
                  strokeWidth={2}
                  listening={false}
                />
              ))}
            </>
          )}

          {/* Konva Transformer — provides resize + rotation handles for selected table */}
          <Transformer
            ref={transformerRef as any}
            // Anchor styling
            anchorSize={10}
            anchorCornerRadius={2}
            anchorStroke="#4F46E5"
            anchorFill="#FFFFFF"
            borderStroke="#4F46E5"
            borderDash={[4, 4]}
            // Rotation snap to 15°
            rotationSnaps={[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345]}
            rotationSnapTolerance={5}
            // Minimum table size
            boundBoxFunc={(_oldBox, newBox) => {
              const MIN = 30;
              if (newBox.width < MIN || newBox.height < MIN) return _oldBox;
              return newBox;
            }}
          />
        </Layer>
      </Stage>
    </div>
  );
}

/**
 * Faint grid pattern for visual reference + snap targeting.
 */
function renderGrid(width: number, height: number, gridSize: number) {
  const lines = [];
  const stroke = "#E5E7EB";
  const strokeWidth = 0.5;

  for (let x = gridSize; x < width; x += gridSize) {
    lines.push(
      <Line key={`v-${x}`} points={[x, 0, x, height]} stroke={stroke} strokeWidth={strokeWidth} />
    );
  }
  for (let y = gridSize; y < height; y += gridSize) {
    lines.push(
      <Line key={`h-${y}`} points={[0, y, width, y]} stroke={stroke} strokeWidth={strokeWidth} />
    );
  }
  return lines;
}
