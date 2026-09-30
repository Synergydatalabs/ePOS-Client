"use client";

// /pay/appointment/[orderId]
//
// Public deposit checkout for a salon appointment booking.
// - Loads the appointment via GET /api/pay/appointment/[orderId]
// - Shows deposit amount + appointment details
// - "Pay Deposit" runs the mock capture (real GP replaces this later)
// - After success, shows a confirmation and disables the button
//
// Partner-branded: renders under whatever domain the customer hit
// (oreugo.ca vs itap.zashx.com) so no cross-domain surprise.

import { use, useEffect, useState } from "react";
import { Icon } from "@iconify/react";

interface AppointmentInfo {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  appointmentDate: string;
  appointmentTime: string | null;
  customerName: string | null;
  customerPhoneMasked: string | null;
  serviceNames: string[];
  tenantName: string;
}

interface Deposit {
  required: boolean;
  amountCents: number;
  currency: string;
  paid: boolean;
}

function fmtMoney(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime12(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function AppointmentPaymentPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const [info, setInfo] = useState<AppointmentInfo | null>(null);
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`/api/pay/appointment/${orderId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setInfo(d.order);
          setDeposit(d.deposit);
          setPaid(!!d.deposit?.paid);
        } else {
          setError(d.error || "Appointment not found");
        }
      })
      .catch(() => setError("Failed to load appointment"))
      .finally(() => setLoading(false));
  };
  useEffect(load, [orderId]);

  const pay = async () => {
    setPaying(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/appointment/${orderId}/mock-pay`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || "Payment failed");
        return;
      }
      setPaid(true);
    } catch {
      setError("Payment failed. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }
  if (error || !info || !deposit) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center bg-white p-8 rounded-2xl shadow-sm">
          <Icon
            icon="solar:danger-triangle-linear"
            className="w-12 h-12 text-amber-500 mx-auto mb-3"
          />
          <p className="text-slate-700 font-medium">{error || "Unavailable"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <p className="text-xs uppercase tracking-wider text-slate-400">
            {paid ? "Deposit received" : "Complete your booking"}
          </p>
          <h1 className="text-2xl font-bold text-slate-900">
            {info.tenantName}
          </h1>
          <p className="text-sm text-slate-500">
            Ref: <span className="font-mono">{info.orderNumber}</span>
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <h2 className="font-bold text-slate-900 mb-3">Appointment</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Name</span>
              <span className="text-slate-900">
                {info.customerName || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Phone</span>
              <span className="text-slate-900">
                {info.customerPhoneMasked || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Date</span>
              <span className="text-slate-900">
                {fmtDate(info.appointmentDate)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Time</span>
              <span className="text-slate-900">
                {fmtTime12(info.appointmentTime)}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <p className="text-slate-500 mb-1">Services</p>
              <p className="text-slate-900">
                {info.serviceNames.join(", ") || "—"}
              </p>
            </div>
          </div>
        </div>

        <div
          className={`rounded-2xl p-5 shadow-sm border ${
            paid
              ? "bg-emerald-50 border-emerald-200"
              : "bg-white border-slate-100"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-slate-900">Deposit</h2>
            {paid && (
              <Icon
                icon="solar:check-circle-bold"
                className="w-6 h-6 text-emerald-600"
              />
            )}
          </div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-slate-500 text-sm">Amount due today</span>
            <span className="text-2xl font-bold text-slate-900">
              {fmtMoney(deposit.amountCents, deposit.currency)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            {paid
              ? "Deposit received. Balance of "
              : "Non-refundable up to the cancellation window. Balance of "}
            <span className="font-semibold">
              {fmtMoney(info.totalCents - deposit.amountCents, info.currency)}
            </span>{" "}
            {paid ? "due at your appointment." : "due at your appointment."}
          </p>

          {paid ? (
            <div className="text-center py-2">
              <p className="text-emerald-800 font-medium">
                You're booked! A confirmation SMS is on its way.
              </p>
            </div>
          ) : (
            <>
              <button
                onClick={pay}
                disabled={paying || deposit.amountCents === 0}
                className="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {paying
                  ? "Processing…"
                  : `Pay Deposit · ${fmtMoney(deposit.amountCents, deposit.currency)}`}
              </button>
              {error && (
                <p className="text-xs text-red-600 mt-2 text-center">{error}</p>
              )}
              <p className="text-[10px] text-slate-400 text-center mt-3">
                Sandbox mock capture. Real card processing will be enabled
                when the provider integration is live.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
