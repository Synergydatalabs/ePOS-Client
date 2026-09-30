"use client";

import { Icon } from "@iconify/react";

interface Station {
  id: string;
  name: string;
  activeCount: number;
}

interface StationFilterProps {
  stations: Station[];
  selectedStation: string | null;
  onSelectStation: (stationId: string | null) => void;
  totalOrders: number;
}

export default function StationFilter({
  stations,
  selectedStation,
  onSelectStation,
  totalOrders,
}: StationFilterProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {/* All Stations */}
      <button
        onClick={() => onSelectStation(null)}
        className={`flex-shrink-0 px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
          selectedStation === null
            ? "bg-teal-600 text-white"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        <Icon icon="solar:widget-4-bold" className="w-5 h-5" />
        All
        <span
          className={`ml-1 px-2 py-0.5 rounded-full text-xs font-bold ${
            selectedStation === null ? "bg-white/20" : "bg-gray-200"
          }`}
        >
          {totalOrders}
        </span>
      </button>

      {/* Individual Stations */}
      {stations.map((station) => (
        <button
          key={station.id}
          onClick={() => onSelectStation(station.id)}
          className={`flex-shrink-0 px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${
            selectedStation === station.id
              ? "bg-teal-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          <Icon icon="solar:chef-hat-bold" className="w-5 h-5" />
          {station.name}
          {station.activeCount > 0 && (
            <span
              className={`ml-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                selectedStation === station.id
                  ? "bg-white/20"
                  : station.activeCount > 5
                  ? "bg-red-100 text-red-600"
                  : "bg-gray-200"
              }`}
            >
              {station.activeCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
