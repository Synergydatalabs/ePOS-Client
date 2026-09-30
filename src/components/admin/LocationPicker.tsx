"use client";

import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";
import { useLocation } from "@/contexts/LocationContext";

export default function LocationPicker() {
  const { locations, activeLocation, setActiveLocation, canSwitch, loading } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading || !activeLocation) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 text-gray-400">
        <Icon icon="solar:map-point-bold" className="w-4 h-4" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  // Single location OR staff locked → show static pill
  if (!canSwitch || locations.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-100">
        <Icon icon="solar:map-point-bold" className="w-4 h-4 text-indigo-600" />
        <span className="text-sm font-medium text-indigo-700 max-w-[140px] truncate">{activeLocation.name}</span>
        {!canSwitch && locations.length > 1 && (
          <Icon icon="solar:lock-keyhole-minimalistic-bold" className="w-3.5 h-3.5 text-indigo-400" />
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all"
      >
        <Icon icon="solar:map-point-bold" className="w-4 h-4 text-indigo-600" />
        <span className="text-sm font-medium text-gray-900 max-w-[140px] truncate">{activeLocation.name}</span>
        <Icon
          icon="solar:alt-arrow-down-bold"
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden z-50">
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Switch Location</p>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {locations.map((loc) => (
              <button
                key={loc.id}
                onClick={() => {
                  setActiveLocation(loc);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left ${
                  loc.id === activeLocation.id ? "bg-indigo-50" : ""
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    loc.id === activeLocation.id ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  <Icon icon="solar:map-point-bold" className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${
                      loc.id === activeLocation.id ? "text-indigo-700" : "text-gray-900"
                    }`}
                  >
                    {loc.name}
                  </p>
                  {loc.address && (
                    <p className="text-xs text-gray-500 truncate">{loc.address}</p>
                  )}
                </div>
                {loc.id === activeLocation.id && (
                  <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
