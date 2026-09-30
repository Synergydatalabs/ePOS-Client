"use client";

// ============================================================================
// TableShape (Phase 3a)
//
// Renders a single table on the canvas. Updates:
//   - Accepts `id` prop for Konva node lookup (Transformer needs this)
//   - Emits onTransform for resize/rotate from Konva Transformer
//   - Uses ref forwarding so Stage can find the node via stage.findOne(`#table-X`)
// ============================================================================

import { useRef, useEffect } from "react";
import { Group, Rect, Circle, Text, Line } from "react-konva";
import Konva from "konva";
import type { CanvasTable, TableShapeKind } from "@/lib/floor-plan/types";

interface TableShapeProps {
  id?: string; // Konva node id, used by Transformer
  table: CanvasTable;
  isSelected: boolean;
  sectionColor?: string;
  onClick: () => void;
  onDragStart?: () => void;
  onDragEnd: (x: number, y: number) => void;
  onTransform?: (updates: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }) => void;
}

function shapeFill(_table: CanvasTable, sectionColor?: string): string {
  return sectionColor ?? "#E5E7EB";
}

function shapeStroke(isSelected: boolean): string {
  return isSelected ? "#4F46E5" : "#9CA3AF";
}

function shapeStrokeWidth(isSelected: boolean): number {
  return isSelected ? 3 : 1.5;
}

export default function TableShape({
  id,
  table,
  isSelected,
  sectionColor,
  onClick,
  onDragStart,
  onDragEnd,
  onTransform,
}: TableShapeProps) {
  const groupRef = useRef<Konva.Group | null>(null);
  const fill = shapeFill(table, sectionColor);
  const stroke = shapeStroke(isSelected);
  const strokeWidth = shapeStrokeWidth(isSelected);
  const label = table.displayLabel || table.tableNumber || "?";

  // Sync prop changes to Konva node (so Transformer reads correct dims after
  // external updates from the inspector)
  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;
    node.x(table.x);
    node.y(table.y);
    node.rotation(table.rotation);
    // We do NOT setScale; width/height are passed as props to children.
    node.scaleX(1);
    node.scaleY(1);
    node.getLayer()?.batchDraw();
  }, [table.x, table.y, table.rotation, table.width, table.height]);

  return (
    <Group
      id={id}
      ref={groupRef as any}
      x={table.x}
      y={table.y}
      width={table.width}
      height={table.height}
      rotation={table.rotation}
      draggable
      onClick={onClick}
      onTap={onClick}
      onDragStart={onDragStart}
      onDragEnd={(e) => {
        onDragEnd(e.target.x(), e.target.y());
      }}
      onTransformEnd={(e) => {
        if (!onTransform) return;
        const node = e.target as Konva.Group;
        // Konva applies scale during transform — we bake it into width/height
        // and reset scale so future transforms start from 1.
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const newWidth = Math.max(30, table.width * scaleX);
        const newHeight = Math.max(30, table.height * scaleY);
        node.scaleX(1);
        node.scaleY(1);
        onTransform({
          x: node.x(),
          y: node.y(),
          width: newWidth,
          height: newHeight,
          rotation: node.rotation(),
        });
      }}
    >
      {renderShape(
        table.shape,
        table.width,
        table.height,
        fill,
        stroke,
        strokeWidth,
        table.customPolygon
      )}
      <Text
        x={0}
        y={table.height / 2 - 8}
        width={table.width}
        align="center"
        text={label}
        fontSize={14}
        fontStyle="bold"
        fill="#1F2937"
        listening={false}
      />
      {table.capacity > 0 && (
        <Text
          x={0}
          y={table.height / 2 + 8}
          width={table.width}
          align="center"
          text={`${table.capacity} seats`}
          fontSize={10}
          fill="#6B7280"
          listening={false}
        />
      )}
    </Group>
  );
}

function renderShape(
  shape: TableShapeKind,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  customPolygon?: unknown // expected: [[x,y], [x,y], ...]
) {
  switch (shape) {
    case "ROUND":
      return (
        <Circle
          x={w / 2}
          y={h / 2}
          radius={Math.min(w, h) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case "BOOTH":
      return (
        <Rect
          width={w}
          height={h}
          cornerRadius={12}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case "BAR":
      return (
        <Rect
          width={w}
          height={h}
          cornerRadius={4}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case "CUSTOM": {
      // customPolygon is an array of [x,y] pairs in LOCAL coordinates
      // (relative to the table's group origin). Konva Line takes a flat
      // points array: [x1,y1,x2,y2,...].
      const points = polygonToFlatPoints(customPolygon, w, h);
      return (
        <Line
          points={points}
          closed
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineJoin="round"
        />
      );
    }
    case "RECTANGLE":
    case "SQUARE":
    default:
      return (
        <Rect
          width={w}
          height={h}
          cornerRadius={2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
  }
}

/**
 * Convert polygon JSON [[x,y],...] to flat Konva points array [x1,y1,x2,y2,...]
 * If polygon is missing or malformed, return a default rectangle for the
 * given dimensions (graceful fallback so a custom-typed table without
 * polygon doesn't render as nothing).
 */
function polygonToFlatPoints(
  poly: unknown,
  w: number,
  h: number
): number[] {
  if (Array.isArray(poly) && poly.length >= 3) {
    const flat: number[] = [];
    for (const pt of poly) {
      if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
        flat.push(Number(pt[0]), Number(pt[1]));
      }
    }
    if (flat.length >= 6) return flat;
  }
  // Fallback: rectangle of given dimensions
  return [0, 0, w, 0, w, h, 0, h];
}
