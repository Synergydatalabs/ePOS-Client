"use client";

// Public gift-card balance check.
// URL: /gift-card?tenant=<slug>  (tenant slug or id in query)
// Customers type their card code and see the remaining balance.
// No auth — the check endpoint is public but returns only balance/status.

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@iconify/react";

interface Balance {
  code: string;
  balance: number;
  currency: string;
  status: string;
  expiresAt?: string | null;
  redeemable: boolean;
}

function GiftCardCheckInner() {
  const params = useSearchParams();
  // Merchants generate this link from the admin gift-cards page, which stamps
  // the tenant's UUID into ?tenant=. If a signed-in staff user lands here
  // without one we fall back to their active tenant from localStorage.
  const paramTenant = params.get("tenant") || "";
  const isUuid = /^[0-9a-f-]{36}$/i.test(paramTenant);

  const [tenantId, setTenantId] = useState<string | null>(isUuid ? paramTenant : null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!tenantId && typeof window !== "undefined") {
      const stored = window.localStorage.getItem("tap_active_tenant");
      if (stored) setTenantId(stored);
    }
  }, [tenantId]);

  const check = async () => {
    if (!tenantId || !code.trim()) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/gift-cards/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.card);
      } else {
        setError(data.error || "Card not found");
      }
    } catch {
      setError("Could not check card balance right now");
    } finally {
      setChecking(false);
    }
  };

  const formatPrice = (cents: number, currency = "CAD") =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
      (cents || 0) / 100
    );

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <Icon icon="solar:info-circle-bold" className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Merchant not specified
          </h1>
          <p className="text-gray-500 text-sm">
            Please use the balance-check link provided by the merchant.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
          <div className="p-6 bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-center">
            <Icon icon="solar:gift-bold" className="w-12 h-12 mx-auto mb-2" />
            <h1 className="text-xl font-bold">Gift Card Balance</h1>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter your card code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && check()}
                placeholder="GC-XXXX-XXXX-XXXX"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none font-mono text-center text-lg tracking-wider"
              />
              <p className="text-xs text-gray-500 mt-1">
                Case-insensitive. Hyphens optional.
              </p>
            </div>

            <button
              onClick={check}
              disabled={!code.trim() || checking}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {checking ? "Checking..." : "Check Balance"}
            </button>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700 flex items-start gap-2">
                <Icon
                  icon="solar:danger-triangle-bold"
                  className="w-5 h-5 flex-shrink-0 mt-0.5"
                />
                <span>{error}</span>
              </div>
            )}

            {result && (
              <div className="p-5 rounded-2xl bg-gray-50 border border-gray-100 text-center">
                <p className="text-xs uppercase text-gray-500">Current Balance</p>
                <p className="text-4xl font-bold text-gray-900 mt-1">
                  {formatPrice(result.balance, result.currency)}
                </p>
                <p className="text-xs text-gray-400 mt-2 font-mono">{result.code}</p>
                <div className="mt-3 flex items-center justify-center gap-2 text-xs">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${result.redeemable ? "bg-green-500" : "bg-gray-400"}`}
                  />
                  <span className="text-gray-600">
                    {result.redeemable
                      ? "Ready to redeem in-store"
                      : result.status === "REDEEMED"
                        ? "Fully redeemed"
                        : result.status === "EXPIRED"
                          ? "Expired"
                          : result.status === "CANCELLED"
                            ? "Cancelled"
                            : "Unavailable"}
                  </span>
                </div>
                {result.expiresAt && (
                  <p className="text-xs text-gray-400 mt-2">
                    Expires {new Date(result.expiresAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Balance is checked in real time
        </p>
      </div>
    </div>
  );
}

export default function GiftCardCheckPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-gray-400">
          <Icon icon="solar:refresh-linear" className="w-8 h-8 animate-spin" />
        </div>
      }
    >
      <GiftCardCheckInner />
    </Suspense>
  );
}
