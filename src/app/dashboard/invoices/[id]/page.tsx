"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Payment {
  id: string;
  provider: string;
  method?: string;
  amount: number;
  status: string;
  completedAt?: string;
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  orderReference?: string;
  customerName?: string;
  customerEmail?: string;
  notes?: string;
  subtotal: number;
  taxAmount: number;
  tipAmount: number;
  total: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt?: string;
  cancelledAt?: string;
  items: InvoiceItem[];
  payments: Payment[];
  location?: {
    id: string;
    name: string;
    address?: string;
  };
  createdBy?: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchInvoice();
  }, [invoiceId]);

  const fetchInvoice = async () => {
    const tenantId = localStorage.getItem("tap_active_tenant");
    if (!tenantId) return;

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/invoices/${invoiceId}`
      );
      const data = await response.json();

      if (data.success) {
        setInvoice(data.invoice);
      } else {
        toast.error("Invoice not found");
        router.push("/dashboard/invoices");
      }
    } catch (error) {
      console.error("Failed to fetch invoice:", error);
      toast.error("Failed to load invoice");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number, currency: string = "CAD") => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PAID":
        return "bg-green-100 text-green-700 border-green-200";
      case "PENDING_PAYMENT":
        return "bg-amber-100 text-amber-700 border-amber-200";
      case "OPEN":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "CANCELLED":
        return "bg-gray-100 text-gray-500 border-gray-200";
      case "REFUNDED":
      case "PARTIALLY_REFUNDED":
        return "bg-red-100 text-red-700 border-red-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const handlePayCash = async () => {
    if (!invoice) return;

    const tenantId = localStorage.getItem("tap_active_tenant");
    if (!tenantId) return;

    setActionLoading(true);

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/invoices/${invoice.id}/pay-cash`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      const data = await response.json();

      if (data.success) {
        toast.success("Payment recorded!");
        fetchInvoice();
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to record payment");
    } finally {
      setActionLoading(false);
    }
  };

  const handleGenerateQR = async () => {
    if (!invoice) return;

    const tenantId = localStorage.getItem("tap_active_tenant");
    if (!tenantId) return;

    setActionLoading(true);

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/invoices/${invoice.id}/payment-session`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (data.success) {
        // Open customer display
        router.push(`/dashboard/display?invoice=${invoice.id}`);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to generate QR code");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!invoice) return;

    if (!confirm("Are you sure you want to cancel this invoice?")) return;

    const tenantId = localStorage.getItem("tap_active_tenant");
    if (!tenantId) return;

    setActionLoading(true);

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/invoices/${invoice.id}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (data.success) {
        toast.success("Invoice cancelled");
        fetchInvoice();
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to cancel invoice");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="space-y-4">
            <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
            <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="text-center py-12">
        <Icon icon="solar:document-text-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Invoice not found</h3>
        <Link href="/dashboard/invoices" className="text-teal-600 hover:underline">
          Back to invoices
        </Link>
      </div>
    );
  }

  const isPaid = invoice.status === "PAID";
  const isCancelled = invoice.status === "CANCELLED";
  const isPayable = ["OPEN", "PENDING_PAYMENT"].includes(invoice.status);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/invoices"
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Icon icon="solar:arrow-left-linear" className="w-6 h-6" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {invoice.invoiceNumber}
              </h1>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(
                  invoice.status
                )}`}
              >
                {invoice.status.replace("_", " ")}
              </span>
            </div>
            <p className="text-gray-500">
              Created {format(new Date(invoice.createdAt), "MMMM d, yyyy 'at' h:mm a")}
            </p>
          </div>
        </div>

        {/* Actions Dropdown - for future use */}
        {!isCancelled && !isPaid && (
          <button
            onClick={handleCancel}
            disabled={actionLoading}
            className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
            title="Cancel Invoice"
          >
            <Icon icon="solar:trash-bin-2-linear" className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="grid gap-6">
        {/* Invoice Details */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          {/* Customer Info */}
          {(invoice.customerName || invoice.customerEmail || invoice.orderReference) && (
            <div className="mb-6 pb-6 border-b border-gray-100">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Customer Details</h3>
              <div className="space-y-1">
                {invoice.customerName && (
                  <p className="text-gray-900 font-medium">{invoice.customerName}</p>
                )}
                {invoice.customerEmail && (
                  <p className="text-gray-600">{invoice.customerEmail}</p>
                )}
                {invoice.orderReference && (
                  <p className="text-sm text-gray-500">Ref: {invoice.orderReference}</p>
                )}
              </div>
            </div>
          )}

          {/* Line Items */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Items</h3>
            <div className="space-y-3">
              {invoice.items.map((item) => (
                <div key={item.id} className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{item.description}</p>
                    <p className="text-sm text-gray-500">
                      {item.quantity} × {formatCurrency(item.unitPrice, invoice.currency)}
                    </p>
                  </div>
                  <p className="font-medium text-gray-900">
                    {formatCurrency(item.total, invoice.currency)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="pt-6 border-t border-gray-100 space-y-2">
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
            <div className="h-px bg-gray-200 my-2" />
            <div className="flex justify-between text-lg font-bold text-gray-900">
              <span>Total</span>
              <span>{formatCurrency(invoice.total, invoice.currency)}</span>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Notes</h3>
              <p className="text-gray-600 whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </div>

        {/* Payment Actions - Only for payable invoices */}
        {isPayable && (
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Record Payment</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={handleGenerateQR}
                disabled={actionLoading}
                className="p-4 rounded-xl border-2 border-teal-500 bg-teal-50 hover:bg-teal-100 transition-all flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-lg bg-teal-100 flex items-center justify-center">
                  <Icon icon="solar:qr-code-bold" className="w-5 h-5 text-teal-600" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-900">QR Payment</p>
                  <p className="text-sm text-gray-500">Show to customer</p>
                </div>
              </button>

              <button
                onClick={handlePayCash}
                disabled={actionLoading}
                className="p-4 rounded-xl border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                  <Icon icon="solar:wallet-money-bold" className="w-5 h-5 text-gray-600" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-900">Cash Payment</p>
                  <p className="text-sm text-gray-500">Mark as paid</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Payment History */}
        {invoice.payments && invoice.payments.length > 0 && (
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment History</h3>
            <div className="space-y-3">
              {invoice.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        payment.status === "COMPLETED"
                          ? "bg-green-100"
                          : payment.status === "PENDING"
                          ? "bg-amber-100"
                          : "bg-red-100"
                      }`}
                    >
                      <Icon
                        icon={
                          payment.status === "COMPLETED"
                            ? "solar:check-circle-bold"
                            : payment.status === "PENDING"
                            ? "solar:clock-circle-bold"
                            : "solar:close-circle-bold"
                        }
                        className={`w-4 h-4 ${
                          payment.status === "COMPLETED"
                            ? "text-green-600"
                            : payment.status === "PENDING"
                            ? "text-amber-600"
                            : "text-red-600"
                        }`}
                      />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 capitalize">
                        {payment.method || payment.provider}
                      </p>
                      <p className="text-sm text-gray-500">
                        {payment.completedAt
                          ? format(new Date(payment.completedAt), "MMM d, h:mm a")
                          : format(new Date(payment.createdAt), "MMM d, h:mm a")}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {formatCurrency(payment.amount, invoice.currency)}
                    </p>
                    <p
                      className={`text-xs ${
                        payment.status === "COMPLETED"
                          ? "text-green-600"
                          : payment.status === "PENDING"
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                    >
                      {payment.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Details</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {invoice.location && (
              <div>
                <p className="text-gray-500">Location</p>
                <p className="text-gray-900">{invoice.location.name}</p>
              </div>
            )}
            {invoice.createdBy && (
              <div>
                <p className="text-gray-500">Created by</p>
                <p className="text-gray-900">
                  {invoice.createdBy.firstName && invoice.createdBy.lastName
                    ? `${invoice.createdBy.firstName} ${invoice.createdBy.lastName}`
                    : invoice.createdBy.email}
                </p>
              </div>
            )}
            {invoice.paidAt && (
              <div>
                <p className="text-gray-500">Paid at</p>
                <p className="text-gray-900">
                  {format(new Date(invoice.paidAt), "MMM d, yyyy h:mm a")}
                </p>
              </div>
            )}
            {invoice.cancelledAt && (
              <div>
                <p className="text-gray-500">Cancelled at</p>
                <p className="text-gray-900">
                  {format(new Date(invoice.cancelledAt), "MMM d, yyyy h:mm a")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
