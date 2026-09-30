"use client";

import { forwardRef, InputHTMLAttributes } from "react";
import { Icon } from "@iconify/react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: string;
  iconPosition?: "left" | "right";
  inputSize?: "sm" | "md" | "lg";
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      icon,
      iconPosition = "left",
      inputSize = "md",
      className = "",
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;

    const sizeClasses = {
      sm: "input-sm",
      md: "",
      lg: "input-lg",
    };

    // Use !important (Tailwind `!` prefix) so the icon padding wins over
    // the `.input` component-class horizontal padding regardless of layer
    // ordering — otherwise the placeholder text can slide under the icon.
    const iconPadding = {
      left: icon && iconPosition === "left" ? "!pl-11" : "",
      right: icon && iconPosition === "right" ? "!pr-11" : "",
    };

    return (
      <div className={`w-full ${className}`}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && iconPosition === "left" && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <Icon icon={icon} className="w-5 h-5" />
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`input ${sizeClasses[inputSize]} ${iconPadding.left} ${iconPadding.right} ${
              error ? "input-error" : ""
            }`}
            {...props}
          />
          {icon && iconPosition === "right" && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              <Icon icon={icon} className="w-5 h-5" />
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1.5 text-sm text-red-600 flex items-center gap-1">
            <Icon icon="solar:danger-circle-bold" className="w-4 h-4" />
            {error}
          </p>
        )}
        {hint && !error && (
          <p className="mt-1.5 text-sm text-gray-500">{hint}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
