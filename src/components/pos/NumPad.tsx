"use client";

import { Icon } from "@iconify/react";

interface NumPadProps {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  showDecimal?: boolean;
  maxLength?: number;
}

export default function NumPad({
  value,
  onChange,
  onEnter,
  showDecimal = true,
  maxLength = 10,
}: NumPadProps) {
  const handleInput = (digit: string) => {
    if (value.length >= maxLength) return;

    // Handle decimal
    if (digit === "." && value.includes(".")) return;
    if (digit === "." && value === "") {
      onChange("0.");
      return;
    }

    // Handle leading zero
    if (digit === "0" && value === "0") return;
    if (value === "0" && digit !== ".") {
      onChange(digit);
      return;
    }

    onChange(value + digit);
  };

  const handleBackspace = () => {
    onChange(value.slice(0, -1));
  };

  const handleClear = () => {
    onChange("");
  };

  const buttons = [
    { label: "7", value: "7" },
    { label: "8", value: "8" },
    { label: "9", value: "9" },
    { label: "4", value: "4" },
    { label: "5", value: "5" },
    { label: "6", value: "6" },
    { label: "1", value: "1" },
    { label: "2", value: "2" },
    { label: "3", value: "3" },
    { label: showDecimal ? "." : "00", value: showDecimal ? "." : "00" },
    { label: "0", value: "0" },
    { label: "back", value: "back", icon: "solar:backspace-linear" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {/* Clear Button */}
      <button
        onClick={handleClear}
        className="pos-numpad-btn danger col-span-3 !aspect-auto h-12"
      >
        Clear
      </button>

      {/* Number Buttons */}
      {buttons.map((btn) => (
        <button
          key={btn.value}
          onClick={() =>
            btn.value === "back" ? handleBackspace() : handleInput(btn.value)
          }
          className="pos-numpad-btn"
        >
          {btn.icon ? (
            <Icon icon={btn.icon} className="w-6 h-6" />
          ) : (
            btn.label
          )}
        </button>
      ))}

      {/* Enter Button */}
      {onEnter && (
        <button
          onClick={onEnter}
          className="pos-numpad-btn action col-span-3 !aspect-auto h-14"
        >
          <Icon icon="solar:check-circle-bold" className="w-6 h-6 mr-2" />
          Confirm
        </button>
      )}
    </div>
  );
}

// Quick Amount Buttons
interface QuickAmountProps {
  amounts: number[];
  onSelect: (amount: number) => void;
  currency?: string;
}

export function QuickAmountButtons({ amounts, onSelect, currency = "CAD" }: QuickAmountProps) {
  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
    }).format(amount / 100);
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {amounts.map((amount) => (
        <button
          key={amount}
          onClick={() => onSelect(amount)}
          className="py-3 px-4 rounded-xl bg-teal-50 text-teal-700 font-semibold hover:bg-teal-100 transition-colors"
        >
          {formatPrice(amount)}
        </button>
      ))}
    </div>
  );
}
