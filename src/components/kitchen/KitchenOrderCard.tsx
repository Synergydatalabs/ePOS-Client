"use client";

import { useState, useEffect, useMemo } from "react";
import { Icon } from "@iconify/react";
import { AllergenBadge } from "../ui/Badge";

interface OrderItem {
  queueId: string;
  itemId: string;
  productName: string;
  variantName?: string;
  quantity: number;
  modifiers?: { modifierName: string }[];
  specialInstructions?: string;
  allergenNotes?: {
    allergen: { name: string; icon: string };
    note: string;
    isAllergy: boolean;
  }[];
  status: string;
  prepTimeMinutes?: number;
}

interface KitchenOrderCardProps {
  orderId: string;
  orderNumber: string;
  displayNumber: number;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  table?: { tableNumber: number; name: string };
  customerName?: string;
  items: OrderItem[];
  hasAllergyAlert: boolean;
  createdAt: Date;
  waitMinutes: number;
  onBump: () => void;
  onItemStart: (queueId: string) => void;
  onItemReady: (queueId: string) => void;
}

export default function KitchenOrderCard({
  orderNumber,
  displayNumber,
  orderType,
  table,
  customerName,
  items,
  hasAllergyAlert,
  createdAt,
  waitMinutes,
  onBump,
  onItemStart,
  onItemReady,
}: KitchenOrderCardProps) {
  const [timer, setTimer] = useState(waitMinutes);

  // Update timer every minute
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const created = new Date(createdAt);
      const diff = Math.floor((now.getTime() - created.getTime()) / 60000);
      setTimer(diff);
    }, 60000);
    return () => clearInterval(interval);
  }, [createdAt]);

  // Determine card status
  const cardStatus = useMemo(() => {
    const allReady = items.every((i) => i.status === "READY");
    const someCooking = items.some((i) => i.status === "IN_PROGRESS");
    if (allReady) return "ready";
    if (someCooking) return "cooking";
    return "new";
  }, [items]);

  // Determine if rush (over 10 minutes)
  const isRush = timer > 10;

  // Timer color
  const timerClass = useMemo(() => {
    if (timer > 15) return "kds-timer critical";
    if (timer > 10) return "kds-timer warning";
    return "kds-timer";
  }, [timer]);

  return (
    <div
      className={`kds-order-card ${cardStatus} ${isRush && cardStatus !== "ready" ? "rush" : ""}`}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Order Number */}
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black text-gray-900">#{displayNumber}</span>
            {hasAllergyAlert && (
              <span className="allergy-badge">
                <Icon icon="solar:danger-triangle-bold" className="w-4 h-4" />
                ALLERGY
              </span>
            )}
          </div>
        </div>

        {/* Timer */}
        <div className={timerClass}>
          <Icon icon="solar:clock-circle-linear" className="w-5 h-5 inline mr-1" />
          {timer}m
        </div>
      </div>

      {/* Order Type & Customer Info */}
      <div className="px-4 py-2 bg-white border-b border-gray-100 flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-gray-600">
          <Icon
            icon={
              orderType === "DINE_IN"
                ? "solar:chair-bold"
                : orderType === "TAKEAWAY"
                ? "solar:bag-bold"
                : "solar:delivery-bold"
            }
            className="w-4 h-4"
          />
          {orderType === "DINE_IN" && table
            ? `Table ${table.tableNumber}`
            : orderType === "DINE_IN"
            ? "Dine In"
            : orderType === "TAKEAWAY"
            ? "Takeaway"
            : "Delivery"}
        </div>
        {customerName && (
          <div className="flex items-center gap-1.5 text-gray-600">
            <Icon icon="solar:user-bold" className="w-4 h-4" />
            {customerName}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="divide-y divide-gray-100">
        {items.map((item) => {
          const hasAllergy = item.allergenNotes?.some((a) => a.isAllergy);
          return (
            <div
              key={item.queueId}
              className={`kds-item ${hasAllergy ? "has-allergy" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Product Name & Quantity */}
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black text-gray-900">
                      {item.quantity}x
                    </span>
                    <span className="font-semibold text-gray-900 text-lg">
                      {item.productName}
                      {item.variantName && (
                        <span className="text-gray-500 font-normal">
                          {" "}
                          ({item.variantName})
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Modifiers */}
                  {item.modifiers && item.modifiers.length > 0 && (
                    <div className="mt-1 text-sm text-teal-600">
                      + {item.modifiers.map((m) => m.modifierName).join(", ")}
                    </div>
                  )}

                  {/* Special Instructions */}
                  {item.specialInstructions && (
                    <div className="mt-2 p-2 bg-amber-50 rounded-lg text-amber-800 text-sm font-medium">
                      <Icon icon="solar:chat-round-dots-bold" className="w-4 h-4 inline mr-1" />
                      {item.specialInstructions}
                    </div>
                  )}

                  {/* Allergy Notes */}
                  {item.allergenNotes && item.allergenNotes.filter((a) => a.isAllergy).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {item.allergenNotes
                        .filter((a) => a.isAllergy)
                        .map((an, idx) => (
                          <div key={idx} className="allergy-alert">
                            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5" />
                            {an.note}
                          </div>
                        ))}
                    </div>
                  )}

                  {/* Allergen Badges */}
                  {item.allergenNotes && item.allergenNotes.filter((a) => !a.isAllergy).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.allergenNotes
                        .filter((a) => !a.isAllergy)
                        .map((an, idx) => (
                          <AllergenBadge
                            key={idx}
                            name={an.allergen.name}
                            icon={an.allergen.icon}
                          />
                        ))}
                    </div>
                  )}
                </div>

                {/* Item Status Button */}
                <div className="flex-shrink-0">
                  {item.status === "PENDING" && (
                    <button
                      onClick={() => onItemStart(item.queueId)}
                      className="px-4 py-2 rounded-xl bg-blue-100 text-blue-700 font-semibold hover:bg-blue-200 transition-colors"
                    >
                      Start
                    </button>
                  )}
                  {item.status === "IN_PROGRESS" && (
                    <button
                      onClick={() => onItemReady(item.queueId)}
                      className="px-4 py-2 rounded-xl bg-amber-100 text-amber-700 font-semibold hover:bg-amber-200 transition-colors animate-pulse"
                    >
                      <Icon icon="solar:chef-hat-bold" className="w-5 h-5 inline mr-1" />
                      Cooking
                    </button>
                  )}
                  {item.status === "READY" && (
                    <span className="px-4 py-2 rounded-xl bg-green-100 text-green-700 font-semibold">
                      <Icon icon="solar:check-circle-bold" className="w-5 h-5 inline mr-1" />
                      Ready
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bump Button */}
      <button
        onClick={onBump}
        className={`kds-bump-btn ${cardStatus === "ready" ? "ready" : "cooking"}`}
      >
        {cardStatus === "ready" ? (
          <>
            <Icon icon="solar:check-circle-bold" className="w-6 h-6 inline mr-2" />
            BUMP ORDER
          </>
        ) : (
          <>
            <Icon icon="solar:hand-stars-bold" className="w-6 h-6 inline mr-2" />
            ALL READY
          </>
        )}
      </button>
    </div>
  );
}
