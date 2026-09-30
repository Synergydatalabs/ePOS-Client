"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Icon } from "@iconify/react";

interface ChannelRow {
  type: string;
  revenue: number;
  count: number;
}

interface Props {
  channels: ChannelRow[];
  currency?: string;
}

// Consistent colours across the app for each channel — matches the
// order-type pill colours users see elsewhere in the POS.
const CHANNEL_META: Record<string, { label: string; color: string; icon: string }> = {
  DINE_IN: { label: "Dine In", color: "#14B8A6", icon: "solar:chair-2-bold" },
  TAKEAWAY: { label: "Takeaway", color: "#6366F1", icon: "solar:bag-4-bold" },
  DELIVERY: { label: "Delivery", color: "#F59E0B", icon: "solar:delivery-bold" },
  APPOINTMENT: {
    label: "Appointment",
    color: "#A855F7",
    icon: "solar:calendar-bold",
  },
};

export default function SalesByChannelChart({
  channels,
  currency = "CAD",
}: Props) {
  const total = channels.reduce((s, c) => s + c.revenue, 0);

  const formatCents = (cents: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format((cents || 0) / 100);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Icon icon="solar:chart-bold" className="w-12 h-12 mb-3" />
        <p className="text-sm">No sales yet in the last 30 days</p>
      </div>
    );
  }

  const data = channels.map((c) => ({
    name: CHANNEL_META[c.type]?.label || c.type,
    value: c.revenue,
    count: c.count,
    color: CHANNEL_META[c.type]?.color || "#94A3B8",
    icon: CHANNEL_META[c.type]?.icon || "solar:layers-bold",
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
      {/* Donut */}
      <div className="relative h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} stroke="none" />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => formatCents(v)}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #E5E7EB",
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label — total revenue over the 30-day window */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-xs text-gray-500">30-day total</p>
          <p className="text-lg font-bold text-gray-900">{formatCents(total)}</p>
        </div>
      </div>

      {/* Legend + per-channel breakdown */}
      <div className="space-y-2">
        {data.map((d) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <div key={d.name} className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: d.color + "22", color: d.color }}
              >
                <Icon icon={d.icon} className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {d.name}
                  </p>
                  <p className="text-sm font-semibold text-gray-900">{pct}%</p>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs text-gray-500">
                    {d.count} order{d.count === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-gray-500">{formatCents(d.value)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
