"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";
import { Icon } from "@iconify/react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "success" | "danger" | "warning" | "ghost" | "outline";
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  icon?: string;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      loading = false,
      icon,
      iconPosition = "left",
      fullWidth = false,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const baseClasses = "btn";
    const variantClasses = `btn-${variant}`;
    const sizeClasses = `btn-${size}`;
    const widthClasses = fullWidth ? "w-full" : "";
    const disabledClasses = disabled || loading ? "opacity-50 cursor-not-allowed" : "";

    return (
      <button
        ref={ref}
        className={`${baseClasses} ${variantClasses} ${sizeClasses} ${widthClasses} ${disabledClasses} ${className}`}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <span className="spinner w-4 h-4 mr-2" />
            <span>Loading...</span>
          </>
        ) : (
          <>
            {icon && iconPosition === "left" && (
              <Icon icon={icon} className="w-5 h-5 mr-2" />
            )}
            {children}
            {icon && iconPosition === "right" && (
              <Icon icon={icon} className="w-5 h-5 ml-2" />
            )}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
