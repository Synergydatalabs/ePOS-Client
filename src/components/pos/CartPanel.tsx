"use client";

import { Icon } from "@iconify/react";
import { useT } from "@/lib/i18n/context";
import { Button } from "../ui";

interface CartItem {
  id: string;
  productId: string;
  productName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  modifiersTotal: number;
  modifiers?: { name: string; price: number }[];
  specialInstructions?: string;
  /** Seat number for restaurant DINE_IN orders. Defaults to 1 when not set. */
  seat?: number;
}

interface CartPanelProps {
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  currency?: string;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  tableNumber?: string;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onRemoveItem: (itemId: string) => void;
  onClearCart: () => void;
  onCheckout: () => void;
  onChangeOrderType: (type: "DINE_IN" | "TAKEAWAY" | "DELIVERY") => void;
  disabled?: boolean;
  businessType?: string;
  /** Discount summary — shown as a line in totals with a remove button */
  discountAmount?: number;
  discountLabel?: string;
  onOpenDiscount?: () => void;
  onRemoveDiscount?: () => void;
  /** Attached customer — shown as a chip in the header. */
  customerName?: string;
  customerSubline?: string;
  onOpenCustomer?: () => void;
  onRemoveCustomer?: () => void;
  /**
   * Restaurant DINE_IN only: how many seats are at this table. Shown as a
   * stepper above the cart and used to bound the per-item seat picker.
   * Default 1 (all items go to seat 1).
   */
  numberOfSeats?: number;
  onChangeNumberOfSeats?: (n: number) => void;
  /** Restaurant DINE_IN only: update the seat assignment for a cart item. */
  onChangeItemSeat?: (itemId: string, seat: number) => void;
}

