"use client";

// ============================================================================
// LiveTableTile — renders one table on the live floor view.
//
// Shows:
//   - Shape filled with status color (or server color if assigned)
//   - Table number, capacity
//   - If OCCUPIED: guest count, server initials, time-since-seated, $ spent
//   - Turn-time progress bar around the perimeter
//
// Click handler bubbles up to parent (opens action drawer).
// Re-uses Konva primitives — read-only (no drag/resize).
// ============================================================================

import { Group, Rect, Circle, Line, Text, Arc } from "react-konva";
import {
  type LiveTable,
  STATUS_COLORS,
  getTableFillColor,
} from "@/lib/floor-view/types";

interface LiveTableTileProps {
  table: LiveTable;
  isSelected: boolean;
  onClick: () => void;
}

// Estimated turn time (minutes) — used to fill the progress arc/bar
const ESTIMATED_TURN_MINUTES = 90;

function timeSeatedMinutes(seatedAt?: string | null): number {
  if (!seatedAt) return 0;
  const ms = Date.now() - new Date(seatedAt).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

function formatMoneyCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

export default function LiveTableTile({
  table,
  isSelected,
  onClick,
}: LiveTableTileProps) {
  const fill = getTableFillColor(table);
  const statusInfo = STATUS_COLORS[table.status];
  const ring = isSelected ? "#4F46E5" : statusInfo.ring;
  const strokeWidth = isSelected ? 3 : 1.5;

  const isOccupied = table.status === "OCCUPIED";
  const minsSeated = timeSeatedMinutes(table.seatedAt);
  const turnProgress = Math.min(1, minsSeated / ESTIMATED_TURN_MINUTES);
  const isOverdue = minsSeated > ESTIMATED_TURN_MINUTES * 1.2;

  // Server initials for display
  const serverInitials =
    table.currentServer
      ? `${(table.currentServer.firstName?.[0] ?? "").toUpperCase()}${(table.currentServer.lastName?.[0] ?? "").toUpperCase()}`
      : "";

  // Pick text color based on fill brightness (so labels stay readable on colored fills)
  const textColor = isLightColor(fill) ? "#1F2937" : "#FFFFFF";
  const subTextColor = isLightColor(fill) ? "#4B5563" : "rgba(255,255,255,0.9)";

  const labelText = table.displayLabel || table.tableNumber || "?";

  return (
    <Group
      x={table.x}
      y={table.y}
      width={table.width}
      height={table.height}
      rotation={table.rotation}
      onClick={onClick}
      onTap={onClick}
    >
      {/* Shape */}
      {renderShape(
        table.shape,
        table.width,
        table.height,
        fill,
        ring,
        strokeWidth,
        table.customPolygon
      )}

      {/* Table number — top label */}
      <Text
        x={0}
        y={6}
        width={table.width}
        align="center"
        text={labelText}
        fontSize={16}
        fontStyle="bold"
        fill={textColor}
        listening={false}
      />

      {/* Sub-info depending on status */}
      {!isOccupied && (
        <Text
          x={0}
          y={table.height - 18}
          width={table.width}
          align="center"
          text={`${table.capacity} seats`}
          fontSize={10}
          fill={subTextColor}
          listening={false}
        />
      )}

      {isOccupied && (
        <>
          {/* Guest count */}
          <Text
            x={0}
            y={table.height / 2 - 6}
            width={table.width}
            align="center"
            text={`${table.guestCount ?? "?"} guests`}
            fontSize={11}
            fontStyle="bold"
            fill={textColor}
            listening={false}
          />
          {/* Time + $ on bottom */}
          <Text
            x={0}
            y={table.height - 22}
            width={table.width}
            align="center"
            text={`${minsSeated}m`}
            fontSize={10}
            fill={isOverdue ? "#FCD34D" : subTextColor}
            fontStyle={isOverdue ? "bold" : "normal"}
            listening={false}
          />
          {table.activeSession && table.activeSession.totalSpentCents > 0 && (
            <Text
              x={0}
              y={table.height - 12}
              width={table.width}
              align="center"
              text={formatMoneyCents(table.activeSession.totalSpentCents)}
              fontSize={9}
              fill={subTextColor}
              listening={false}
            />
          )}
        </>
      )}

      {/* Server initials badge — top-right corner */}
      {table.currentServer && (
        <Group x={table.width - 24} y={4}>
          <Circle
            x={10}
            y={10}
            radius={10}
            fill="#FFFFFF"
            stroke={table.currentServer.color || "#9CA3AF"}
            strokeWidth={2}
            listening={false}
          />
          <Text
            x={0}
            y={5}
            width={20}
            align="center"
            text={serverInitials}
            fontSize={9}
            fontStyle="bold"
            fill="#1F2937"
            listening={false}
          />
        </Group>
      )}

      {/* Turn-time progress bar — thin line along bottom of card */}
      {isOccupied && (
        <Rect
          x={4}
          y={table.height - 3}
          width={(table.width - 8) * turnProgress}
          height={2}
          fill={isOverdue ? "#FCD34D" : "rgba(255,255,255,0.7)"}
          cornerRadius={1}
          listening={false}
        />
      )}

      {/* Status icon for non-occupied non-available — small corner badge */}
      {(table.status === "RESERVED" || table.status === "CLEANING" || table.status === "BLOCKED") && (
        <Circle
          x={10}
          y={10}
          radius={6}
          fill={statusInfo.ring}
          listening={false}
        />
      )}
    </Group>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function renderShape(
  shape: string,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  customPolygon: unknown
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
        <Rect width={w} height={h} cornerRadius={12} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      );
    case "BAR":
      return (
        <Rect width={w} height={h} cornerRadius={4} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      );
    case "CUSTOM": {
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
        <Rect width={w} height={h} cornerRadius={2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      );
  }
}

function polygonToFlatPoints(poly: unknown, w: number, h: number): number[] {
  if (Array.isArray(poly) && poly.length >= 3) {
    const flat: number[] = [];
    for (const pt of poly) {
      if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
        flat.push(Number(pt[0]), Number(pt[1]));
      }
    }
    if (flat.length >= 6) return flat;
  }
  return [0, 0, w, 0, w, h, 0, h];
}

/**
 * Detect if a hex color is "light" so we can pick contrasting text color.
 * Uses YIQ luminance approximation. Returns true for light backgrounds.
 */
function isLightColor(hex: string): boolean {
  if (!hex.startsWith("#") || hex.length < 7) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150;
}
