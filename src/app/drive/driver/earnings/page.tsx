"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { useDriverSession } from "../layout";

type Period = "today" | "week" | "month";

interface EarningsSummary {
  totalEarned: number;
  trips: number;
  tips: number;
  hoursOnline: number;
}

interface DailyBreakdown {
  date: string;
  trips: number;
  fares: number;
  tips: number;
  commission: number;
  net: number;
}

export default function DriverEarningsPage() {
  const { session } = useDriverSession();
  const [period, setPeriod] = useState<Period>("today");
  const [summary, setSummary] = useState<EarningsSummary>({
    totalEarned: 0,
    trips: 0,
    tips: 0,
    hoursOnline: 0,
  });
  const [dailyBreakdown, setDailyBreakdown] = useState<DailyBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  const tenantId = session?.tenant.id;
  const driverId = session?.user.id;

  const loadEarnings = useCallback(async () => {
    if (!tenantId || !driverId) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/drivers/${driverId}/earnings?period=${period}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.summary) setSummary(data.summary);
        if (data.dailyBreakdown) setDailyBreakdown(data.dailyBreakdown);
      }
    } catch (error) {
      console.error("Failed to load earnings:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId, driverId, period]);

  useEffect(() => {
    loadEarnings();
  }, [loadEarnings]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: session?.tenant.currency || "USD",
    }).format(amount / 100);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const periodOptions: { key: Period; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
  ];

  return (
    <div className="p-4 space-y-4">
      {/* Period Selector */}
      <div className="flex gap-2 bg-gray-800/50 border border-gray-700/50 rounded-xl p-1">
        {periodOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setPeriod(opt.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              period === opt.key
                ? "bg-emerald-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Total Earnings Card */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-6 text-center">
        {loading ? (
          <div className="animate-pulse">
            <div className="h-4 bg-white/20 rounded w-1/3 mx-auto mb-3" />
            <div className="h-10 bg-white/20 rounded w-1/2 mx-auto mb-4" />
            <div className="h-3 bg-white/20 rounded w-1/4 mx-auto" />
          </div>
        ) : (
          <>
            <p className="text-emerald-100 text-sm font-medium mb-1">Total Earned</p>
            <p className="text-4xl font-bold text-white mb-3">
              {formatCurrency(summary.totalEarned)}
            </p>
            <div className="flex items-center justify-center gap-4 text-emerald-100 text-sm">
              <span>{summary.trips} trips</span>
              <span className="w-1 h-1 rounded-full bg-emerald-300" />
              <span>{summary.hoursOnline.toFixed(1)}h online</span>
            </div>
          </>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
          <Icon icon="solar:route-bold" className="w-5 h-5 text-blue-400 mx-auto mb-1" />
          <p className="text-lg font-bold text-white">{loading ? "-" : summary.trips}</p>
          <p className="text-xs text-gray-500">Trips</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
          <Icon icon="solar:hand-money-bold" className="w-5 h-5 text-amber-400 mx-auto mb-1" />
          <p className="text-lg font-bold text-white">{loading ? "-" : formatCurrency(summary.tips)}</p>
          <p className="text-xs text-gray-500">Tips</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
          <Icon icon="solar:clock-circle-bold" className="w-5 h-5 text-purple-400 mx-auto mb-1" />
          <p className="text-lg font-bold text-white">{loading ? "-" : `${summary.hoursOnline.toFixed(1)}h`}</p>
          <p className="text-xs text-gray-500">Hours</p>
        </div>
      </div>

      {/* Weekly Chart Placeholder */}
      {period !== "today" && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">
            {period === "week" ? "Weekly" : "Monthly"} Earnings Chart
          </h3>
          <div className="h-40 flex items-center justify-center border border-dashed border-gray-700 rounded-xl">
            <div className="text-center">
              <Icon icon="solar:chart-2-bold" className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-gray-600 text-sm">Weekly Earnings Chart</p>
            </div>
          </div>
        </div>
      )}

      {/* Daily Breakdown */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3 px-1">Daily Breakdown</h3>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-gray-800/50 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-gray-700 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-700 rounded w-full" />
              </div>
            ))}
          </div>
        ) : dailyBreakdown.length === 0 ? (
          <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-8 text-center">
            <Icon icon="solar:wallet-bold" className="w-10 h-10 text-gray-700 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No earnings data for this period</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dailyBreakdown.map((day, idx) => (
              <div
                key={idx}
                className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{formatDate(day.date)}</span>
                  <span className="text-base font-bold text-emerald-400">{formatCurrency(day.net)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{day.trips} trips</span>
                  <span className="w-1 h-1 rounded-full bg-gray-700" />
                  <span>Fares: {formatCurrency(day.fares)}</span>
                  {day.tips > 0 && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-gray-700" />
                      <span>Tips: {formatCurrency(day.tips)}</span>
                    </>
                  )}
                  {day.commission > 0 && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-gray-700" />
                      <span className="text-red-400">-{formatCurrency(day.commission)}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
