"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { Button, Modal } from "../ui";
import NumPad, { QuickAmountButtons } from "./NumPad";
import { QRCodeSVG } from "qrcode.react";
import type { TerminalPaymentState, TerminalPaymentResult } from "@/hooks/useTerminal";
import {
  computeAdjustedTotals,
  isCashLikeMethod,
  type CashDiscountConfig,
} from "@/lib/cash-discount";

interface PaymentResult {
  success: boolean;
  change?: number;
  qrCode?: string;
  orderId?: string;
  orderNumber?: string;
  cardDetails?: {
    cardType: string;
    maskedPan: string;
    entryMode: string;
    authCode: string;
  };
  giftCard?: {
    applied: number;
    remainingOnCard: number;
    remainingOnOrder: number;
  };
  // How much of this tender was actually credited to the order (after
  // capping at outstanding). Returned by the server for CASH/CARD/GIFT
  // paths; the modal uses it to keep its own running total in split mode.
  applied?: number;
  // Cents still owed on the order after this tender. Server-computed.
  remaining?: number;
  error?: string;
  errorType?: string;
  terminalTxId?: string;
}

// Extras piggy-back on onPayment() so callers can pass method-specific
// data (gift-card codes, orderId for split tenders, cash-discount /
// surcharge amounts). Kept optional to avoid touching every caller.
type PaymentExtras = {
  code?: string;
  orderId?: string;
  surchargeAmount?: number;
  cashDiscountAmount?: number;
  cashDiscountReason?: string;
  // Phase 8 QA: POS-side tip captured on Cash or QR (bakes into the
  // order so the customer QR page sees it and skips its own tip picker).
  tipAmount?: number;
};

// One committed tender in a split payment. Not persisted client-side —
// derived from onPayment responses and reset when the modal closes.
interface Tender {
  id: string;
  method: string;
  amount: number; // cents actually applied to the order
  meta?: string; // display detail (last-4 for cards, code tail for gift, "change: $x" for cash)
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  total: number;
  currency?: string;
  onPayment: (method: string, amount?: number, extras?: PaymentExtras) => Promise<PaymentResult>;
  onPaymentComplete?: () => void;
  tenantId?: string;
  locationId?: string;
  /**
   * Optional callback fired when the operator taps "Split Bill". The
   * parent creates the order first (via a TERMINAL_INTENT-style call),
   * then passes the resulting orderId into <BillSplitModal>. When absent,
   * the Split Bill button is hidden.
   */
  onSplitBill?: () => void;
  /**
   * Cash discount / dual pricing config from tenant settings. When
   * enabled, the modal shows both the cash and card price up front, then
   * adjusts the active total to match the selected method.
   */
  cashDiscount?: CashDiscountConfig;
  /**
   * Tenant brand colour (hex). Drives the most prominent accents in the
   * modal — selected tip button, payment-method hover state, "Cash
   * Received" block. Semantic colours (green = approved, red = declined,
   * amber = timeout) are NEVER overridden by branding because they carry
   * meaning the operator needs to recognise regardless of theme.
   * Defaults to teal-600 (the template colour) when not supplied so iTAP
   * looks the same as it always has.
   */
  brandColor?: string;
  // Browser-side terminal props
  terminalConnected?: boolean;
  terminalName?: string;
  onTerminalPayment?: (params: {
    orderId: string;
    amount: number;
    tipAmount: number;
    method: string;
  }) => Promise<TerminalPaymentResult>;
  onTerminalCancel?: () => Promise<boolean>;
  onTerminalRecover?: (orderId: string) => Promise<TerminalPaymentResult>;
  terminalPaymentState?: TerminalPaymentState;
  terminalResult?: TerminalPaymentResult | null;
  onResetTerminal?: () => void;
}

