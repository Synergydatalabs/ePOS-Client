"use client";

// ============================================================================
// LiveCanvasStage — Konva stage for the staff floor view.
//
// Read-only (no drag/resize/transform). Renders:
//   - Background image (architect drawing) at configured opacity
//   - Grid (faint, for visual reference)
//   - Live table tiles via <LiveTableTile>
//
// Click handler bubbles up so parent can show action drawer.
// Auto re-renders when tables prop changes (parent polls every 5 sec).
// ============================================================================

import { Stage, Layer, Line, Rect, Image as KonvaImage } from "react-konva";
import useImage from "use-image";
import LiveTableTile from "./LiveTableTile";
import type { LiveTable } from "@/lib/floor-view/types";

interface LiveCanvasStageProps {
  width: number;
  height: number;
  gridSize: number;
  backgroundUrl?: string | null;
  backgroundOpacity?: number;
  tables: LiveTable[];
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
}

export default function LiveCanvasStage({
  width,
  height,
  gridSize,
  backgroundUrl,
  backgroundOpacity = 0.5,
  tables,
  selectedTableId,
  onSelectTable,
}: LiveCanvasStageProps) {
  const [bgImage] = useImage(backgroundUrl ?? "", "anonymous");

  return (
    <div
      className="border border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm"
      style={{ width, height }}
    >
      <Stage
        width={width}
        height={height}
        onClick={(e) => {
          if (e.target === e.target.getStage()) {
            onSelectTable(null);
          }
        }}
      >
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

        <Layer>
          {tables.map((t) => (
            <LiveTableTile
              key={t.id}
              table={t}
              isSelected={t.id === selectedTableId}
              onClick={() => onSelectTable(t.id)}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}

function renderGrid(width: number, height: number, gridSize: number) {
  const lines = [];
  for (let x = gridSize; x < width; x += gridSize) {
    lines.push(<Line key={`v-${x}`} points={[x, 0, x, height]} stroke="#E5E7EB" strokeWidth={0.5} />);
  }
  for (let y = gridSize; y < height; y += gridSize) {
    lines.push(<Line key={`h-${y}`} points={[0, y, width, y]} stroke="#E5E7EB" strokeWidth={0.5} />);
  }
  return lines;
}
