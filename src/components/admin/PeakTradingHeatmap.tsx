"use client";

import { Icon } from "@iconify/react";

interface Props {
  heatmap: number[][]; // 7 rows (day-of-week) × 24 cols (hour)
  days?: string[];
}

const DEFAULT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Format an hour as a 12h label suitable for the axis (0 -> 12a, 13 -> 1p)
function hourLabel(h: number) {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

export default function PeakTradingHeatmap({ heatmap, days = DEFAULT_DAYS }: Props) {
  // Flatten to find max so we can scale intensity relative to the busiest cell
  const max = heatmap.reduce(
    (m, row) => Math.max(m, ...row),
    0
  );

  if (max === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Icon icon="solar:calendar-bold" className="w-12 h-12 mb-3" />
        <p className="text-sm">No order activity in the last 30 days</p>
      </div>
    );
  }

  // Return a CSS colour string whose alpha scales with intensity.
  // Base colour matches the app's indigo brand accent.
  function cellColor(count: number) {
    if (count === 0) return "rgba(99, 102, 241, 0.04)"; // barely visible baseline
    const intensity = Math.max(0.15, count / max);
    return `rgba(99, 102, 241, ${intensity.toFixed(2)})`;
  }

  return (
    <div className="w-full">
      {/* Scrollable wrapper for narrow screens — the 24-hour axis is wide */}
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Hour axis */}
          <div
            className="grid text-[10px] text-gray-400 mb-1"
            style={{ gridTemplateColumns: `40px repeat(24, minmax(0, 1fr))` }}
          >
            <div />
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-center"
                style={{ opacity: h % 3 === 0 ? 1 : 0.4 }}
              >
                {h % 3 === 0 ? hourLabel(h) : ""}
              </div>
            ))}
          </div>

          {/* Rows */}
          {heatmap.map((row, dayIdx) => (
            <div
              key={dayIdx}
              className="grid gap-1 mb-1"
              style={{ gridTemplateColumns: `40px repeat(24, minmax(0, 1fr))` }}
            >
              <div className="text-xs font-medium text-gray-500 flex items-center justify-end pr-1">
                {days[dayIdx]}
              </div>
              {row.map((count, hourIdx) => (
                <div
                  key={hourIdx}
                  title={`${days[dayIdx]} ${hourLabel(hourIdx)} — ${count} order${count === 1 ? "" : "s"}`}
                  className="aspect-square rounded-sm hover:ring-2 hover:ring-indigo-400 hover:ring-offset-1 transition-shadow cursor-default"
                  style={{ backgroundColor: cellColor(count) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Scale legend */}
      <div className="flex items-center gap-2 mt-3 justify-end">
        <span className="text-[10px] text-gray-400">Less</span>
        <div className="flex gap-0.5">
          {[0.04, 0.2, 0.4, 0.6, 0.8, 1].map((i) => (
            <div
              key={i}
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: `rgba(99, 102, 241, ${i})` }}
            />
          ))}
        </div>
        <span className="text-[10px] text-gray-400">More</span>
      </div>
    </div>
  );
}
