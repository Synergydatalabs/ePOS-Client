"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { Modal, Button } from "@/components/ui";
import { toast } from "sonner";

// The kind of discount the cashier is applying. Kept internal to the
// modal so the parent only sees the resolved DiscountApplied shape.
type Mode = "code" | "percent" | "fixed";

export interface DiscountApplied {
  amount: number; // cents applied to the order
  reason: string; // audit-friendly string
  promotionId?: string;
  code?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  cartSubtotal: number; // pre-discount subtotal in cents
  currency: string;
  onApply: (d: DiscountApplied) => void;
}

const QUICK_PCT = [5, 10, 15, 20, 25];
const QUICK_FIXED = [1, 2, 5, 10]; // dollars

export default function DiscountModal({
  isOpen,
  onClose,
  tenantId,
  cartSubtotal,
  currency,
  onApply,
}: Props) {
  const [mode, setMode] = useState<Mode>("code");
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState<string>("");
  const [fixed, setFixed] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
      (cents || 0) / 100
    );

  const applyCode = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/promotions/validate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, cartSubtotal }),
        }
      );
      const data = await res.json();
      if (!data.valid) {
        setError(data.error || "Invalid code");
        return;
      }
      onApply({
        amount: data.computedDiscount,
        reason: `Promo: ${data.promotion.name}`,
        promotionId: data.promotion.id,
        code: data.promotion.code || undefined,
      });
      onClose();
      toast.success(`Applied ${formatPrice(data.computedDiscount)} discount`);
    } catch {
      setError("Could not validate code");
    } finally {
      setChecking(false);
    }
  };

  const applyManualPercent = () => {
    const p = parseFloat(pct || "0");
    if (!p || p <= 0 || p > 100) {
      setError("Enter a percentage between 0 and 100");
      return;
    }
    if (!reason.trim()) {
      setError("Reason is required for manual discounts");
      return;
    }
    const amount = Math.floor((cartSubtotal * p) / 100);
    onApply({
      amount,
      reason: `Manual ${p}% off — ${reason.trim()}`,
    });
    onClose();
    toast.success(`Applied ${formatPrice(amount)} discount`);
  };

  const applyManualFixed = () => {
    const cents = Math.round(parseFloat(fixed || "0") * 100);
    if (!cents || cents <= 0) {
      setError("Enter an amount greater than 0");
      return;
    }
    if (cents > cartSubtotal) {
      setError("Discount can't exceed the cart subtotal");
      return;
    }
    if (!reason.trim()) {
      setError("Reason is required for manual discounts");
      return;
    }
    onApply({
      amount: cents,
      reason: `Manual $ off — ${reason.trim()}`,
    });
    onClose();
    toast.success(`Applied ${formatPrice(cents)} discount`);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" title="Apply Discount">
      <div className="space-y-4">
        {/* Mode picker */}
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "code" as Mode, label: "Promo Code", icon: "solar:ticket-bold" },
              { id: "percent" as Mode, label: "% Off", icon: "solar:tag-price-bold" },
              { id: "fixed" as Mode, label: "$ Off", icon: "solar:wallet-money-bold" },
            ]
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                setError(null);
              }}
              className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-colors ${
                mode === m.id
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <Icon
                icon={m.icon}
                className={`w-5 h-5 ${mode === m.id ? "text-indigo-600" : "text-gray-400"}`}
              />
              <span className="text-sm font-medium text-gray-900">
                {m.label}
              </span>
            </button>
          ))}
        </div>

        <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-baseline justify-between text-sm">
          <span className="text-gray-600">Cart subtotal</span>
          <span className="font-semibold text-gray-900">
            {formatPrice(cartSubtotal)}
          </span>
        </div>

        {mode === "code" && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Promo Code
              </label>
              <input
                autoFocus
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && code.trim() && applyCode()}
                placeholder="e.g. SUMMER10"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none font-mono text-lg tracking-wider"
              />
            </div>
            <Button
              onClick={applyCode}
              disabled={!code.trim() || checking}
              loading={checking}
              fullWidth
              size="lg"
            >
              Apply Code
            </Button>
          </div>
        )}

        {mode === "percent" && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Percentage off
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={pct}
                onChange={(e) => {
                  setPct(e.target.value);
                  setError(null);
                }}
                placeholder="10"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
              <div className="flex gap-1 mt-2">
                {QUICK_PCT.map((v) => (
                  <button
                    key={v}
                    onClick={() => setPct(String(v))}
                    className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    {v}%
                  </button>
                ))}
              </div>
              {pct && parseFloat(pct) > 0 && (
                <p className="text-xs text-gray-600 mt-2">
                  Discount:{" "}
                  <span className="font-semibold">
                    {formatPrice(
                      Math.floor((cartSubtotal * parseFloat(pct)) / 100)
                    )}
                  </span>
                </p>
              )}
            </div>
            <ReasonInput reason={reason} setReason={setReason} setError={setError} />
            <Button
              onClick={applyManualPercent}
              disabled={!pct || !reason.trim()}
              fullWidth
              size="lg"
            >
              Apply {pct ? `${pct}%` : "%"} Off
            </Button>
          </div>
        )}

        {mode === "fixed" && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount off ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={fixed}
                onChange={(e) => {
                  setFixed(e.target.value);
                  setError(null);
                }}
                placeholder="5.00"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
              <div className="flex gap-1 mt-2">
                {QUICK_FIXED.map((v) => (
                  <button
                    key={v}
                    onClick={() => setFixed(v.toFixed(2))}
                    className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    ${v}
                  </button>
                ))}
              </div>
            </div>
            <ReasonInput reason={reason} setReason={setReason} setError={setError} />
            <Button
              onClick={applyManualFixed}
              disabled={!fixed || !reason.trim()}
              fullWidth
              size="lg"
            >
              Apply {fixed ? formatPrice(Math.round(parseFloat(fixed) * 100)) : "$0"} Off
            </Button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700 flex items-start gap-2">
            <Icon
              icon="solar:danger-triangle-bold"
              className="w-5 h-5 flex-shrink-0"
            />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ReasonInput({
  reason,
  setReason,
  setError,
}: {
  reason: string;
  setReason: (v: string) => void;
  setError: (v: string | null) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Reason <span className="text-red-500">*</span>
      </label>
      <input
        type="text"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setError(null);
        }}
        placeholder="e.g. Regular customer, damaged item, manager comp"
        className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
      />
    </div>
  );
}
