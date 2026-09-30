"use client";

import { useRef, useEffect, useState } from "react";
import { Icon } from "@iconify/react";

interface AddressAutocompleteProps {
  placeholder?: string;
  icon?: string;
  iconColor?: string;
  value?: string;
  onSelect: (place: {
    address: string;
    lat: number;
    lng: number;
    placeId: string;
  }) => void;
  onClear?: () => void;
  autoFocus?: boolean;
  className?: string;
}

export default function AddressAutocomplete({
  placeholder = "Enter address",
  icon = "solar:map-point-bold",
  iconColor = "text-gray-400",
  value,
  onSelect,
  onClear,
  autoFocus,
  className = "",
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [inputValue, setInputValue] = useState(value || "");

  useEffect(() => {
    if (value !== undefined) setInputValue(value);
  }, [value]);

  useEffect(() => {
    if (!inputRef.current) return;

    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const init = () => {
      if (cancelled || !inputRef.current) return;

      const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "ca" },
        fields: ["formatted_address", "geometry", "place_id"],
        types: ["geocode", "establishment"],
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (place.geometry?.location) {
          const address = place.formatted_address || "";
          setInputValue(address);
          onSelect({
            address,
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            placeId: place.place_id || "",
          });
        }
      });

      autocompleteRef.current = autocomplete;
    };

    // Poll for the Places library — it may load after this component mounts
    // when using async script loading (&loading=async)
    if (window.google?.maps?.places) {
      init();
    } else {
      pollId = setInterval(() => {
        if (window.google?.maps?.places) {
          if (pollId) clearInterval(pollId);
          pollId = null;
          init();
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      if (autocompleteRef.current && window.google?.maps?.event) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [onSelect]);

  return (
    <div className={`relative ${className}`}>
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
        <Icon icon={icon} className={`w-5 h-5 ${iconColor}`} />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full pl-12 pr-10 py-4 bg-white border border-gray-200 rounded-2xl text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-[15px]"
      />
      {inputValue && (
        <button
          onClick={() => {
            setInputValue("");
            onClear?.();
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-100 transition-colors"
        >
          <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
        </button>
      )}
    </div>
  );
}