export default function CartPanel({
  items,
  subtotal,
  taxAmount,
  total,
  currency = "CAD",
  orderType,
  tableNumber,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onCheckout,
  onChangeOrderType,
  disabled = false,
  businessType,
  numberOfSeats = 1,
  onChangeNumberOfSeats,
  onChangeItemSeat,
  discountAmount = 0,
  discountLabel,
  onOpenDiscount,
  onRemoveDiscount,
  customerName,
  customerSubline,
  onOpenCustomer,
  onRemoveCustomer,
}: CartPanelProps) {
  const isSalon = businessType === "salon";
  const isRetail = businessType === "retail";
  // Per-seat controls only make sense for restaurant dine-in — takeaway,
  // delivery, salon and retail share one implicit "seat 1".
  const isRestaurantDineIn =
    !isSalon && !isRetail && orderType === "DINE_IN";
  const showSeatControls =
    isRestaurantDineIn && typeof onChangeItemSeat === "function";
  const safeSeats = Math.max(1, Math.min(9, numberOfSeats));
  const { t, locale } = useT();
  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">
            {t("pos.current_order")}
          </h2>
          {items.length > 0 && (
            <button
              onClick={onClearCart}
              className="text-sm text-red-600 hover:text-red-700 font-medium"
            >
              {t("pos.clear_all")}
            </button>
          )}
        </div>

        {/* Customer chip — attached customer takes the header slot; the
            "add customer" link appears when nothing's attached. */}
        {customerName ? (
          <div className="mb-3 flex items-center gap-2 p-2 rounded-xl bg-indigo-50 border border-indigo-100">
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
              {customerName
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-indigo-900 truncate">
                {customerName}
              </p>
              {customerSubline && (
                <p className="text-xs text-indigo-600/80 truncate">
                  {customerSubline}
                </p>
              )}
            </div>
            {onRemoveCustomer && (
              <button
                onClick={onRemoveCustomer}
                className="p-1 rounded hover:bg-white/50 text-indigo-600 flex-shrink-0"
                title="Remove customer"
              >
                <Icon icon="solar:close-circle-linear" className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : onOpenCustomer ? (
          <button
            onClick={onOpenCustomer}
            className="mb-3 w-full flex items-center gap-2 p-2 rounded-xl border border-dashed border-gray-300 hover:border-indigo-400 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 transition-colors"
          >
            <Icon icon="solar:user-plus-linear" className="w-4 h-4" />
            <span className="text-sm font-medium">{t("pos.add_customer")}</span>
          </button>
        ) : null}

        {/* Order Type label — only for salon/retail. Restaurant's
            Dine In / Takeaway / Delivery selector now lives in the POS
            top bar so the cashier picks it before searching items. We
            still show the current type as a passive badge for clarity. */}
        {isSalon ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-xl">
            <Icon icon="solar:calendar-bold" className="w-5 h-5 text-purple-600" />
            <span className="text-sm font-medium text-purple-700">Appointment</span>
          </div>
        ) : isRetail ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 rounded-xl">
            <Icon icon="solar:bag-heart-bold" className="w-5 h-5 text-teal-600" />
            <span className="text-sm font-medium text-teal-700">Sale</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 rounded-xl">
            <Icon
              icon={
                orderType === "DINE_IN"
                  ? "solar:chair-bold"
                  : orderType === "TAKEAWAY"
                  ? "solar:bag-bold"
                  : "solar:delivery-bold"
              }
              className="w-5 h-5 text-teal-600"
            />
            <span className="text-sm font-medium text-teal-700">
              {orderType === "DINE_IN"
                ? "Dine In"
                : orderType === "TAKEAWAY"
                ? "Takeaway"
                : "Delivery"}
            </span>
            {orderType === "DINE_IN" && tableNumber && (
              <span className="ml-auto text-sm font-semibold text-teal-700">
                Table {tableNumber}
              </span>
            )}
          </div>
        )}

        {/* Seats stepper — restaurant dine-in only. The stepper sets the
            upper bound for the per-item seat picker. Items already
            assigned to a now-out-of-range seat fall back to seat 1 on
            checkout (parent handles clamping). */}
        {showSeatControls && (
          <div className="mt-3 flex items-center justify-between px-3 py-2 bg-amber-50 rounded-xl border border-amber-100">
            <div className="flex items-center gap-2">
              <Icon icon="solar:armchair-bold" className="w-4 h-4 text-amber-700" />
              <span className="text-sm font-medium text-amber-800">Seats at table</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  onChangeNumberOfSeats?.(Math.max(1, safeSeats - 1))
                }
                disabled={safeSeats <= 1}
                className="w-7 h-7 rounded-md bg-white border border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-40 flex items-center justify-center"
                aria-label="Decrease seats"
              >
                <Icon icon="solar:minus-linear" className="w-4 h-4" />
              </button>
              <span className="w-6 text-center font-semibold text-amber-900">
                {safeSeats}
              </span>
              <button
                onClick={() =>
                  onChangeNumberOfSeats?.(Math.min(9, safeSeats + 1))
                }
                disabled={safeSeats >= 9}
                className="w-7 h-7 rounded-md bg-white border border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-40 flex items-center justify-center"
                aria-label="Increase seats"
              >
                <Icon icon="solar:add-linear" className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <Icon icon="solar:cart-large-2-linear" className="w-16 h-16 mb-3" />
            <p className="font-medium">Cart is empty</p>
            <p className="text-sm">Add items to start an order</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="pos-cart-item">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {item.productName}
                  {item.variantName && (
                    <span className="text-gray-500 font-normal"> - {item.variantName}</span>
                  )}
                </p>
                {item.modifiers && item.modifiers.length > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    + {item.modifiers.map((m) => m.name).join(", ")}
                  </p>
                )}
                {item.specialInstructions && (
                  <p className="text-xs text-amber-600 mt-0.5 italic">
                    Note: {item.specialInstructions}
                  </p>
                )}
                <p className="text-sm font-semibold text-teal-600 mt-1">
                  {formatPrice((item.unitPrice + item.modifiersTotal) * item.quantity)}
                </p>

                {/* Seat assignment — restaurant dine-in with seats > 1.
                    For single-seat tables there's nothing to pick. */}
                {showSeatControls && safeSeats > 1 && (
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-gray-500 uppercase font-medium tracking-wide">
                      Seat:
                    </span>
                    {Array.from({ length: safeSeats }, (_, i) => i + 1).map((s) => {
                      const isCurrent = (item.seat ?? 1) === s;
                      return (
                        <button
                          key={s}
                          onClick={() => onChangeItemSeat?.(item.id, s)}
                          className={`w-7 h-7 rounded-md text-xs font-semibold transition-colors ${
                            isCurrent
                              ? "bg-amber-500 text-white"
                              : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                          }`}
                          aria-label={`Assign to seat ${s}`}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Quantity Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    item.quantity > 1
                      ? onUpdateQuantity(item.id, item.quantity - 1)
                      : onRemoveItem(item.id)
                  }
                  className="w-8 h-8 rounded-lg bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors"
                >
                  <Icon
                    icon={item.quantity > 1 ? "solar:minus-linear" : "solar:trash-bin-trash-linear"}
                    className={`w-4 h-4 ${item.quantity > 1 ? "text-gray-600" : "text-red-500"}`}
                  />
                </button>
                <span className="w-8 text-center font-semibold text-gray-900">
                  {item.quantity}
                </span>
                <button
                  onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                  className="w-8 h-8 rounded-lg bg-teal-100 hover:bg-teal-200 flex items-center justify-center transition-colors"
                >
                  <Icon icon="solar:add-linear" className="w-4 h-4 text-teal-600" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer - Totals & Checkout */}
      {items.length > 0 && (
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{t("common.subtotal")}</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            {discountAmount > 0 ? (
              <div className="flex justify-between text-sm text-red-600 items-center">
                <span className="flex items-center gap-1 min-w-0">
                  <span className="font-medium">{t("common.discount")}</span>
                  {discountLabel && (
                    <span className="text-xs text-gray-500 truncate">
                      · {discountLabel}
                    </span>
                  )}
                  {onRemoveDiscount && (
                    <button
                      onClick={onRemoveDiscount}
                      className="ml-1 text-gray-400 hover:text-red-600 flex-shrink-0"
                      title="Remove discount"
                    >
                      <Icon icon="solar:close-circle-linear" className="w-4 h-4" />
                    </button>
                  )}
                </span>
                <span>−{formatPrice(discountAmount)}</span>
              </div>
            ) : onOpenDiscount ? (
              <button
                onClick={onOpenDiscount}
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
              >
                <Icon icon="solar:tag-price-linear" className="w-4 h-4" />
                {t("pos.add_discount")}
              </button>
            ) : null}
            <div className="flex justify-between text-sm text-gray-600">
              <span>{t("common.tax")}</span>
              <span>{formatPrice(taxAmount)}</span>
            </div>
            <div className="h-px bg-gray-200" />
            <div className="flex justify-between text-lg font-bold text-gray-900">
              <span>{t("common.total")}</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>

          <Button
            onClick={onCheckout}
            disabled={disabled || items.length === 0}
            fullWidth
            size="xl"
            icon="solar:card-bold"
          >
            {t("pos.checkout")} • {formatPrice(total)}
          </Button>
        </div>
      )}
    </div>
  );
}
