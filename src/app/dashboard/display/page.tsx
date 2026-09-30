"use client";

// useSearchParams() forces a client-side bailout during static
// prerender. `export const dynamic = "force-dynamic"` is supposed to
// opt out of prerender entirely on client components, but Next 15's
// respect for it is inconsistent across build environments. The
// only reliable fix per Next docs is wrapping in <Suspense>. So we
// split the page into a shell + inner component and put the boundary
// between them.

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { QRCodeSVG } from "qrcode.react";

interface Invoice {
  id: string;
  invoiceNumber: string;
  subtotal: number;
  taxAmount: number;
  tipAmount: number;
  total: number;
  currency: string;
  status: string;
  paymentUrl?: string;
  paymentQrData?: string;
  paymentExpiresAt?: string;
  tenant?: {
    name: string;
  };
}

// Default export is a tiny shell whose only job is to put a Suspense
// boundary between Next's prerender and useSearchParams(). The real
// component sits in CustomerDisplayInner just below.
export default function CustomerDisplayPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-gray-400 text-sm">Loading…</div>
        </div>
      }
    >
      <CustomerDisplayInner />
    </Suspense>
  );
}

function CustomerDisplayInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const invoiceId = searchParams.get("invoice");

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const fetchInvoice = useCallback(async () => {
    // No invoice param → user reached this page from the sidebar "Customer
    // Display" link, not from a POS checkout flow. Send them to the live
    // customer-facing order-status board for their active location, the
    // same way "Kitchen Display" sidebar opens /dashboard/kitchen.
    if (!invoiceId) {
      const tenantId = localStorage.getItem("tap_active_tenant");
      const locationId = localStorage.getItem("tap_active_location");
      if (tenantId && locationId) {
        router.replace(`/order-status/${tenantId}/${locationId}`);
        return;
      }
      setError("Please select a business and location first");
      setLoading(false);
      return;
    }

    const tenantId = localStorage.getItem("tap_active_tenant");
    if (!tenantId) {
      setError("No business selected");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/invoices/${invoiceId}`
      );
      const data = await response.json();

      if (data.success) {
        setInvoice(data.invoice);

        // Check if paid
        if (data.invoice.status === "PAID") {
          setIsPaid(true);
          setShowSuccess(true);
        }
      } else {
        setError("Invoice not found");
      }
    } catch (err) {
      setError("Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    fetchInvoice();

    // Poll for payment status every 3 seconds
    const interval = setInterval(() => {
      if (!isPaid) {
        fetchInvoice();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchInvoice, isPaid]);

  const formatCurrency = (amount: number, currency: string = "CAD") => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const handleClose = () => {
    router.push("/dashboard");
  };

  const handleNewSale = () => {
    router.push("/dashboard/invoices/new");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-600 to-cyan-600 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-white border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-600 to-cyan-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center">
          <Icon icon="solar:danger-triangle-bold" className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Error</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={handleClose}
            className="px-6 py-2 rounded-xl font-semibold text-white bg-gray-900 hover:bg-gray-800 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Payment Success Screen
  if (showSuccess && invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center">
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6 animate-bounce">
            <Icon icon="solar:check-circle-bold" className="w-16 h-16 text-green-600" />
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-2">Payment Complete!</h1>
          <p className="text-gray-600 mb-6">Thank you for your purchase</p>

          <div className="bg-gray-50 rounded-2xl p-6 mb-6">
            <p className="text-sm text-gray-500 mb-1">Amount Paid</p>
            <p className="text-4xl font-bold text-gray-900">
              {formatCurrency(invoice.total, invoice.currency)}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Invoice #{invoice.invoiceNumber}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 py-3 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleNewSale}
              className="flex-1 py-3 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-colors"
            >
              New Sale
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Payment QR Display
  if (invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-600 to-cyan-600 flex items-center justify-center p-4">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
        >
          <Icon icon="solar:close-circle-linear" className="w-6 h-6" />
        </button>

        <div className="bg-white rounded-3xl p-8 max-w-md w-full">
          {/* Business Name */}
          {invoice.tenant && (
            <div className="text-center mb-6">
              <p className="text-sm text-gray-500">Payment to</p>
              <p className="text-xl font-bold text-gray-900">{invoice.tenant.name}</p>
            </div>
          )}

          {/* Amount */}
          <div className="text-center mb-6">
            <p className="text-sm text-gray-500">Amount Due</p>
            <p className="text-5xl font-bold text-gray-900">
              {formatCurrency(invoice.total, invoice.currency)}
            </p>
            {invoice.tipAmount > 0 && (
              <p className="text-sm text-teal-600 mt-1">
                Includes {formatCurrency(invoice.tipAmount, invoice.currency)} tip
              </p>
            )}
          </div>

          {/* QR Code */}
          {invoice.paymentQrData ? (
            <div className="bg-white p-4 rounded-2xl border-2 border-gray-100 mb-6 flex justify-center">
              <QRCodeSVG
                value={invoice.paymentQrData}
                size={256}
                level="M"
              />
            </div>
          ) : (
            <div className="bg-gray-100 rounded-2xl p-8 text-center mb-6">
              <Icon icon="solar:qr-code-linear" className="w-16 h-16 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-500">QR code not available</p>
            </div>
          )}

          {/* Instructions */}
          <div className="text-center mb-6">
            <p className="text-gray-600">
              Scan the QR code with your phone to complete payment
            </p>
          </div>

          {/* Invoice Details */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{formatCurrency(invoice.subtotal, invoice.currency)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Tax</span>
              <span>{formatCurrency(invoice.taxAmount, invoice.currency)}</span>
            </div>
            {invoice.tipAmount > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Tip</span>
                <span>{formatCurrency(invoice.tipAmount, invoice.currency)}</span>
              </div>
            )}
            <div className="h-px bg-gray-200" />
            <div className="flex justify-between font-semibold text-gray-900">
              <span>Total</span>
              <span>{formatCurrency(invoice.total, invoice.currency)}</span>
            </div>
          </div>

          {/* Powered by */}
          <div className="mt-6 text-center">
            <p className="text-xs text-gray-400">
              Powered by <span className="font-semibold">iTap</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
