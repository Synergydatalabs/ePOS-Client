// ============================================
// useTerminal — real implementation (2026-05-27).
//
// Previously a deprecated stub that always returned isOnline: false, which
// is why the POS PaymentModal showed "No terminal connected" forever.
//
// Now actually does:
//   - Fetches /api/tenants/[tenantId]/terminals to find a UCI terminal
//   - isOnline = true when at least one UCI terminal is registered for the
//     current location (we trust that PING worked at admin/terminals; we
//     don't re-PING on every modal open to avoid hammering GP)
//   - processPayment(): POSTs to /api/tenants/[tenantId]/payments/uci/bill
//     to push a bill to the active terminal, then resolves when the customer
//     completes (or fails) the payment. Uses polling to track bill status.
//   - cancelTransaction(): DELETEs the bill on the terminal
//
// The PaymentModal in /dashboard/pos/page.tsx consumes this hook unchanged.
// ============================================

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface TerminalInfo {
  id: string;
  name: string;
  provider: "UCI" | "UPA";
  uciLane?: string | null;
  uciEnvironment?: "CERT" | "PROD" | null;
  isDefault: boolean;
  status: string;
  locationId: string;
}

// 2026-05-28: these state names MUST match the render blocks in
// PaymentModal.tsx (it imports this type and switches on these exact
// strings). When I rewrote the hook I briefly used shorter names
// ("sending"/"waiting"/"completed") which had NO matching render block in
// PaymentModal → the modal showed an empty body. Keep these aligned.
export type TerminalPaymentState =
  | "idle"
  | "creating_intent"        // preparing the bill
  | "sending_to_terminal"    // POST to /uci/bill in flight
  | "waiting_for_card"       // bill on terminal, waiting for customer to tap
  | "processing_result"      // payment captured, finalizing
  | "approved"               // payment succeeded
  | "declined"               // card declined
  | "timeout"                // no response in time
  | "unreachable"            // terminal offline / not reachable
  | "error"                  // generic failure
  | "cancelled";             // staff or customer cancelled

export interface TerminalPaymentResult {
  success: boolean;
  billId?: string;
  amount?: number;
  cardBrand?: string;
  cardLast4?: string;
  authCode?: string;
  error?: string;
  // 2026-05-28: PaymentModal.tsx renders these extra fields on the
  // approved/declined screens. Kept optional so the hook can populate
  // whichever the webhook provides.
  cardType?: string;          // e.g. "VISA" / "MASTERCARD" (alias of cardBrand)
  maskedPan?: string;         // e.g. "************2074"
  entryMode?: string;         // "CHIP" | "CONTACTLESS" | "SWIPE"
  errorMessage?: string;      // human-readable decline/error reason (alias of error)
}

// Signatures here MUST match what PaymentModal expects for its
// `onTerminalPayment`, `onTerminalCancel`, `onTerminalRecover` props
// (see src/components/pos/PaymentModal.tsx around line 39). Don't change
// these without updating PaymentModal in lockstep.
interface UseTerminalReturn {
  terminal: TerminalInfo | null;
  isOnline: boolean;
  paymentState: TerminalPaymentState;
  lastResult: TerminalPaymentResult | null;
  processPayment: (params: {
    orderId: string;
    amount: number;
    tipAmount: number;
    method: string;
    // Optional per-line override so the cart can drive seat assignment
    // when building a restaurant check from the POS. When omitted the
    // server falls back to mapping the saved Order's items (single seat).
    lineItemsOverride?: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      seat?: number;
    }>;
  }) => Promise<TerminalPaymentResult>;
  cancelTransaction: () => Promise<boolean>;
  recoverLastTransaction: (orderId: string) => Promise<TerminalPaymentResult>;
  resetPaymentState: () => void;
}

