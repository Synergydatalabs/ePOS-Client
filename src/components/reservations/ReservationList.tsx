"use client";

// ============================================================================
// ReservationList — list view of reservations (default mode on admin page).
//
// Grouped by day. Each row shows: time, customer name, party size, status badge,
// table assignment (or "—"), special occasion icon, notes preview.
// Click row → opens detail dialog.
// ============================================================================

import { useMemo } from "react";
import { Icon } from "@iconify/react";
import {
  type Reservation,
  STATUS_LABEL,
  STATUS_COLOR,
} from "@/lib/reservations/types";

interface ReservationListProps {
  reservations: Reservation[];
  onSelect: (r: Reservation) => void;
}

export default function ReservationList({
  reservations,
  onSelect,
}: ReservationListProps) {
  // Group by day (YYYY-MM-DD)
  const grouped = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of reservations) {
      const d = new Date(r.bookedFor);
      const key = formatDateKey(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [reservations]);

  if (reservations.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
        <Icon icon="solar:calendar-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">No reservations in this date range</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(([dayKey, list]) => (
        <div key={dayKey}>
          <h3 className="text-sm font-bold text-gray-900 mb-2 sticky top-0 bg-gray-50 py-1">
            {formatDayHeading(dayKey)}
            <span className="ml-2 text-xs font-normal text-gray-500">
              {list.length} reservation{list.length === 1 ? "" : "s"}
            </span>
          </h3>
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {list.map((r) => (
              <ReservationRow key={r.id} r={r} onClick={() => onSelect(r)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReservationRow({ r, onClick }: { r: Reservation; onClick: () => void }) {
  const time = new Date(r.bookedFor);
  const statusStyle = STATUS_COLOR[r.status];

  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 text-left transition-colors"
    >
      {/* Time */}
      <div className="flex-shrink-0 w-16 text-center">
        <div className="text-sm font-bold text-gray-900">
          {time.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}
        </div>
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 truncate">{r.customerName}</span>
          {r.specialOccasion && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
              🎉 {r.specialOccasion}
            </span>
          )}
          {(r.guestProfile?.vipTier ?? 0) > 0 && (
            <span className="text-xs text-amber-600">★</span>
          )}
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
          <span>{r.partySize} guests</span>
          {r.table ? (
            <>
              <span>·</span>
              <span>Table {r.table.tableNumber}</span>
            </>
          ) : (
            <>
              <span>·</span>
              <span className="text-amber-600">No table assigned</span>
            </>
          )}
          {r.customerPhone && (
            <>
              <span>·</span>
              <span className="truncate">{r.customerPhone}</span>
            </>
          )}
        </div>
        {r.notes && (
          <p className="text-xs text-gray-500 mt-1 italic truncate">"{r.notes}"</p>
        )}
      </div>

      {/* Status badge */}
      <span
        className={`flex-shrink-0 text-xs px-2 py-1 rounded-full font-medium ${statusStyle.bg} ${statusStyle.text}`}
      >
        {STATUS_LABEL[r.status]}
      </span>

      <Icon
        icon="solar:alt-arrow-right-bold"
        className="w-4 h-4 text-gray-300 flex-shrink-0"
      />
    </button>
  );
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayHeading(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const isToday = formatDateKey(today) === key;
  const isTomorrow = formatDateKey(tomorrow) === key;
  if (isToday) return "Today · " + date.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
  if (isTomorrow) return "Tomorrow · " + date.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
  return date.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
