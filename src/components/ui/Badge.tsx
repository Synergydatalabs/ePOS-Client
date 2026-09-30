"use client";

import { HTMLAttributes, forwardRef } from "react";
import { Icon } from "@iconify/react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "primary" | "success" | "warning" | "danger" | "info" | "gray";
  size?: "sm" | "md" | "lg";
  icon?: string;
  dot?: boolean;
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    { children, variant = "gray", size = "md", icon, dot, className = "", ...props },
    ref
  ) => {
    const sizeClasses = {
      sm: "px-2 py-0.5 text-xs",
      md: "px-2.5 py-0.5 text-xs",
      lg: "px-3 py-1 text-sm",
    };

    return (
      <span
        ref={ref}
        className={`badge badge-${variant} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {dot && (
          <span
            className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
              variant === "success"
                ? "bg-green-500"
                : variant === "warning"
                ? "bg-amber-500"
                : variant === "danger"
                ? "bg-red-500"
                : variant === "info"
                ? "bg-blue-500"
                : variant === "primary"
                ? "bg-teal-500"
                : "bg-gray-500"
            }`}
          />
        )}
        {icon && <Icon icon={icon} className="w-3.5 h-3.5 mr-1" />}
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";

// Order Status Badge
interface OrderStatusBadgeProps {
  status: string;
}

export const OrderStatusBadge = ({ status }: OrderStatusBadgeProps) => {
  const config: Record<string, { variant: BadgeProps["variant"]; label: string; icon: string }> = {
    NEW: { variant: "info", label: "New", icon: "solar:add-circle-bold" },
    CONFIRMED: { variant: "primary", label: "Confirmed", icon: "solar:check-circle-bold" },
    PREPARING: { variant: "warning", label: "Preparing", icon: "solar:chef-hat-bold" },
    READY: { variant: "success", label: "Ready", icon: "solar:bell-bold" },
    SERVED: { variant: "success", label: "Served", icon: "solar:delivery-bold" },
    PICKED_UP: { variant: "success", label: "Picked Up", icon: "solar:bag-check-bold" },
    DELIVERED: { variant: "success", label: "Delivered", icon: "solar:delivery-bold" },
    COMPLETED: { variant: "gray", label: "Completed", icon: "solar:check-circle-bold" },
    CANCELLED: { variant: "danger", label: "Cancelled", icon: "solar:close-circle-bold" },
  };

  const { variant, label, icon } = config[status] || config.NEW;

  return (
    <Badge variant={variant} icon={icon}>
      {label}
    </Badge>
  );
};

// Payment Status Badge
interface PaymentStatusBadgeProps {
  status: string;
}

export const PaymentStatusBadge = ({ status }: PaymentStatusBadgeProps) => {
  const config: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
    PENDING: { variant: "warning", label: "Pending" },
    PROCESSING: { variant: "info", label: "Processing" },
    COMPLETED: { variant: "success", label: "Paid" },
    FAILED: { variant: "danger", label: "Failed" },
    REFUNDED: { variant: "gray", label: "Refunded" },
  };

  const { variant, label } = config[status] || config.PENDING;

  return (
    <Badge variant={variant} dot>
      {label}
    </Badge>
  );
};

// Allergen Badge
interface AllergenBadgeProps {
  name: string;
  icon?: string;
  isAllergy?: boolean;
}

export const AllergenBadge = ({ name, icon, isAllergy = false }: AllergenBadgeProps) => {
  if (isAllergy) {
    return (
      <span className="allergy-badge">
        <Icon icon="solar:danger-triangle-bold" className="w-3 h-3" />
        {name}
      </span>
    );
  }

  return (
    <Badge variant="warning" size="sm">
      {icon && <span className="mr-1">{icon}</span>}
      {name}
    </Badge>
  );
};

export default Badge;
