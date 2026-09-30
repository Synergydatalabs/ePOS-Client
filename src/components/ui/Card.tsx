"use client";

import { HTMLAttributes, forwardRef } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ children, hover = false, padding = "md", className = "", ...props }, ref) => {
    const paddingClasses = {
      none: "",
      sm: "p-4",
      md: "p-6",
      lg: "p-8",
    };

    return (
      <div
        ref={ref}
        className={`card ${hover ? "card-hover cursor-pointer" : ""} ${paddingClasses[padding]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

// Card Header
interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ title, subtitle, action, className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex items-center justify-between mb-4 ${className}`}
        {...props}
      >
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
    );
  }
);

CardHeader.displayName = "CardHeader";

// Stat Card
interface StatCardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    type: "increase" | "decrease";
  };
  icon?: string;
  iconColor?: string;
}

export const StatCard = ({ title, value, change, icon, iconColor = "text-teal-600" }: StatCardProps) => {
  const Icon = require("@iconify/react").Icon;

  return (
    <div className="admin-stat-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {change && (
            <p
              className={`text-sm font-medium mt-2 flex items-center gap-1 ${
                change.type === "increase" ? "text-green-600" : "text-red-600"
              }`}
            >
              <Icon
                icon={change.type === "increase" ? "solar:arrow-up-bold" : "solar:arrow-down-bold"}
                className="w-4 h-4"
              />
              {Math.abs(change.value)}%
            </p>
          )}
        </div>
        {icon && (
          <div className={`p-3 rounded-xl bg-gray-50 ${iconColor}`}>
            <Icon icon={icon} className="w-6 h-6" />
          </div>
        )}
      </div>
    </div>
  );
};

export default Card;