export function useTerminal(tenantId: string | null): UseTerminalReturn {
  const [terminal, setTerminal] = useState<TerminalInfo | null>(null);
  const [paymentState, setPaymentState] = useState<TerminalPaymentState>("idle");
  const [lastResult, setLastResult] = useState<TerminalPaymentResult | null>(null);

  // billId of the bill currently being polled — kept in a ref so the
  // polling effect can read it without re-subscribing on every change.
  const activeBillIdRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ----------------------------------------------------------------
  // Load terminals on mount / tenant change
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!tenantId) {
      setTerminal(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenants/${tenantId}/terminals`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        const all: TerminalInfo[] = data.terminals || [];
        const uci = all.filter((t) => t.provider === "UCI" && t.uciLane);
        if (uci.length === 0) {
          setTerminal(null);
          return;
        }
        // Pick default, else first
        const active =
          uci.find((t) => t.isDefault) || uci[0];
        setTerminal(active);
      } catch {
        // Silent — if terminals can't load, isOnline stays false and POS
        // shows "No terminal connected" which is the safe fallback.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // ----------------------------------------------------------------
  // Bill status polling — runs while waiting for the customer to tap card
  // ----------------------------------------------------------------
  useEffect(() => {
    if (paymentState !== "waiting_for_card" || !activeBillIdRef.current || !tenantId) {
      return;
    }

    const poll = async () => {
      const billId = activeBillIdRef.current;
      if (!billId) return;
      try {
        const res = await fetch(
          `/api/tenants/${tenantId}/payments/uci/bill/${billId}`
        );
        const data = await res.json();
        if (!data?.bill) return;

        const s = String(data.bill.status || "").toUpperCase();
        if (s === "PAID" || s === "COMPLETED") {
          const result: TerminalPaymentResult = {
            success: true,
            billId,
            amount: data.bill.amount,
            cardBrand: data.bill.cardBrand,
            cardLast4: data.bill.cardLast4,
            authCode: data.bill.authCode,
          };
          setLastResult(result);
          setPaymentState("approved");
          activeBillIdRef.current = null;
        } else if (s === "CANCELLED" || s === "FAILED" || s === "EXPIRED") {
          const result: TerminalPaymentResult = {
            success: false,
            billId,
            error:
              s === "CANCELLED"
                ? "Payment cancelled on terminal"
                : s === "FAILED"
                ? "Payment failed on terminal"
                : "Payment timed out",
          };
          setLastResult(result);
          // Map GP status → the PaymentModal render state
          setPaymentState(
            s === "CANCELLED" ? "cancelled" : s === "EXPIRED" ? "timeout" : "declined"
          );
          activeBillIdRef.current = null;
        }
        // Other statuses (SENT, DELIVERED) → keep polling
      } catch {
        // Network blip — just try again next tick
      }
    };

    // Initial poll immediately, then every 3s
    poll();
    pollIntervalRef.current = setInterval(poll, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [paymentState, tenantId]);

  // ----------------------------------------------------------------
  // processPayment — POST a new bill to the terminal.
  // Signature matches PaymentModal's onTerminalPayment prop:
  //   ({ orderId, amount, tipAmount, method }) => Promise<TerminalPaymentResult>
  // ----------------------------------------------------------------
  const processPayment = useCallback(
    async (params: {
      orderId: string;
      amount: number;
      tipAmount: number;
      method: string;
      lineItemsOverride?: Array<{
        name: string;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
        seat?: number;
      }>;
    }): Promise<TerminalPaymentResult> => {
      if (!tenantId || !terminal) {
        const result: TerminalPaymentResult = {
          success: false,
          error: "No terminal connected",
        };
        setLastResult(result);
        return result;
      }

      setPaymentState("sending_to_terminal");
      setLastResult(null);
      try {
        // Provider-agnostic dispatcher — server picks GP / Moneris /
        // future based on the tenant's active provider. Response shape
        // passes through from the underlying provider route.
        const res = await fetch(
          `/api/tenants/${tenantId}/payments/charge`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              terminalId: terminal.id,
              orderId: params.orderId || undefined,
              amount: params.amount,
              tipEnabled: true,
              allowSplit: true,
              allowCash: true,
              // Only include override when the caller supplied one — empty
              // array still triggers the override path on the server.
              ...(params.lineItemsOverride && params.lineItemsOverride.length > 0 && {
                lineItemsOverride: params.lineItemsOverride,
              }),
            }),
          }
        );
        const data = await res.json();
        if (!res.ok || !data?.bill) {
          const result: TerminalPaymentResult = {
            success: false,
            error: data?.error || "Failed to send bill to terminal",
          };
          setLastResult(result);
          // 502 / downstream → terminal likely unreachable; everything else → error
          setPaymentState(res.status === 502 ? "unreachable" : "error");
          return result;
        }

        // Moneris returns the FINAL state in the initial response (the
        // provider client already waited for the terminal). No polling.
        // Jump straight to the outcome so the modal shows approved /
        // declined immediately.
        if (data.provider === "MONERIS" && data.moneris) {
          const m = data.moneris;
          if (m.approved) {
            const result: TerminalPaymentResult = {
              success: true,
              billId: data.bill.id,
              amount: data.bill.amount,
              cardBrand: m.cardType,
              cardLast4: m.panLast4,
              authCode: m.authCode,
            };
            setLastResult(result);
            setPaymentState("approved");
            return result;
          }
          const result: TerminalPaymentResult = {
            success: false,
            billId: data.bill.id,
            error: m.message || (m.timedOut ? "Payment timed out" : "Payment declined"),
          };
          setLastResult(result);
          setPaymentState(m.timedOut ? "timeout" : "declined");
          return result;
        }

        // GP path — bill lives on terminal, POS polls /uci/bill/[id] for
        // status until the async webhook flips it to PAID / DECLINED.
        // Resolve OPTIMISTICALLY here with success=true so PaymentModal
        // shows the "waiting for customer" view.
        activeBillIdRef.current = data.bill.id;
        setPaymentState("waiting_for_card");
        return {
          success: true,
          billId: data.bill.id,
          amount: data.bill.amount,
        };
      } catch (err: any) {
        const result: TerminalPaymentResult = {
          success: false,
          error: err?.message || "Connection failed",
        };
        setLastResult(result);
        setPaymentState("error");
        return result;
      }
    },
    [tenantId, terminal]
  );

  // ----------------------------------------------------------------
  // cancelTransaction — DELETE the active bill.
  // Returns true if cancel succeeded, false otherwise.
  // ----------------------------------------------------------------
  const cancelTransaction = useCallback(async (): Promise<boolean> => {
    if (!tenantId || !activeBillIdRef.current) return false;
    const billId = activeBillIdRef.current;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/payments/uci/bill/${billId}`,
        { method: "DELETE" }
      );
      activeBillIdRef.current = null;
      setPaymentState("cancelled");
      return res.ok;
    } catch {
      activeBillIdRef.current = null;
      setPaymentState("cancelled");
      return false;
    }
  }, [tenantId]);

  const recoverLastTransaction = useCallback(
    async (_orderId: string): Promise<TerminalPaymentResult> => {
      // No-op for UCI — there is no "last transaction recovery" concept
      // (UCI is fire-and-webhook). Return the last known result so the
      // modal has SOMETHING to display, or a generic not-found error.
      return (
        lastResult || {
          success: false,
          error: "No recoverable transaction",
        }
      );
    },
    [lastResult]
  );

  const resetPaymentState = useCallback(() => {
    activeBillIdRef.current = null;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setPaymentState("idle");
    setLastResult(null);
  }, []);

  return {
    terminal,
    // PHASE: isOnline simply means "a UCI terminal is registered". We don't
    // PING on every modal open (would slow the UX + spam GP). If admins want
    // explicit reachability, they can use the Ping button on
    // /dashboard/admin/terminals — that result is what implicitly proved the
    // terminal works in the first place.
    isOnline: !!terminal,
    paymentState,
    lastResult,
    processPayment,
    cancelTransaction,
    recoverLastTransaction,
    resetPaymentState,
  };
}
