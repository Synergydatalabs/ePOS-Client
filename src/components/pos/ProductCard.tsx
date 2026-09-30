"use client";

import { Icon } from "@iconify/react";

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  imageUrl?: string;
  isAvailable?: boolean;
  hasVariants?: boolean;
  hasModifiers?: boolean;
  hasAllergens?: boolean;
  durationMinutes?: number;
  currency?: string;
  onClick: () => void;
}

export default function ProductCard({
  name,
  price,
  imageUrl,
  isAvailable = true,
  hasVariants = false,
  hasModifiers = false,
  hasAllergens = false,
  durationMinutes,
  currency = "CAD",
  onClick,
}: ProductCardProps) {
  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  return (
    <button
      onClick={onClick}
      disabled={!isAvailable}
      className={`pos-product-card text-left w-full ${!isAvailable ? "unavailable" : ""}`}
    >
      {/* Image or Placeholder */}
      <div className="aspect-square rounded-xl bg-gradient-to-br from-gray-100 to-gray-50 mb-3 overflow-hidden relative">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <Icon icon="solar:box-bold" className="w-12 h-12" />
          </div>
        )}

        {/* Status indicators */}
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          {hasAllergens && (
            <span className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs">
              <Icon icon="solar:danger-triangle-bold" className="w-4 h-4" />
            </span>
          )}
          {(hasVariants || hasModifiers) && (
            <span className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs">
              <Icon icon="solar:settings-bold" className="w-4 h-4" />
            </span>
          )}
        </div>

        {/* Unavailable overlay */}
        {!isAvailable && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
            <span className="px-3 py-1 rounded-full bg-red-100 text-red-600 text-xs font-semibold">
              Sold Out
            </span>
          </div>
        )}
      </div>

      {/* Name & Price */}
      <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1">
        {name}
      </h3>
      <div className="flex items-center gap-2">
        <p className="text-teal-600 font-bold">{formatPrice(price)}</p>
        {durationMinutes && (
          <span className="text-xs text-gray-400 font-medium">{durationMinutes} min</span>
        )}
      </div>
    </button>
  );
}
