"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { Modal, Button } from "@/components/ui";
import { toast } from "sonner";

interface BreakRow {
  id: string;
  type: string;
  startedAt: string;
  endedAt?: string | null;
  minutes?: number | null;
}

interface Entry {
  id: string;
  status: "ACTIVE" | "ON_BREAK" | "CLOSED";
  clockedInAt: string;
  breaks: BreakRow[];
  location?: { id: string; name: string } | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  locationId: string;
  /** Optional — parent can be notified whenever the user clocks in/out. */
  onChanged?: () => void;
}

export default function TimeClockModal({
  isOpen,
  onClose,
  tenantId,
  locationId,
  onChanged,
}: Props) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/time-clock/active`);
      const data = await res.json();
      if (data.success) setEntry(data.entry);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const clockIn = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/time-clock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Clocked in");
        onChanged?.();
        load();
      } else {
        toast.error(data.error || "Failed to clock in");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const clockOut = async () => {
    if (!entry) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/time-clock/${entry.id}/clock-out`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const data = await res.json();
      if (data.success) {
        toast.success(
          `Clocked out — ${formatHours(data.entry.totalMinutes || 0)} worked`
        );
        onChanged?.();
        onClose();
      } else {
        toast.error(data.error || "Failed to clock out");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBreak = async (action: "start" | "end", type?: "MEAL" | "REST") => {
    if (!entry) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/time-clock/${entry.id}/break`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, type }),
        }
      );
      const data = await res.json();
      if (data.success) {
        toast.success(action === "start" ? "Break started" : `Back — ${data.minutes}m break`);
        onChanged?.();
        load();
      } else {
        toast.error(data.error || "Failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" title="Time Clock">
      {loading ? (
        <div className="py-12 text-center text-gray-400">
          <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin mx-auto" />
        </div>
      ) : !entry ? (
        <div className="space-y-4">
          <div className="p-6 rounded-2xl bg-gray-50 border border-gray-100 text-center">
            <Icon
              icon="solar:clock-circle-bold"
              className="w-12 h-12 text-gray-400 mx-auto mb-2"
            />
            <p className="text-gray-600 font-medium">You're clocked out</p>
            <p className="text-xs text-gray-500">
              Start your shift to track hours automatically.
            </p>
          </div>
          <Button
            onClick={clockIn}
            loading={submitting}
            fullWidth
            size="lg"
            className="bg-green-600 hover:bg-green-700"
          >
            <Icon icon="solar:play-bold" className="w-5 h-5 mr-2" />
            Clock In
          </Button>
        </div>
      ) : (
        <ActiveSession
          entry={entry}
          submitting={submitting}
          onClockOut={clockOut}
          onBreakStart={(type) => toggleBreak("start", type)}
          onBreakEnd={() => toggleBreak("end")}
        />
      )}
    </Modal>
  );
}

function ActiveSession({
  entry,
  submitting,
  onClockOut,
  onBreakStart,
  onBreakEnd,
}: {
  entry: Entry;
  submitting: boolean;
  onClockOut: () => void;
  onBreakStart: (type: "MEAL" | "REST") => void;
  onBreakEnd: () => void;
}) {
  // Live-ticking clock — refresh once a minute so the running total shows
  // real elapsed time without polling the server.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const clockInMs = new Date(entry.clockedInAt).getTime();
  const elapsedMinutes = Math.max(0, Math.round((now - clockInMs) / 60_000));
  const breakMinutes = entry.breaks.reduce(
    (s, b) =>
      s +
      (b.endedAt
        ? b.minutes || 0
        : Math.max(0, Math.round((now - new Date(b.startedAt).getTime()) / 60_000))),
    0
  );
  const workedMinutes = Math.max(0, elapsedMinutes - breakMinutes);
  const activeBreak = entry.breaks.find((b) => !b.endedAt);

  return (
    <div className="space-y-4">
      <div
        className={`p-5 rounded-2xl text-white ${
          entry.status === "ON_BREAK"
            ? "bg-gradient-to-br from-amber-500 to-orange-600"
            : "bg-gradient-to-br from-green-500 to-emerald-600"
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <Icon
            icon={
              entry.status === "ON_BREAK"
                ? "solar:cup-hot-bold"
                : "solar:play-circle-bold"
            }
            className="w-5 h-5"
          />
          <span className="text-sm font-medium uppercase tracking-wider opacity-90">
            {entry.status === "ON_BREAK" ? "On Break" : "Clocked In"}
          </span>
        </div>
        <p className="text-4xl font-bold tabular-nums">
          {formatHours(workedMinutes)}
        </p>
        <p className="text-xs opacity-80 mt-1">
          Since{" "}
          {new Date(entry.clockedInAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {entry.location?.name && ` · ${entry.location.name}`}
        </p>
      </div>

      {/* Break history */}
      {entry.breaks.length > 0 && (
        <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-40 overflow-y-auto">
          {entry.breaks.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between p-2.5 text-sm"
            >
              <div className="flex items-center gap-2">
                <Icon
                  icon={
                    b.type === "MEAL"
                      ? "solar:plate-bold"
                      : "solar:cup-hot-bold"
                  }
                  className="w-4 h-4 text-amber-600"
                />
                <span className="font-medium text-gray-900 capitalize">
                  {b.type.toLowerCase()} break
                </span>
                {!b.endedAt && (
                  <span className="text-xs text-amber-600">in progress</span>
                )}
              </div>
              <span className="text-gray-600 tabular-nums">
                {b.minutes != null
                  ? `${b.minutes}m`
                  : `${Math.max(
                      0,
                      Math.round((now - new Date(b.startedAt).getTime()) / 60_000)
                    )}m`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {activeBreak ? (
        <Button
          onClick={onBreakEnd}
          loading={submitting}
          fullWidth
          size="lg"
          className="bg-amber-600 hover:bg-amber-700"
        >
          <Icon icon="solar:play-bold" className="w-5 h-5 mr-2" />
          End Break
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={() => onBreakStart("REST")}
            disabled={submitting}
            fullWidth
          >
            <Icon icon="solar:cup-hot-bold" className="w-4 h-4 mr-1" />
            Rest Break
          </Button>
          <Button
            variant="secondary"
            onClick={() => onBreakStart("MEAL")}
            disabled={submitting}
            fullWidth
          >
            <Icon icon="solar:plate-bold" className="w-4 h-4 mr-1" />
            Meal Break
          </Button>
        </div>
      )}

      <Button
        onClick={onClockOut}
        disabled={submitting || entry.status === "ON_BREAK"}
        fullWidth
        size="lg"
        className="bg-red-600 hover:bg-red-700"
      >
        <Icon icon="solar:stop-bold" className="w-5 h-5 mr-2" />
        Clock Out
      </Button>
      {entry.status === "ON_BREAK" && (
        <p className="text-xs text-center text-gray-500">
          End your break before clocking out.
        </p>
      )}
    </div>
  );
}

function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
