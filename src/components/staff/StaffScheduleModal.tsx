"use client";

// Staff schedule + time-off editor — Phase E R1.
//
// Two panels in one modal:
//   1. Weekly schedule — 7 day-of-week rows. Each row has start/end time
//      pickers OR an "Off" toggle. Missing schedule = tech follows the
//      location's business hours (the availability engine defaults).
//   2. Time off — add-a-range form + list of active/future ranges.
//
// Both panels persist independently:
//   - Schedule PUTs the full 7-day array on Save
//   - Time-off POST per new range, DELETE per row (no batch save)
//
// Deliberately not "one Save button" — merchants often add a time-off
// range without touching the schedule, and vice versa.

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface StaffScheduleModalProps {
  tenantId: string;
  staffId: string;
  staffName: string;
  isOpen: boolean;
  onClose: () => void;
}

interface ScheduleDay {
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
}

interface TimeOff {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Default hours pre-filled when a merchant enables a day for the first
// time. Matches the engine's fallback so behavior is consistent.
const DEFAULT_OPEN = "09:00";
const DEFAULT_CLOSE = "17:00";

export default function StaffScheduleModal({
  tenantId,
  staffId,
  staffName,
  isOpen,
  onClose,
}: StaffScheduleModalProps) {
  // Seed with all 7 days off — merchant toggles the working days on.
  const [schedule, setSchedule] = useState<ScheduleDay[]>(() =>
    Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i,
      startTime: null,
      endTime: null,
    }))
  );
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [timeOffLoading, setTimeOffLoading] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newReason, setNewReason] = useState("");
  const [addingTimeOff, setAddingTimeOff] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setScheduleLoading(true);
    setTimeOffLoading(true);

    fetch(`/api/tenants/${tenantId}/staff/${staffId}/schedule`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.schedule)) {
          // Merge into the 7-day baseline so missing days stay "off".
          const byDay = new Map<number, ScheduleDay>();
          for (let i = 0; i < 7; i++) {
            byDay.set(i, { dayOfWeek: i, startTime: null, endTime: null });
          }
          for (const row of d.schedule as ScheduleDay[]) {
            byDay.set(row.dayOfWeek, row);
          }
          setSchedule(Array.from(byDay.values()));
        }
      })
      .catch(() => toast.error("Failed to load schedule"))
      .finally(() => setScheduleLoading(false));

    fetch(`/api/tenants/${tenantId}/staff/${staffId}/time-off`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setTimeOff(d.timeOff || []);
      })
      .catch(() => toast.error("Failed to load time off"))
      .finally(() => setTimeOffLoading(false));
  }, [isOpen, tenantId, staffId]);

  const updateDay = (dayOfWeek: number, patch: Partial<ScheduleDay>) => {
    setSchedule((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d))
    );
  };

  const toggleDay = (dayOfWeek: number, on: boolean) => {
    updateDay(dayOfWeek, {
      startTime: on ? DEFAULT_OPEN : null,
      endTime: on ? DEFAULT_CLOSE : null,
    });
  };

  const saveSchedule = async () => {
    setScheduleSaving(true);
    try {
      // Validate: if a day has start OR end, it must have BOTH.
      for (const d of schedule) {
        if ((d.startTime && !d.endTime) || (!d.startTime && d.endTime)) {
          toast.error(`${DAY_LABELS[d.dayOfWeek]}: set both start and end time.`);
          setScheduleSaving(false);
          return;
        }
      }
      const res = await fetch(
        `/api/tenants/${tenantId}/staff/${staffId}/schedule`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schedule }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Failed to save schedule");
        return;
      }
      toast.success("Schedule saved");
    } catch {
      toast.error("Failed to save schedule");
    } finally {
      setScheduleSaving(false);
    }
  };

  const addTimeOff = async () => {
    if (!newStart || !newEnd) {
      toast.error("Pick start and end dates");
      return;
    }
    setAddingTimeOff(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/staff/${staffId}/time-off`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startDate: newStart,
            endDate: newEnd,
            reason: newReason || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Failed to add time off");
        return;
      }
      setTimeOff((prev) => [...prev, data.timeOff].sort((a, b) =>
        a.startDate.localeCompare(b.startDate)
      ));
      setNewStart("");
      setNewEnd("");
      setNewReason("");
      toast.success("Time off added");
    } catch {
      toast.error("Failed to add time off");
    } finally {
      setAddingTimeOff(false);
    }
  };

  const removeTimeOff = async (id: string) => {
    if (!confirm("Remove this time off?")) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/staff/${staffId}/time-off/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || "Failed to remove");
        return;
      }
      setTimeOff((prev) => prev.filter((t) => t.id !== id));
      toast.success("Removed");
    } catch {
      toast.error("Failed to remove");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Schedule & Time Off</h2>
            <p className="text-xs text-gray-500 mt-0.5">{staffName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
          {/* Weekly schedule */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Weekly Schedule</h3>
              <button
                onClick={saveSchedule}
                disabled={scheduleSaving || scheduleLoading}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {scheduleSaving ? "Saving…" : "Save Schedule"}
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Missing rows follow the location's business hours. Toggle a
              day off to mark this technician unavailable.
            </p>
            {scheduleLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {schedule.map((d) => {
                  const working = !!d.startTime && !!d.endTime;
                  return (
                    <div
                      key={d.dayOfWeek}
                      className="flex items-center gap-3 p-2 rounded-lg border border-gray-100"
                    >
                      <div className="w-24 text-sm font-medium text-gray-700">
                        {DAY_LABELS[d.dayOfWeek]}
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={working}
                          onChange={(e) => toggleDay(d.dayOfWeek, e.target.checked)}
                          className="w-4 h-4"
                        />
                        Working
                      </label>
                      <div className="flex items-center gap-2 flex-1 justify-end">
                        <input
                          type="time"
                          value={d.startTime ?? ""}
                          onChange={(e) =>
                            updateDay(d.dayOfWeek, {
                              startTime: e.target.value || null,
                            })
                          }
                          disabled={!working}
                          className="px-2 py-1.5 rounded-md border border-gray-200 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                        />
                        <span className="text-gray-400 text-sm">to</span>
                        <input
                          type="time"
                          value={d.endTime ?? ""}
                          onChange={(e) =>
                            updateDay(d.dayOfWeek, {
                              endTime: e.target.value || null,
                            })
                          }
                          disabled={!working}
                          className="px-2 py-1.5 rounded-md border border-gray-200 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Time off */}
          <section>
            <h3 className="font-semibold text-gray-900 mb-2">Time Off</h3>
            <p className="text-xs text-gray-500 mb-3">
              Vacation, sick days, personal time. Any date in a range
              blocks slot availability for this technician.
            </p>

            {/* Add row */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
              <input
                type="date"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="px-3 py-2 rounded-md border border-gray-200 text-sm"
                placeholder="Start"
              />
              <input
                type="date"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className="px-3 py-2 rounded-md border border-gray-200 text-sm"
                placeholder="End"
              />
              <input
                type="text"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="Reason (optional)"
                className="px-3 py-2 rounded-md border border-gray-200 text-sm"
                maxLength={100}
              />
              <button
                onClick={addTimeOff}
                disabled={addingTimeOff || !newStart || !newEnd}
                className="px-3 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {addingTimeOff ? "Adding…" : "Add"}
              </button>
            </div>

            {/* List */}
            {timeOffLoading ? (
              <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
            ) : timeOff.length === 0 ? (
              <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-md p-3 text-center">
                No upcoming time off.
              </p>
            ) : (
              <div className="space-y-1.5">
                {timeOff.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-2 rounded-md border border-gray-100 bg-gray-50"
                  >
                    <div className="text-sm">
                      <span className="font-medium text-gray-900">
                        {new Date(t.startDate).toLocaleDateString()}
                      </span>
                      {t.startDate !== t.endDate && (
                        <>
                          <span className="text-gray-400 mx-1">→</span>
                          <span className="font-medium text-gray-900">
                            {new Date(t.endDate).toLocaleDateString()}
                          </span>
                        </>
                      )}
                      {t.reason && (
                        <span className="text-gray-500 text-xs ml-2">
                          — {t.reason}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removeTimeOff(t.id)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title="Remove"
                    >
                      <Icon icon="solar:trash-bin-2-linear" className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-700 hover:bg-gray-100"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
