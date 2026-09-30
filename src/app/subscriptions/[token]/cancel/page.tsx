"use client";

// =============================================================================
// /subscriptions/[token]/cancel — public buyer cancellation page.
//
// Reached via a signed cancel_token link baked into every subscription
// email. No hub login required — the token IS the capability.
// =============================================================================

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Icon } from "@iconify/react";

interface Sub {
  status: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  totalCents: number;
  interval: string;
  intervalCount: number;
  nextBillingAt: string | null;
  cancelledAt: string | null;
}
interface Supplier {
  displayName: string;
  contactEmail: string | null;
}
interface Vendor {
  name: string;
  brandColor: string | null;
}

export default function BuyerCancelPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [sub, setSub] = useState<Sub | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/pay/subscription/${token}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        if (data.success) {
          setSub(data.subscription);
          setSupplier(data.supplier);
          if (data.vendor) setVendor(data.vendor);
          if (data.subscription.status === "CANCELLED") setCancelled(true);
        } else {
          setError(data.error || "Failed to load subscription");
        }
      } catch {
        setError("Failed to load subscription");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const confirmCancel = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/subscription/${token}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Cancel failed. Please try again.");
        return;
      }
      setCancelled(true);
    } catch {
      setError("Cancel failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const money = (cents: number, ccy: string) =>
    `${ccy} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const intervalWord = (interval: string) =>
    interval === "MONTHLY" ? "month" : interval === "ANNUAL" ? "year" : interval.toLowerCase();

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Subscription not found</h1>
          <p className="mt-2 text-sm text-gray-600">
            This link may be expired or mistyped. If you meant to cancel a
            subscription, reply to the last invoice email and we'll take care of it.
          </p>
        </div>
      </div>
    );
  }
  if (loading || !sub || !supplier) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  const primary = vendor?.brandColor || "#0F766E";
  const brand = vendor?.name || supplier.displayName;

  return (
    <div className="min-h-screen bg-gray-50">
      <header
        className="w-full py-8"
        style={{ background: `linear-gradient(135deg, ${primary} 0%, ${primary}CC 100%)` }}
      >
        <div className="max-w-2xl mx-auto px-6 text-white">
          <p className="text-xs uppercase tracking-[0.15em] opacity-70">Subscription</p>
          <h1 className="text-2xl font-bold mt-1">{brand}</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          {cancelled ? (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                <Icon icon="solar:check-circle-bold" className="w-9 h-9 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Subscription cancelled</h2>
              <p className="mt-2 text-sm text-gray-600 max-w-md mx-auto">
                Your {brand} subscription has been cancelled. You won't receive any
                further invoices. Any invoice already sent that you haven't paid
                will remain open — pay it or ignore it, your call.
              </p>
              {supplier.contactEmail && (
                <p className="mt-6 text-xs text-gray-500">
                  Questions?{" "}
                  <a href={`mailto:${supplier.contactEmail}`} className="underline">
                    {supplier.contactEmail}
                  </a>
                </p>
              )}
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-gray-900">
                Cancel your subscription?
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                You're about to cancel the following recurring billing arrangement.
                No more invoices will be sent after you confirm.
              </p>

              <dl className="mt-6 divide-y divide-gray-100 border border-gray-100 rounded-xl bg-gray-50">
                <div className="flex justify-between px-4 py-3">
                  <dt className="text-xs uppercase tracking-wider text-gray-500">
                    Subscriber
                  </dt>
                  <dd className="text-sm text-gray-900 font-medium">
                    {sub.customerName}
                    <span className="text-gray-500 ml-2 font-normal">
                      ({sub.customerEmail})
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between px-4 py-3">
                  <dt className="text-xs uppercase tracking-wider text-gray-500">
                    Amount
                  </dt>
                  <dd className="text-sm text-gray-900 font-semibold tabular-nums">
                    {money(sub.totalCents, sub.currency)} / {intervalWord(sub.interval)}
                  </dd>
                </div>
                <div className="flex justify-between px-4 py-3">
                  <dt className="text-xs uppercase tracking-wider text-gray-500">
                    Next billing
                  </dt>
                  <dd className="text-sm text-gray-700">
                    {sub.status === "PENDING_ACTIVATION"
                      ? "After first payment"
                      : sub.nextBillingAt
                      ? new Date(sub.nextBillingAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : "—"}
                  </dd>
                </div>
              </dl>

              <label className="block mt-6 text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                Reason for cancelling <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Anything you'd like us to know? Not required."
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:border-transparent"
                style={{ "--tw-ring-color": primary } as React.CSSProperties}
                maxLength={500}
              />

              {error && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={confirmCancel}
                  disabled={submitting}
                  className="flex-1 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: "#DC2626" }}
                >
                  {submitting ? "Cancelling…" : "Yes, cancel subscription"}
                </button>
                <a
                  href="/"
                  className="flex-1 rounded-xl px-6 py-3 text-sm font-semibold text-gray-700 border border-gray-200 bg-white text-center hover:bg-gray-50"
                >
                  Keep subscription
                </a>
              </div>

              <p className="mt-4 text-center text-xs text-gray-500">
                Cancellation stops future invoices only. Any invoice already
                issued stays open until you pay or ignore it.
              </p>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Managed by {supplier.displayName}
          {vendor ? <> · {vendor.name}</> : null}
        </p>
      </main>
    </div>
  );
}