export default function PaymentModal({
  isOpen,
  onClose,
  total,
  currency = "CAD",
  onPayment,
  onPaymentComplete,
  tenantId,
  cashDiscount,
  onSplitBill,
  brandColor = "#0D9488",
  // Browser-side terminal props
  terminalConnected = false,
  terminalName,
  onTerminalPayment,
  onTerminalCancel,
  onTerminalRecover,
  terminalPaymentState = "idle",
  terminalResult,
  onResetTerminal,
}: PaymentModalProps) {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [tipPercent, setTipPercent] = useState<number | null>(null);
  // Absolute-cents override — set by "Add change as tip". When non-null,
  // takes precedence over the percent-based calc. Cleared whenever the
  // operator picks a preset again.
  const [tipCustomCents, setTipCustomCents] = useState<number | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "completed">("pending");
  // Track the orderId we created for terminal payments
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

  // Gift-card sub-flow state — code entry + pre-check balance + result
  const [giftCode, setGiftCode] = useState("");
  const [giftBalance, setGiftBalance] = useState<{
    balance: number;
    currency: string;
    redeemable: boolean;
    error?: string;
  } | null>(null);
  const [checkingGift, setCheckingGift] = useState(false);

  // Split-payment mode. When enabled, each completed tender is pushed to
  // the tenders list and the modal returns to the method picker instead
  // of closing. The order isn't marked "paid" until cumulative applied
  // covers finalTotal.
  const [splitMode, setSplitMode] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  // Reused across all subsequent tenders so we don't create a second
  // order. Set from the first tender's response.
  const [splitOrderId, setSplitOrderId] = useState<string | null>(null);

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  // Tip resolution: custom cents wins over percent. Both null → no tip.
  const tipAmount =
    tipCustomCents !== null
      ? tipCustomCents
      : tipPercent
        ? Math.round(total * (tipPercent / 100))
        : 0;

  // Cash-discount / dual-pricing: base total (pre-adjustment) is the
  // pre-tip subtotal + tip. Method chosen selects cash vs card price.
  const baseTotal = total + tipAmount;
  const cashDiscountCfg: CashDiscountConfig = cashDiscount || {
    enabled: false,
    percent: 0,
    mode: "SURCHARGE",
  };
  const dualTotals = computeAdjustedTotals(baseTotal, cashDiscountCfg);
  // Method-dependent total. Before the operator picks, default to card
  // price so we don't show a surprise increase after selection.
  const isCashish = selectedMethod ? isCashLikeMethod(selectedMethod) : false;
  const finalTotal =
    !cashDiscountCfg.enabled
      ? baseTotal
      : isCashish
        ? dualTotals.cashTotal
        : dualTotals.cardTotal;

  // In split mode, subsequent tenders should target only what's still owed
  // — that's the number the operator sees and that gets sent to the terminal
  // or applied from the gift card.
  const alreadyTendered = tenders.reduce((s, t) => s + t.amount, 0);
  const remainingDue = Math.max(0, finalTotal - alreadyTendered);
  const activeTarget = splitMode && tenders.length > 0 ? remainingDue : finalTotal;
  // Amount added (SURCHARGE) or subtracted (DISCOUNT) so we can pass it
  // through onPayment for the server to stamp on the Order row.
  const surchargeForOrder =
    cashDiscountCfg.enabled && !isCashish
      ? dualTotals.surchargeApplied
      : 0;
  const cashDiscountForOrder =
    cashDiscountCfg.enabled && isCashish
      ? dualTotals.cashDiscountApplied
      : 0;

  // Use browser terminal flow?
  const useBrowserTerminal =
    terminalConnected && onTerminalPayment && (selectedMethod === "CARD" || selectedMethod === "INTERAC");

  // Map terminal payment state for display
  const activeTerminalState: TerminalPaymentState =
    useBrowserTerminal ? terminalPaymentState : "idle";

  // Poll for payment status when QR code is shown
  const checkPaymentStatus = useCallback(async () => {
    if (!result?.orderId || !tenantId) return;

    try {
      const response = await fetch(`/api/pay/${result.orderId}`);
      const data = await response.json();

      if (data.success && data.order.paymentStatus === "COMPLETED") {
        setPaymentStatus("completed");
        setTimeout(() => {
          onPaymentComplete?.();
          handleClose();
        }, 2000);
      }
    } catch (error) {
      console.error("Error checking payment status:", error);
    }
  }, [result?.orderId, tenantId, onPaymentComplete]);

  useEffect(() => {
    if (selectedMethod === "ONLINE" && result?.qrCode && paymentStatus === "pending") {
      const interval = setInterval(checkPaymentStatus, 3000);
      return () => clearInterval(interval);
    }
  }, [selectedMethod, result?.qrCode, paymentStatus, checkPaymentStatus]);

  // Auto-close on terminal approval. In split mode, commit the tender and
  // return to the method picker instead so the operator can pick the next
  // one (card + cash, card + gift card, etc.).
  useEffect(() => {
    if (activeTerminalState === "approved" && terminalResult?.success) {
      setTimeout(() => {
        if (splitMode) {
          // Terminal always charges exactly the amount we sent, which was
          // activeTarget at send-time. Use it here as the tender amount.
          const meta = terminalResult.maskedPan
            ? `...${terminalResult.maskedPan.slice(-4)}`
            : undefined;
          if (commitTender(selectedMethod || "CARD", activeTarget, currentOrderId || undefined, meta)) {
            return;
          }
        }
        onPaymentComplete?.();
        handleClose();
      }, 2500);
    }
  }, [activeTerminalState, terminalResult]);

  const handleClose = async () => {
    // If a terminal payment is in-flight (bill sitting on the terminal
    // waiting for the customer to tap), closing the modal WITHOUT
    // cancelling leaves the bill live on the terminal — the customer
    // could still tap and pay, but the app would never know because
    // the modal + its polling loop are gone. Fire a cancel first: the
    // DELETE endpoint tells GP to remove the bill, AND if the customer
    // already paid it gracefully flips the local status to PAID and
    // reconciles the order. Either way the local state is correct.
    if (
      (activeTerminalState === "sending_to_terminal" ||
        activeTerminalState === "waiting_for_card") &&
      onTerminalCancel
    ) {
      try {
        await onTerminalCancel();
      } catch {
        // Fall through — a failed cancel shouldn't stop the operator
        // closing the modal. The stale-bill reconcile in the GET
        // endpoint will catch this on the next look-up.
      }
    }
    setResult(null);
    setSelectedMethod(null);
    setCashAmount("");
    setTipPercent(null);
    setTipCustomCents(null);
    setPaymentStatus("pending");
    setCurrentOrderId(null);
    setGiftCode("");
    setGiftBalance(null);
    setCheckingGift(false);
    setSplitMode(false);
    setTenders([]);
    setSplitOrderId(null);
    onResetTerminal?.();
    onClose();
  };

  // Common post-tender handler for split mode. Records the tender and
  // either resets to the method picker (if there's still balance to
  // collect) or lets the success flow through (single-payment behaviour).
  const commitTender = (
    method: string,
    applied: number,
    orderIdFromRes: string | undefined,
    meta?: string
  ) => {
    if (!splitMode) return false;
    const nextTenders: Tender[] = [
      ...tenders,
      { id: `${Date.now()}-${Math.random()}`, method, amount: applied, meta },
    ];
    setTenders(nextTenders);
    if (orderIdFromRes && !splitOrderId) setSplitOrderId(orderIdFromRes);

    const paidNow = nextTenders.reduce((s, t) => s + t.amount, 0);
    const stillDue = Math.max(0, finalTotal - paidNow);

    if (stillDue > 0) {
      // Reset UI back to the method grid so the operator can pick the
      // next tender. Clear per-method sub-state.
      setSelectedMethod(null);
      setCashAmount("");
      setGiftCode("");
      setGiftBalance(null);
      setResult(null);
      onResetTerminal?.();
      return true; // handled — don't run the caller's close-modal branch
    }
    // Fully covered — let the caller show its success screen + close.
    return false;
  };

  // Look up a gift-card code before applying it so the cashier sees the
  // available balance and can decide how to handle any shortfall. Uses the
  // public /check endpoint so it works even before the order exists.
  const checkGiftCard = async () => {
    if (!tenantId || !giftCode.trim()) return;
    setCheckingGift(true);
    setGiftBalance(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/gift-cards/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: giftCode }),
      });
      const data = await res.json();
      if (data.success) {
        setGiftBalance({
          balance: data.card.balance,
          currency: data.card.currency,
          redeemable: data.card.redeemable,
        });
      } else {
        setGiftBalance({
          balance: 0,
          currency,
          redeemable: false,
          error: data.error || "Card not found",
        });
      }
    } catch {
      setGiftBalance({
        balance: 0,
        currency,
        redeemable: false,
        error: "Could not reach server",
      });
    } finally {
      setCheckingGift(false);
    }
  };

  const handleGiftCardPayment = async () => {
    setProcessing(true);
    try {
      const res = await onPayment("GIFT_CARD", activeTarget, {
        code: giftCode,
        orderId: splitOrderId || undefined,
        // Gift cards are cash-like — carry through any cash-discount so
        // the order gets stamped correctly on the first tender that
        // creates it.
        cashDiscountAmount: cashDiscountForOrder || undefined,
        cashDiscountReason:
          cashDiscountForOrder > 0
            ? `${cashDiscountCfg.label || "Cash discount"} ${cashDiscountCfg.percent}%`
            : undefined,
      });
      setResult(res);
      if (res.success) {
        const applied = res.giftCard?.applied ?? res.applied ?? activeTarget;
        const meta = giftCode ? `...${giftCode.slice(-4)}` : undefined;
        if (commitTender("GIFT_CARD", applied, res.orderId, meta)) return;

        setTimeout(() => {
          onPaymentComplete?.();
          handleClose();
        }, 2000);
      }
    } catch {
      setResult({ success: false, error: "Redemption failed" });
    } finally {
      setProcessing(false);
    }
  };

  const handlePayment = async () => {
    setProcessing(true);
    try {
      // Cash field is a decimal dollar string (e.g. "18.02"). Use parseFloat
      // + rounding so cents survive; parseInt would silently drop them.
      const amount =
        selectedMethod === "CASH"
          ? Math.round(parseFloat(cashAmount || "0") * 100)
          : activeTarget;
      const res = await onPayment(selectedMethod!, amount, {
        orderId: splitOrderId || undefined,
        surchargeAmount: surchargeForOrder || undefined,
        cashDiscountAmount: cashDiscountForOrder || undefined,
        cashDiscountReason:
          cashDiscountForOrder > 0
            ? `${cashDiscountCfg.label || "Cash discount"} ${cashDiscountCfg.percent}%`
            : undefined,
        // Phase 8 QA: pass tip on the first tender only. Subsequent
        // split tenders skip it — order already has the tip stored.
        tipAmount:
          tenders.length === 0 && tipAmount > 0 ? tipAmount : undefined,
      });
      setResult(res);

      if (res.success && selectedMethod !== "ONLINE") {
        // Split mode: record this tender, keep modal open if more due.
        // Applied comes from the server (respects order-outstanding cap);
        // fall back to the requested amount when the server didn't return it
        // (e.g. legacy responses).
        const applied = res.applied ?? Math.min(amount, activeTarget);
        const meta =
          selectedMethod === "CASH" && res.change
            ? `change ${formatPrice(res.change)}`
            : undefined;
        if (commitTender(selectedMethod!, applied, res.orderId, meta)) return;

        setTimeout(() => {
          handleClose();
        }, 2000);
      }
    } catch {
      setResult({ success: false });
    } finally {
      setProcessing(false);
    }
  };

  /**
   * Browser-side terminal payment flow:
   * 1. Create order via existing onPayment (CASH path creates order)
   * 2. Use onTerminalPayment to do browser → terminal → cloud
   */
  const handleTerminalPayment = async () => {
    if (!onTerminalPayment || !selectedMethod) return;

    setProcessing(true);
    try {
      // Step 1: Create the order first (we reuse the existing payment endpoint
      // but we only need it to create the order — for card, the terminal handles payment).
      // In split mode after the first tender the order already exists, so
      // pass its id to avoid creating a second one.
      const orderRes = splitOrderId
        ? { success: true, orderId: splitOrderId, orderNumber: "" as string | undefined }
        : await onPayment("TERMINAL_INTENT", finalTotal, {
            surchargeAmount: surchargeForOrder || undefined,
          });

      if (!orderRes.success || !orderRes.orderId) {
        setResult({ success: false, error: "Failed to create order" });
        setProcessing(false);
        return;
      }

      setCurrentOrderId(orderRes.orderId);
      if (splitMode && !splitOrderId) setSplitOrderId(orderRes.orderId);

      // Step 2: Browser talks to terminal — charge the outstanding amount,
      // not the full order total.
      await onTerminalPayment({
        orderId: orderRes.orderId,
        amount: activeTarget - tipAmount,
        tipAmount: splitMode && tenders.length > 0 ? 0 : tipAmount,
        method: selectedMethod,
      });
    } catch (err) {
      console.error("Terminal payment error:", err);
    } finally {
      setProcessing(false);
    }
  };

  // Mark payment as complete manually (when PSP webhook hasn't arrived)
  const handleMarkAsPaid = async () => {
    if (!result?.orderId || !tenantId) return;

    setProcessing(true);
    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/orders/${result.orderId}/payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "ONLINE", status: "completed" }),
        }
      );

      if (response.ok) {
        setPaymentStatus("completed");
        setTimeout(() => {
          onPaymentComplete?.();
          handleClose();
        }, 2000);
      }
    } catch (error) {
      console.error("Error marking as paid:", error);
    } finally {
      setProcessing(false);
    }
  };

  const cashAmountCents = Math.round(parseFloat(cashAmount || "0") * 100);
  const change = cashAmountCents - activeTarget;

  const paymentMethods = [
    { id: "CASH", name: "Cash", icon: "solar:wallet-money-bold", color: "bg-green-500" },
    { id: "CARD", name: "Card", icon: "solar:card-bold", color: "bg-blue-500" },
    { id: "INTERAC", name: "Interac", icon: "solar:card-transfer-bold", color: "bg-amber-500" },
    { id: "ONLINE", name: "QR Code", icon: "solar:qr-code-bold", color: "bg-purple-500" },
    { id: "GIFT_CARD", name: "Gift Card", icon: "solar:gift-bold", color: "bg-pink-500" },
  ];

  const quickCashAmounts = [1000, 2000, 5000, 10000]; // $10, $20, $50, $100

  // Success Screen (for cash payments)
  if (result?.success && selectedMethod === "CASH") {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} size="md" showCloseButton={false}>
        <div className="text-center py-8">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center animate-bounce">
            <Icon icon="solar:check-circle-bold" className="w-12 h-12 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Complete!</h2>
          {result.change !== undefined && result.change > 0 && (
            <div className="mt-4 p-4 bg-amber-50 rounded-xl">
              <p className="text-sm text-amber-600 mb-1">Change Due</p>
              <p className="text-3xl font-bold text-amber-700">{formatPrice(result.change)}</p>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  // QR Code Screen
  if (selectedMethod === "ONLINE" && result?.qrCode) {
    if (paymentStatus === "completed") {
      return (
        <Modal isOpen={isOpen} onClose={handleClose} size="md" showCloseButton={false}>
          <div className="text-center py-8">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center animate-bounce">
              <Icon icon="solar:check-circle-bold" className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Complete!</h2>
            <p className="text-gray-600">Thank you for your payment</p>
          </div>
        </Modal>
      );
    }

    return (
      <Modal isOpen={isOpen} onClose={handleClose} size="lg" showCloseButton={false}>
        <div className="text-center">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Scan to Pay</h2>
            {result.orderNumber && (
              <p className="text-gray-500">Order #{result.orderNumber}</p>
            )}
          </div>

          <div className="p-6 bg-white rounded-2xl border-2 border-gray-100 inline-block mb-6 shadow-lg">
            <QRCodeSVG value={result.qrCode} size={280} level="M" />
          </div>

          <div className="mb-6">
            <p className="text-sm text-gray-500 mb-1">Amount Due</p>
            <p className="text-4xl font-bold text-gray-900">{formatPrice(finalTotal)}</p>
          </div>

          <div className="flex items-center justify-center gap-2 mb-6 text-amber-600">
            <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium">Waiting for payment...</span>
          </div>

          <p className="text-gray-500 mb-6 text-sm">
            Present this QR code to the customer. The screen will update automatically when payment is received.
          </p>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={handleClose} fullWidth>
              Cancel
            </Button>
            <Button
              onClick={handleMarkAsPaid}
              loading={processing}
              fullWidth
              className="bg-green-600 hover:bg-green-700"
            >
              <Icon icon="solar:check-circle-bold" className="w-5 h-5 mr-2" />
              Mark as Paid
            </Button>
          </div>

          <p className="text-xs text-gray-400 mt-4">
            Use &quot;Mark as Paid&quot; if customer paid externally or PSP confirmation is delayed
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="xl"
      title="Payment"
      subtitle={
        splitMode && tenders.length > 0
          ? `Total ${formatPrice(finalTotal)} · Paid ${formatPrice(alreadyTendered)} · Due ${formatPrice(remainingDue)}`
          : `Total: ${formatPrice(finalTotal)}`
      }
    >
      <div className="space-y-6">
        {/* Split tender history — only visible in split mode with progress */}
        {splitMode && tenders.length > 0 && (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Icon
                  icon="solar:layers-minimalistic-bold"
                  className="w-4 h-4 text-indigo-600"
                />
                <span className="text-sm font-semibold text-indigo-900">
                  Split Payment ({tenders.length} tender{tenders.length > 1 ? "s" : ""})
                </span>
              </div>
              <span className="text-sm font-semibold text-indigo-900">
                {formatPrice(alreadyTendered)} / {formatPrice(finalTotal)}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 bg-white rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{
                  width: `${Math.min(100, (alreadyTendered / finalTotal) * 100)}%`,
                }}
              />
            </div>
            <div className="space-y-1">
              {tenders.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between text-xs text-indigo-900"
                >
                  <span className="flex items-center gap-1.5">
                    <Icon
                      icon={
                        t.method === "CASH"
                          ? "solar:wallet-money-linear"
                          : t.method === "GIFT_CARD"
                            ? "solar:gift-linear"
                            : t.method === "INTERAC"
                              ? "solar:card-transfer-linear"
                              : "solar:card-linear"
                      }
                      className="w-3.5 h-3.5"
                    />
                    <span className="font-medium">
                      {t.method === "GIFT_CARD" ? "Gift Card" : t.method.charAt(0) + t.method.slice(1).toLowerCase()}
                    </span>
                    {t.meta && <span className="text-indigo-600/70">· {t.meta}</span>}
                  </span>
                  <span className="font-semibold">{formatPrice(t.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tip picker is NO LONGER shown on the method-picker step.
            Rationale (Phase 8 QA): electronic tenders capture tip on the
            device the customer is looking at — the terminal (Card/Interac)
            or their phone (QR checkout page). A POS-side tip picker for
            those would double-tip or silently override.
            Cash is the only path where the customer doesn't see the
            screen, so its own tender screen renders the tip UI (see the
            "Cash Payment" block below). */}

        {/* Dual-pricing hint — visible on the method picker when cash
            discount is enabled so the operator sees both prices before
            selecting. The prices below the method tiles change to match
            what's chosen. */}
        {!selectedMethod && cashDiscountCfg.enabled && dualTotals.cashDelta > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 mb-2 text-amber-800">
              <Icon icon="solar:tag-price-bold" className="w-4 h-4" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                {cashDiscountCfg.label ||
                  (cashDiscountCfg.mode === "DISCOUNT"
                    ? "Cash Discount"
                    : "Card Fee")}{" "}
                · {cashDiscountCfg.percent}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-2 rounded-lg bg-white border border-amber-100">
                <p className="text-xs text-gray-500">Cash / Debit</p>
                <p className="text-lg font-bold text-green-700">
                  {formatPrice(dualTotals.cashTotal)}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-white border border-amber-100">
                <p className="text-xs text-gray-500">Card</p>
                <p className="text-lg font-bold text-gray-900">
                  {formatPrice(dualTotals.cardTotal)}
                </p>
                {cashDiscountCfg.mode === "SURCHARGE" && (
                  <p className="text-[10px] text-gray-500">
                    incl. {formatPrice(dualTotals.surchargeApplied)} fee
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Payment Method Selection */}
        {!selectedMethod && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-gray-900">
                {splitMode && tenders.length > 0 ? "Next Tender" : "Payment Method"}
              </h4>
              {/* Split toggle — only shown before any tender is committed.
                  Once split has started, mid-payment toggling would be confusing. */}
              {tenders.length === 0 && (
                <div className="flex items-center gap-1.5">
                  {/* Split the BILL across guests (dine-in) — one order,
                      N guests, each pays their share separately. Different
                      from Split Payment (one bill, multiple tenders). */}
                  {onSplitBill && (
                    <button
                      onClick={onSplitBill}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
                      title="Split the bill across multiple guests"
                    >
                      <Icon icon="solar:users-group-rounded-bold" className="w-3.5 h-3.5" />
                      Split Bill
                    </button>
                  )}
                  <button
                    onClick={() => setSplitMode((s) => !s)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                      splitMode
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                    title="Pay with multiple methods on one order"
                  >
                    <Icon icon="solar:layers-minimalistic-bold" className="w-3.5 h-3.5" />
                    {splitMode ? "Split ON" : "Split Payment"}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {paymentMethods.map((method) => (
                <button
                  key={method.id}
                  onClick={() => setSelectedMethod(method.id)}
                  className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-200 hover:border-teal-500 hover:bg-teal-50 transition-all relative"
                >
                  <div className={`w-12 h-12 rounded-xl ${method.color} flex items-center justify-center text-white`}>
                    <Icon icon={method.icon} className="w-6 h-6" />
                  </div>
                  <span className="font-semibold text-gray-900">{method.name}</span>
                  {/* Show terminal connected badge for Card/Interac */}
                  {(method.id === "CARD" || method.id === "INTERAC") && terminalConnected && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 bg-green-50 rounded-full">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-[10px] font-medium text-green-700">
                        {terminalName || "Terminal"}
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
            {splitMode && tenders.length > 0 && (
              <button
                onClick={() => {
                  // Bail out of split mode — user can pay the rest another
                  // way. Tenders already committed stay on the order.
                  setSplitMode(false);
                  handleClose();
                }}
                className="mt-3 w-full text-xs text-gray-500 hover:text-gray-700 py-2"
              >
                Save & close (finish payment later)
              </button>
            )}
          </div>
        )}

        {/* Cash Payment */}
        {selectedMethod === "CASH" && (
          <div className="space-y-4">
            <button
              onClick={() => {
                // Clear tip when leaving Cash — the picker only lives on
                // Cash/QR, so a stale tip must not follow the operator
                // to Card/Interac (would silently add to the terminal
                // charge).
                setTipPercent(null);
                setTipCustomCents(null);
                setSelectedMethod(null);
              }}
              className="flex items-center gap-2 text-gray-500 hover:text-gray-700"
            >
              <Icon icon="solar:arrow-left-linear" className="w-5 h-5" />
              Back
            </button>

            {/* Tip picker — Cash-only in Phase 8 QA. Card/Interac use the
                terminal prompt; QR uses the customer's phone. First tender
                only (subsequent split tenders inherit the tip from the
                first). */}
            {tenders.length === 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-2 text-sm">
                  Add Tip{" "}
                  <span className="text-xs font-normal text-gray-400">
                    (optional — for cash tip left by customer)
                  </span>
                </h4>
                <div className="flex gap-2">
                  {[0, 15, 18, 20, 25].map((percent) => {
                    const isSelected =
                      tipCustomCents === null &&
                      ((percent === 0 && tipPercent === null) ||
                        tipPercent === percent);
                    return (
                      <button
                        key={percent}
                        onClick={() => {
                          setTipCustomCents(null);
                          setTipPercent(percent === 0 ? null : percent);
                        }}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isSelected
                            ? "text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                        style={
                          isSelected
                            ? { backgroundColor: brandColor || "#0D9488" }
                            : undefined
                        }
                      >
                        {percent === 0 ? "No Tip" : `${percent}%`}
                      </button>
                    );
                  })}
                </div>
                {tipAmount > 0 && (
                  <p
                    className="text-xs mt-2 text-center"
                    style={{ color: brandColor || "#0D9488" }}
                  >
                    Tip: {formatPrice(tipAmount)} &bull; Total: {formatPrice(finalTotal)}
                  </p>
                )}
              </div>
            )}

            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <p className="text-sm text-gray-500">
                {splitMode && tenders.length > 0 ? "Remaining" : "Amount Due"}
              </p>
              <p className="text-3xl font-bold text-gray-900">{formatPrice(activeTarget)}</p>
            </div>

            <div className="text-center p-4 bg-teal-50 rounded-xl">
              <p className="text-sm text-teal-600">Cash Received</p>
              <p className="text-4xl font-bold text-teal-700">
                {cashAmount ? formatPrice(Math.round(parseFloat(cashAmount) * 100)) : "$0.00"}
              </p>
            </div>

            {cashAmountCents >= activeTarget && change > 0 && (
              <div className="p-4 bg-amber-50 rounded-xl">
                <div className="text-center">
                  <p className="text-sm text-amber-600">Change</p>
                  <p className="text-3xl font-bold text-amber-700">{formatPrice(change)}</p>
                </div>
                {/* "Keep the change" — one tap to convert change into tip.
                    Only shown on the first tender (split-tenders share the
                    first tender's tip so the total stays consistent). */}
                {tenders.length === 0 && (
                  <button
                    onClick={() => {
                      // Freeze the current change as tip by setting tipCustomCents.
                      // That bumps activeTarget by the same amount, making
                      // change collapse to zero on the next render.
                      setTipPercent(null);
                      setTipCustomCents(tipAmount + change);
                    }}
                    className="w-full mt-3 py-2 rounded-lg bg-white border border-amber-300 text-amber-800 text-sm font-medium hover:bg-amber-100"
                  >
                    Record {formatPrice(change)} as tip ("keep the change")
                  </button>
                )}
              </div>
            )}
            {cashAmountCents >= activeTarget && change === 0 && tipCustomCents !== null && tipCustomCents > 0 && (
              <p className="text-xs text-center text-emerald-700">
                {formatPrice(tipCustomCents)} recorded as tip.{" "}
                <button
                  onClick={() => setTipCustomCents(null)}
                  className="underline hover:no-underline"
                >
                  Undo
                </button>
              </p>
            )}

            <QuickAmountButtons
              amounts={quickCashAmounts}
              onSelect={(amount) => setCashAmount(String(amount / 100))}
              currency={currency}
            />

            <NumPad
              value={cashAmount}
              onChange={setCashAmount}
              showDecimal={true}
            />

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setCashAmount((activeTarget / 100).toFixed(2))}
                fullWidth
              >
                Exact
              </Button>
              <Button
                onClick={handlePayment}
                disabled={cashAmountCents < activeTarget}
                loading={processing}
                fullWidth
              >
                {splitMode ? "Apply Cash" : "Complete Payment"}
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* Card/Interac Payment — Browser-Side Terminal Flow         */}
        {/* ═══════════════════════════════════════════════════════════ */}
        {(selectedMethod === "CARD" || selectedMethod === "INTERAC") && (
          <div className="space-y-4">
            {/* ── Idle: Ready to send ── */}
            {(activeTerminalState === "idle" && !processing) && (
              <>
                <button
                  onClick={() => {
                    setSelectedMethod(null);
                    onResetTerminal?.();
                  }}
                  className="flex items-center gap-2 text-gray-500 hover:text-gray-700"
                >
                  <Icon icon="solar:arrow-left-linear" className="w-5 h-5" />
                  Back
                </button>

                <div className="text-center py-6">
                  <p className="text-3xl font-bold text-gray-900 mb-4">{formatPrice(activeTarget)}</p>
                  {tipAmount > 0 && tenders.length === 0 && (
                    <p className="text-sm text-teal-600 mb-2">
                      Includes {formatPrice(tipAmount)} tip
                    </p>
                  )}
                  {splitMode && tenders.length > 0 && (
                    <p className="text-xs text-indigo-600 mb-2">
                      Remaining balance on order
                    </p>
                  )}
                  <p className="text-gray-500 mb-6">
                    Ready to process {selectedMethod === "CARD" ? "card" : "Interac"} payment
                    {terminalConnected && terminalName ? ` via ${terminalName}` : " via terminal"}
                  </p>

                  {/* Terminal status indicator */}
                  {terminalConnected ? (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-full mb-4">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm font-medium text-green-700">
                        {terminalName || "Terminal"} connected
                      </span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-full mb-4">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-sm font-medium text-red-700">
                        No terminal connected
                      </span>
                    </div>
                  )}
                </div>

                {useBrowserTerminal ? (
                  <Button
                    onClick={handleTerminalPayment}
                    loading={processing}
                    fullWidth
                    size="lg"
                  >
                    <Icon icon="solar:card-send-bold" className="w-5 h-5 mr-2" />
                    Send to Terminal
                  </Button>
                ) : (
                  <Button
                    onClick={async () => {
                      setProcessing(true);
                      try {
                        const res = await onPayment(selectedMethod!, activeTarget, {
                          orderId: splitOrderId || undefined,
                          surchargeAmount: surchargeForOrder || undefined,
                        });
                        setResult(res);
                        if (res.success) {
                          const applied = res.applied ?? activeTarget;
                          const meta = res.cardDetails?.maskedPan
                            ? `...${res.cardDetails.maskedPan.slice(-4)}`
                            : undefined;
                          if (commitTender(selectedMethod!, applied, res.orderId, meta)) return;
                          onPaymentComplete?.();
                          setTimeout(handleClose, 2000);
                        }
                      } catch {
                        setResult({ success: false, error: "Connection failed" });
                      } finally {
                        setProcessing(false);
                      }
                    }}
                    loading={processing}
                    fullWidth
                    size="lg"
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    <Icon icon="solar:card-send-bold" className="w-5 h-5 mr-2" />
                    Process via Server
                  </Button>
                )}
              </>
            )}

            {/* ── Creating Intent ── */}
            {activeTerminalState === "creating_intent" && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-indigo-50 flex items-center justify-center">
                  <Icon icon="solar:refresh-bold" className="w-10 h-10 text-indigo-500 animate-spin" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Preparing Payment...</h3>
                <p className="text-gray-500 text-sm">Creating secure payment intent</p>
              </div>
            )}

            {/* ── Sending to Terminal / Waiting for Card ── */}
            {(activeTerminalState === "sending_to_terminal" || activeTerminalState === "waiting_for_card") && (
              <div className="text-center py-8">
                <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-blue-50 flex items-center justify-center">
                  <div className="relative">
                    <Icon icon="solar:smartphone-bold" className="w-12 h-12 text-blue-500" />
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full animate-ping" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">
                  Present Card on Terminal
                </h3>
                <p className="text-gray-500 mb-2">
                  Tap, insert, or swipe card on the payment terminal
                </p>
                <p className="text-sm text-gray-400 mb-2">
                  Apple Pay and Google Pay accepted via tap
                </p>
                <p className="text-3xl font-bold text-gray-900 mt-4">{formatPrice(activeTarget)}</p>

                <div className="flex justify-center gap-4 mt-6 text-gray-400">
                  <Icon icon="solar:card-bold" className="w-8 h-8" title="Chip" />
                  <Icon icon="solar:smartphone-bold" className="w-8 h-8" title="NFC Tap" />
                  <Icon icon="solar:card-transfer-bold" className="w-8 h-8" title="Swipe" />
                </div>

                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (onTerminalCancel) {
                      await onTerminalCancel();
                    }
                  }}
                  className="mt-6"
                >
                  Cancel Transaction
                </Button>
              </div>
            )}

            {/* ── Processing Result ── */}
            {activeTerminalState === "processing_result" && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-indigo-50 flex items-center justify-center">
                  <Icon icon="solar:refresh-bold" className="w-10 h-10 text-indigo-500 animate-spin" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">Processing...</h3>
                <p className="text-gray-500 text-sm">Verifying transaction with server</p>
              </div>
            )}

            {/* ── Approved ── */}
            {activeTerminalState === "approved" && terminalResult && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center animate-bounce">
                  <Icon icon="solar:check-circle-bold" className="w-12 h-12 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Approved</h2>

                {/* Card details */}
                <div className="inline-flex items-center gap-3 px-6 py-3 bg-gray-50 rounded-xl">
                  <div className="text-left">
                    <p className="text-sm text-gray-500">{terminalResult.cardType || "Card"}</p>
                    <p className="font-mono font-semibold text-gray-900">
                      **** {terminalResult.maskedPan?.slice(-4) || "****"}
                    </p>
                  </div>
                  <div className="text-left border-l border-gray-200 pl-3">
                    <p className="text-sm text-gray-500">
                      {terminalResult.entryMode === "NFC" || terminalResult.entryMode === "Contactless"
                        ? "Contactless"
                        : terminalResult.entryMode === "Chip"
                          ? "Chip"
                          : terminalResult.entryMode === "Swipe"
                            ? "Swipe"
                            : terminalResult.entryMode || "Card"}
                    </p>
                    <p className="font-mono text-sm text-gray-700">
                      Auth: {terminalResult.authCode || "—"}
                    </p>
                  </div>
                </div>

                <p className="text-2xl font-bold text-green-700 mt-4">{formatPrice(activeTarget)}</p>
              </div>
            )}

            {/* ── Declined ── */}
            {activeTerminalState === "declined" && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
                  <Icon icon="solar:close-circle-bold" className="w-12 h-12 text-red-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Declined</h2>
                <p className="text-gray-500 mb-6">
                  {terminalResult?.errorMessage || "Transaction was declined by the card issuer"}
                </p>
                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      onResetTerminal?.();
                      setCurrentOrderId(null);
                    }}
                    fullWidth
                  >
                    Try Again
                  </Button>
                  <Button variant="secondary" onClick={handleClose} fullWidth>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* ── Timeout ── */}
            {activeTerminalState === "timeout" && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
                  <Icon icon="solar:clock-circle-bold" className="w-12 h-12 text-amber-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Transaction Timed Out</h2>
                <p className="text-gray-500 mb-6">
                  Check the terminal — the payment may have been processed.
                </p>
                <div className="flex gap-3">
                  <Button
                    onClick={async () => {
                      if (onTerminalRecover && currentOrderId) {
                        setProcessing(true);
                        await onTerminalRecover(currentOrderId);
                        setProcessing(false);
                      }
                    }}
                    loading={processing}
                    fullWidth
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    <Icon icon="solar:refresh-bold" className="w-5 h-5 mr-2" />
                    Check Last Transaction
                  </Button>
                  <Button variant="secondary" onClick={handleClose} fullWidth>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* ── Unreachable ── */}
            {activeTerminalState === "unreachable" && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
                  <Icon icon="solar:wifi-router-bold" className="w-12 h-12 text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Terminal Unreachable</h2>
                <p className="text-gray-500 mb-2">
                  Cannot connect to the payment terminal.
                </p>
                <p className="text-sm text-gray-400 mb-6">
                  Make sure the terminal is powered on and connected to the same WiFi network as this device.
                </p>
                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      onResetTerminal?.();
                      setCurrentOrderId(null);
                    }}
                    fullWidth
                  >
                    Try Again
                  </Button>
                  <Button variant="secondary" onClick={handleClose} fullWidth>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* ── Error / Cancelled ── */}
            {(activeTerminalState === "error" || activeTerminalState === "cancelled") && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-100 flex items-center justify-center">
                  <Icon
                    icon={activeTerminalState === "cancelled" ? "solar:close-circle-bold" : "solar:danger-triangle-bold"}
                    className={`w-12 h-12 ${activeTerminalState === "cancelled" ? "text-gray-500" : "text-red-500"}`}
                  />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  {activeTerminalState === "cancelled" ? "Cancelled" : "Terminal Error"}
                </h2>
                <p className="text-gray-500 mb-6">
                  {activeTerminalState === "cancelled"
                    ? "Transaction was cancelled"
                    : terminalResult?.errorMessage || "Failed to communicate with payment terminal"}
                </p>
                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      onResetTerminal?.();
                      setCurrentOrderId(null);
                    }}
                    fullWidth
                  >
                    Try Again
                  </Button>
                  <Button variant="secondary" onClick={handleClose} fullWidth>
                    Close
                  </Button>
                </div>
              </div>
            )}

            {/* ── Fallback: Server-side result (no browser terminal) ── */}
            {!useBrowserTerminal && result?.success && result.cardDetails && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center animate-bounce">
                  <Icon icon="solar:check-circle-bold" className="w-12 h-12 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Approved</h2>
                <div className="inline-flex items-center gap-3 px-6 py-3 bg-gray-50 rounded-xl">
                  <div className="text-left">
                    <p className="text-sm text-gray-500">{result.cardDetails.cardType}</p>
                    <p className="font-mono font-semibold text-gray-900">
                      **** {result.cardDetails.maskedPan?.slice(-4) || "****"}
                    </p>
                  </div>
                  <div className="text-left border-l border-gray-200 pl-3">
                    <p className="text-sm text-gray-500">{result.cardDetails.entryMode || "Card"}</p>
                    <p className="font-mono text-sm text-gray-700">
                      Auth: {result.cardDetails.authCode}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!useBrowserTerminal && result && !result.success && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
                  <Icon icon="solar:close-circle-bold" className="w-12 h-12 text-red-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Failed</h2>
                <p className="text-gray-500 mb-6">{result.error || "Transaction failed"}</p>
                <div className="flex gap-3">
                  <Button onClick={() => { setResult(null); }} fullWidth>Try Again</Button>
                  <Button variant="secondary" onClick={handleClose} fullWidth>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Gift Card Payment */}
        {selectedMethod === "GIFT_CARD" && !result?.success && (
          <div className="space-y-4">
            <button
              onClick={() => {
                setSelectedMethod(null);
                setGiftCode("");
                setGiftBalance(null);
              }}
              className="flex items-center gap-2 text-gray-500 hover:text-gray-700"
            >
              <Icon icon="solar:arrow-left-linear" className="w-5 h-5" />
              Back
            </button>

            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <p className="text-sm text-gray-500">
                {splitMode && tenders.length > 0 ? "Remaining" : "Amount Due"}
              </p>
              <p className="text-3xl font-bold text-gray-900">{formatPrice(activeTarget)}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gift Card Code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={giftCode}
                  onChange={(e) => {
                    setGiftCode(e.target.value.toUpperCase());
                    setGiftBalance(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && checkGiftCard()}
                  placeholder="GC-XXXX-XXXX-XXXX"
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-100 outline-none font-mono text-center tracking-wider"
                  autoFocus
                />
                <Button
                  variant="secondary"
                  onClick={checkGiftCard}
                  loading={checkingGift}
                  disabled={!giftCode.trim()}
                >
                  Check
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Hyphens optional. Not case-sensitive.
              </p>
            </div>

            {giftBalance && (
              <div
                className={`p-4 rounded-xl border ${
                  giftBalance.redeemable
                    ? "bg-pink-50 border-pink-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                {giftBalance.error ? (
                  <p className="text-sm text-red-700 flex items-start gap-2">
                    <Icon
                      icon="solar:danger-triangle-bold"
                      className="w-5 h-5 flex-shrink-0"
                    />
                    <span>{giftBalance.error}</span>
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-gray-600">Card Balance</p>
                      <p className="text-xl font-bold text-gray-900">
                        {formatPrice(giftBalance.balance)}
                      </p>
                    </div>
                    {giftBalance.balance >= activeTarget ? (
                      <p className="text-sm text-green-700 flex items-center gap-2">
                        <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
                        Covers {splitMode && tenders.length > 0 ? "remaining balance" : "full order"}. Card will keep{" "}
                        {formatPrice(giftBalance.balance - activeTarget)} after payment.
                      </p>
                    ) : (
                      <div className="text-sm text-amber-700">
                        <p className="flex items-center gap-2">
                          <Icon
                            icon="solar:info-circle-bold"
                            className="w-4 h-4"
                          />
                          Partial: card covers{" "}
                          <span className="font-semibold">
                            {formatPrice(giftBalance.balance)}
                          </span>
                          .{" "}
                          <span className="font-semibold">
                            {formatPrice(activeTarget - giftBalance.balance)}
                          </span>{" "}
                          {splitMode ? "still due after this tender." : "remains due."}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {splitMode
                            ? "Add another tender for the remainder."
                            : "After applying, use another payment method for the remainder."}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <Button
              onClick={handleGiftCardPayment}
              disabled={!giftBalance?.redeemable}
              loading={processing}
              fullWidth
              size="lg"
              className="bg-pink-600 hover:bg-pink-700"
            >
              <Icon icon="solar:gift-bold" className="w-5 h-5 mr-2" />
              Redeem {giftBalance && giftBalance.balance < activeTarget
                ? formatPrice(giftBalance.balance)
                : formatPrice(activeTarget)}
            </Button>

            {result && !result.success && (
              <p className="text-sm text-red-600 text-center">
                {result.error || "Redemption failed"}
              </p>
            )}
          </div>
        )}

        {/* Gift Card success */}
        {selectedMethod === "GIFT_CARD" && result?.success && result.giftCard && (
          <div className="text-center py-6">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center animate-bounce">
              <Icon icon="solar:check-circle-bold" className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {result.giftCard.remainingOnOrder === 0
                ? "Payment Complete!"
                : "Partial Payment Applied"}
            </h2>
            <div className="inline-block p-4 bg-pink-50 rounded-xl">
              <p className="text-xs text-pink-600 uppercase mb-1">Applied</p>
              <p className="text-3xl font-bold text-pink-700">
                {formatPrice(result.giftCard.applied)}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-xl bg-gray-50">
                <p className="text-xs text-gray-500">Card Remaining</p>
                <p className="font-semibold text-gray-900">
                  {formatPrice(result.giftCard.remainingOnCard)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-gray-50">
                <p className="text-xs text-gray-500">Order Remaining</p>
                <p className="font-semibold text-gray-900">
                  {formatPrice(result.giftCard.remainingOnOrder)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Online/QR Payment - Generate QR */}
        {selectedMethod === "ONLINE" && !result?.qrCode && (
          <div className="space-y-4">
            <button
              onClick={() => {
                // Clear tip when leaving QR — same reason as Cash back.
                setTipPercent(null);
                setTipCustomCents(null);
                setSelectedMethod(null);
              }}
              className="flex items-center gap-2 text-gray-500 hover:text-gray-700"
            >
              <Icon icon="solar:arrow-left-linear" className="w-5 h-5" />
              Back
            </button>

            {/* Tip picker — QR flow. When staff sets a tip here it bakes
                into the QR total, so the customer's pay page suppresses
                its own tip picker (see /table/[qrCode]/pay/[orderId]) to
                avoid double-tipping. First tender only. */}
            {tenders.length === 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-2 text-sm">
                  Add Tip{" "}
                  <span className="text-xs font-normal text-gray-400">
                    (skip to let the customer pick on their phone)
                  </span>
                </h4>
                <div className="flex gap-2">
                  {[0, 15, 18, 20, 25].map((percent) => {
                    const isSelected =
                      tipCustomCents === null &&
                      ((percent === 0 && tipPercent === null) ||
                        tipPercent === percent);
                    return (
                      <button
                        key={percent}
                        onClick={() => {
                          setTipCustomCents(null);
                          setTipPercent(percent === 0 ? null : percent);
                        }}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isSelected
                            ? "text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                        style={
                          isSelected
                            ? { backgroundColor: brandColor || "#0D9488" }
                            : undefined
                        }
                      >
                        {percent === 0 ? "No Tip" : `${percent}%`}
                      </button>
                    );
                  })}
                </div>
                {tipAmount > 0 && (
                  <p
                    className="text-xs mt-2 text-center"
                    style={{ color: brandColor || "#0D9488" }}
                  >
                    Tip: {formatPrice(tipAmount)} &bull; Total: {formatPrice(finalTotal)}
                  </p>
                )}
              </div>
            )}

            <div className="text-center py-6">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-purple-100 flex items-center justify-center">
                <Icon icon="solar:qr-code-bold" className="w-10 h-10 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                QR Code Payment
              </h3>
              <p className="text-gray-500 mb-4">
                Generate a QR code for the customer to scan and pay
              </p>
              <p className="text-3xl font-bold text-gray-900">{formatPrice(activeTarget)}</p>
              {tipAmount > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Includes {formatPrice(tipAmount)} tip
                </p>
              )}
            </div>

            <Button onClick={handlePayment} loading={processing} fullWidth size="lg">
              <Icon icon="solar:qr-code-bold" className="w-5 h-5 mr-2" />
              Generate QR Code
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
