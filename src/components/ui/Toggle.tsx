"use client";

import { forwardRef, useId } from "react";

interface ToggleProps {
  label?: string;
  description?: string;
  size?: "sm" | "md" | "lg";
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  ({ label, description, size = "md", className = "", id, checked, onChange, disabled }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    const sizeClasses = {
      sm: {
        track: "w-8 h-4",
        thumb: "w-3 h-3",
        translate: "translate-x-4",
      },
      md: {
        track: "w-11 h-6",
        thumb: "w-5 h-5",
        translate: "translate-x-5",
      },
      lg: {
        track: "w-14 h-7",
        thumb: "w-6 h-6",
        translate: "translate-x-7",
      },
    };

    const sizes = sizeClasses[size];

    return (
      <div className={`flex items-start gap-3 ${className}`}>
        <div className="relative flex-shrink-0">
          <input
            ref={ref}
            type="checkbox"
            id={inputId}
            className="sr-only peer"
            checked={checked}
            onChange={(e) => onChange?.(e.target.checked)}
            disabled={disabled}
          />
          <label
            htmlFor={inputId}
            className={`block ${sizes.track} rounded-full cursor-pointer transition-colors duration-200 bg-gray-200 peer-checked:bg-indigo-600 peer-focus:ring-2 peer-focus:ring-indigo-500 peer-focus:ring-offset-2 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          />
          <div
            className={`absolute top-0.5 left-0.5 ${sizes.thumb} rounded-full bg-white shadow-sm transition-transform duration-200 peer-checked:${sizes.translate}`}
          />
        </div>
        {(label || description) && (
          <div className="flex-1">
            {label && (
              <label
                htmlFor={inputId}
                className={`block text-sm font-medium text-gray-900 ${disabled ? "opacity-50" : "cursor-pointer"}`}
              >
                {label}
              </label>
            )}
            {description && (
              <p className="text-sm text-gray-500 mt-0.5">{description}</p>
            )}
          </div>
        )}
      </div>
    );
  }
);

Toggle.displayName = "Toggle";

export default Toggle;
