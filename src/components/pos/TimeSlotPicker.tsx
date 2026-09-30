"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";

interface TimeSlot {
  time: string; // "09:00", "09:15", etc.
  available: boolean;
}

interface TimeSlotPickerProps {
  tenantId: string;
  technicianId?: string;
  durationMinutes: number;
  date: string; // "2026-04-11" format
  onSelect: (time: string) => void;
  onClose: () => void;
  onDateChange?: (date: string) => void;
}

export default function TimeSlotPicker({
  tenantId,
  technicianId,
  durationMinutes,
  date,
  onSelect,
  onClose,
  onDateChange,
}: TimeSlotPickerProps) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(date);

  useEffect(() => {
    loadAvailability();
  }, [tenantId, technicianId, durationMinutes, selectedDate]);

  const loadAvailability = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        date: selectedDate,
        durationMinutes: durationMinutes.toString(),
      });
      if (technicianId) params.set("technicianId", technicianId);

      const res = await fetch(`/api/tenants/${tenantId}/availability?${params}`);
      const data = await res.json();
      if (data.success) {
        setSlots(data.slots || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    onDateChange?.(newDate);
  };

  // Group slots by hour for display
  const groupedSlots: Record<string, TimeSlot[]> = {};
  slots.forEach((slot) => {
    const hour = slot.time.split(":")[0];
    if (!groupedSlots[hour]) groupedSlots[hour] = [];
    groupedSlots[hour].push(slot);
  });

  const formatTime = (time: string) => {
    const [h, m] = time.split(":");
    const hour = parseInt(h);
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${h12}:${m} ${ampm}`;
  };

  // Generate date options for next 7 days
  const dateOptions = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      value: d.toISOString().split("T")[0],
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }),
    };
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Select Time</h3>
            <p className="text-sm text-gray-500">{durationMinutes} min service</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <Icon icon="solar:close-circle-linear" className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Date Selector */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {dateOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleDateChange(opt.value)}
                className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedDate === opt.value
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Time Slots */}
        <div className="p-4 overflow-y-auto max-h-[55vh]">
          {loading ? (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <div className="text-center py-8">
              <Icon icon="solar:calendar-minimalistic-linear" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No available slots for this date</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedSlots).map(([hour, hourSlots]) => (
                <div key={hour}>
                  <p className="text-xs font-medium text-gray-400 mb-2 uppercase">
                    {parseInt(hour) < 12 ? "Morning" : parseInt(hour) < 17 ? "Afternoon" : "Evening"}
                    {" "}{formatTime(`${hour}:00`).split(" ")[1]}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {hourSlots.map((slot) => (
                      <button
                        key={slot.time}
                        onClick={() => slot.available && onSelect(slot.time)}
                        disabled={!slot.available}
                        className={`py-2 px-1 rounded-lg text-sm font-medium transition-colors ${
                          slot.available
                            ? "bg-gray-50 text-gray-900 hover:bg-indigo-50 hover:text-indigo-700 border border-gray-200 hover:border-indigo-300"
                            : "bg-gray-100 text-gray-300 cursor-not-allowed"
                        }`}
                      >
                        {formatTime(slot.time)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
