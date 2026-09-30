"use client";

// ============================================================================
// ReservationCalendar — week grid view of reservations.
//
// Columns: 7 days (configurable start day)
// Rows: hourly slots (configurable open/close hours)
// Each reservation appears as a colored block, click to select.
// Click empty cell → opens create dialog with that time pre-filled.
//
// Designed to be lightweight (no big calendar library). Pure CSS grid.
// ============================================================================

import { useMemo } from "react";
import {
  type Reservation,
  STATUS_COLOR,
} from "@/lib/reservations/types";

interface ReservationCalendarProps {
  reservations: Reservation[];
  /** First day of the visible week (any day works — calendar starts here) */
  weekStart: Date;
  /** Hour to start grid (default 11) */
  startHour?: number;
  /** Hour to end grid (default 23) */
  endHour?: number;
  onSelect: (r: Reservation) => void;
  /** Click an empty cell — fire with that date+time pre-filled. */
  onEmptyCellClick: (date: Date, hhmm: string) => void;
}

export default function ReservationCalendar({
  reservations,
  weekStart,
  startHour = 11,
  endHour = 23,
  onSelect,
  onEmptyCellClick,
}: ReservationCalendarProps) {
  // Build 7-day array starting at weekStart
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });
  }, [weekStart]);

  // Hourly rows
  const hours = useMemo(() => {
    return Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  }, [startHour, endHour]);

  // Group reservations by day key + bucket by hour
  const byDayHour = useMemo(() => {
    const map = new Map<string, Reservation[]>(); // "YYYY-MM-DD_HH"
    for (const r of reservations) {
      const d = new Date(r.bookedFor);
      const key = `${formatDateKey(d)}_${d.getHours()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [reservations]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header — day labels */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-gray-200 bg-gray-50">
        <div className="px-2 py-2 text-xs font-semibold text-gray-500" />
        {days.map((d, i) => {
          const isToday = formatDateKey(d) === formatDateKey(new Date());
          return (
            <div
              key={i}
              className={`px-2 py-2 text-center border-l border-gray-200 ${
                isToday ? "bg-indigo-50" : ""
              }`}
            >
              <div className="text-xs text-gray-500 uppercase">
                {d.toLocaleDateString("en-CA", { weekday: "short" })}
              </div>
              <div
                className={`text-sm font-bold ${
                  isToday ? "text-indigo-700" : "text-gray-900"
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour rows */}
      <div className="max-h-[600px] overflow-y-auto">
        {hours.map((h) => (
          <div
            key={h}
            className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-gray-100 min-h-[64px]"
          >
            <div className="px-2 py-1 text-xs text-gray-500 text-right">
              {formatHour(h)}
            </div>
            {days.map((d, dayIdx) => {
              const key = `${formatDateKey(d)}_${h}`;
              const cellReservations = byDayHour.get(key) ?? [];
              return (
                <div
                  key={dayIdx}
                  className="border-l border-gray-100 hover:bg-gray-50 p-1 cursor-pointer flex flex-col gap-0.5 relative"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-reservation]")) return;
                    onEmptyCellClick(d, `${String(h).padStart(2, "0")}:00`);
                  }}
                >
                  {cellReservations.map((r) => (
                    <ReservationChip
                      key={r.id}
                      r={r}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(r);
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReservationChip({
  r,
  onClick,
}: {
  r: Reservation;
  onClick: (e: React.MouseEvent) => void;
}) {
  const time = new Date(r.bookedFor);
  const style = STATUS_COLOR[r.status];
  return (
    <button
      data-reservation
      onClick={onClick}
      className={`text-left px-1.5 py-1 rounded text-[11px] leading-tight ${style.bg} ${style.text} hover:opacity-80 transition-opacity`}
    >
      <div className="font-medium truncate">
        {time.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })} ·{" "}
        {r.customerName}
      </div>
      <div className="opacity-80">
        {r.partySize}p{r.table ? ` · T${r.table.tableNumber}` : ""}
      </div>
    </button>
  );
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}
