"use client";

// ============================================================================
// LiveFloorView — main staff view orchestrator.
//
// Responsibilities:
//   - Load floor view payload (canvas + tables + servers + reservations)
//   - Poll every 5 seconds for updates
//   - Manage selected table state
//   - Show legend + floor switcher
//   - Wire actions drawer
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import TableActionsDrawer from "./TableActionsDrawer";
import {
  type LiveFloorViewPayload,
  STATUS_COLORS,
} from "@/lib/floor-view/types";

const LiveCanvasStage = dynamic(() => import("./LiveCanvasStage"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center bg-gray-50 border border-gray-300 rounded-lg" style={{ width: 800, height: 600 }}>
      <div className="text-gray-500 text-sm">Loading floor…</div>
    </div>
  ),
});

interface LiveFloorViewProps {
  tenantId: string;
  locationId: string;
}

const POLL_INTERVAL_MS = 5000;

export default function LiveFloorView({ tenantId, locationId }: LiveFloorViewProps) {
  const [data, setData] = useState<LiveFloorViewPayload | null>(null);
  const [activeFloorPlanId, setActiveFloorPlanId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const loadData = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      else setRefreshing(true);
      try {
        const url = activeFloorPlanId
          ? `/api/tenants/${tenantId}/locations/${locationId}/floor-view?floorPlanId=${activeFloorPlanId}`
          : `/api/tenants/${tenantId}/locations/${locationId}/floor-view`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: LiveFloorViewPayload = await res.json();
        setData(json);
        // First load: pin floor plan id so polling stays on same floor
        if (!activeFloorPlanId && json.floorPlan) {
          setActiveFloorPlanId(json.floorPlan.id);
        }
      } catch (err: any) {
        if (showSpinner) {
          toast.error(`Couldn't load floor: ${err?.message ?? "unknown"}`);
        }
        // Silent polling failures don't show toast
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tenantId, locationId, activeFloorPlanId]
  );

  // Initial load
  useEffect(() => {
    loadData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, locationId, activeFloorPlanId]);

  // Polling
  useEffect(() => {
    const startPolling = () => {
      pollTimerRef.current = setInterval(() => loadData(false), POLL_INTERVAL_MS);
    };
    startPolling();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [loadData]);

  // Derived: selected table data
  const selectedTable = useMemo(() => {
    if (!data || !selectedTableId) return null;
    return data.tables.find((t) => t.id === selectedTableId) ?? null;
  }, [data, selectedTableId]);

  // Reservations for the selected table only
  const reservationsForTable = useMemo(() => {
    if (!data || !selectedTableId) return [];
    return data.reservations.filter((r) => r.tableId === selectedTableId);
  }, [data, selectedTableId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!data?.floorPlan) {
    return (
      <div className="text-center py-20 max-w-md mx-auto">
        <Icon icon="solar:layers-bold" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">No floor plan yet</h2>
        <p className="text-gray-600 mb-6 text-sm">
          Admin needs to set up a floor plan first. Go to <strong>Admin → Floor Plan</strong> to design one.
        </p>
      </div>
    );
  }

  const { floorPlan, floorPlans, sections, tables, servers } = data;

  // Stats for the top bar
  const stats = computeStats(tables);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Floor switcher tabs */}
      {floorPlans.length > 1 && (
        <div className="border-b border-gray-200 bg-white px-4 flex items-center gap-1 overflow-x-auto">
          {floorPlans.map((fp) => {
            const active = fp.id === activeFloorPlanId;
            return (
              <button
                key={fp.id}
                onClick={() => {
                  setActiveFloorPlanId(fp.id);
                  setSelectedTableId(null);
                }}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                  active
                    ? "border-indigo-600 text-indigo-700"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                <Icon icon="solar:layers-bold" className="w-4 h-4" />
                {fp.name}
                {fp.isDefault && <span className="text-amber-400">★</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Top stats bar */}
      <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center justify-between flex-wrap gap-2 text-sm">
        <div className="flex items-center gap-4">
          <StatPill label="Available" value={stats.AVAILABLE} color="#9CA3AF" />
          <StatPill label="Seated" value={stats.OCCUPIED} color="#10B981" />
          <StatPill label="Reserved" value={stats.RESERVED} color="#A78BFA" />
          <StatPill label="Cleaning" value={stats.CLEANING} color="#FCD34D" />
          {stats.BLOCKED > 0 && <StatPill label="Blocked" value={stats.BLOCKED} color="#6B7280" />}
          <span className="text-gray-300">|</span>
          <span className="text-gray-700">
            Total guests: <strong>{stats.totalGuests}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {refreshing && (
            <Icon
              icon="solar:refresh-bold"
              className="w-3.5 h-3.5 text-gray-400 animate-spin"
            />
          )}
          <span>Auto-refresh every {POLL_INTERVAL_MS / 1000}s</span>
          <button
            onClick={() => loadData(false)}
            className="text-indigo-600 hover:text-indigo-800 ml-1"
          >
            Refresh now
          </button>
        </div>
      </div>

      {/* Main 2-pane layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Center: canvas */}
        <div className="flex-1 overflow-auto p-6 bg-gray-100">
          <LiveCanvasStage
            width={floorPlan.canvasWidth}
            height={floorPlan.canvasHeight}
            gridSize={floorPlan.gridSize}
            backgroundUrl={floorPlan.backgroundUrl}
            backgroundOpacity={floorPlan.backgroundOpacity}
            tables={tables}
            selectedTableId={selectedTableId}
            onSelectTable={setSelectedTableId}
          />
        </div>

        {/* Right: action drawer */}
        <TableActionsDrawer
          tenantId={tenantId}
          locationId={locationId}
          table={selectedTable}
          reservations={reservationsForTable}
          servers={servers}
          onClose={() => setSelectedTableId(null)}
          onRefresh={async () => loadData(false)}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function computeStats(tables: LiveFloorViewPayload["tables"]) {
  const counts: Record<string, number> = {
    AVAILABLE: 0,
    OCCUPIED: 0,
    RESERVED: 0,
    CLEANING: 0,
    BLOCKED: 0,
  };
  let totalGuests = 0;
  for (const t of tables) {
    counts[t.status] = (counts[t.status] || 0) + 1;
    if (t.status === "OCCUPIED" && t.guestCount) {
      totalGuests += t.guestCount;
    }
  }
  return { ...counts, totalGuests } as Record<string, number> & { totalGuests: number };
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: color, border: `1px solid ${color}` }}
      />
      <span className="text-gray-600">{label}:</span>
      <strong className="text-gray-900">{value}</strong>
    </span>
  );
}
