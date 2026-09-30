"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { format } from "date-fns";

interface Invoice {
  id: string;
  invoiceNumber: string;
  orderReference?: string;
  customerName?: string;
  subtotal: number;
  taxAmount: number;
  tipAmount: number;
  total: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt?: string;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "paid" | "cancelled">("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    const tenantId = localStorage.getItem("tap_active_tenant");
    if (!tenantId) return;

    try {
      const response = await fetch(`/api/tenants/${tenantId}/invoices?limit=100`);
      const data = await response.json();

      if (data.success) {
        setInvoices(data.invoices);
      }
    } catch (error) {
      console.error("Failed to fetch invoices:", error);
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
        return "bg-green-100 text-green-700";
      case "PENDING_PAYMENT":
        return "bg-amber-100 text-amber-700";
      case "OPEN":
        return "bg-blue-100 text-blue-700";
      case "CANCELLED":
        return "bg-gray-100 text-gray-500";
      case "REFUNDED":
      case "PARTIALLY_REFUNDED":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "PAID":
        return "solar:check-circle-bold";
      case "PENDING_PAYMENT":
        return "solar:clock-circle-bold";
      case "OPEN":
        return "solar:document-text-bold";
      case "CANCELLED":
        return "solar:close-circle-bold";
      case "REFUNDED":
      case "PARTIALLY_REFUNDED":
        return "solar:undo-left-bold";
      default:
        return "solar:document-text-bold";
    }
  };

  const filteredInvoices = invoices.filter((invoice) => {
    // Status filter
    if (filter === "open" && !["OPEN", "PENDING_PAYMENT"].includes(invoice.status)) return false;
    if (filter === "paid" && invoice.status !== "PAID") return false;
    if (filter === "cancelled" && invoice.status !== "CANCELLED") return false;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        invoice.invoiceNumber.toLowerCase().includes(query) ||
        invoice.orderReference?.toLowerCase().includes(query) ||
        invoice.customerName?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-gray-500">Manage your sales and payments</p>
        </div>

        <Link
          href="/dashboard/invoices/new"
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all"
        >
          <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
          <span>New Invoice</span>
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Icon
              icon="solar:magnifer-linear"
              className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              type="text"
              placeholder="Search invoices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2">
            {[
              { key: "all", label: "All" },
              { key: "open", label: "Open" },
              { key: "paid", label: "Paid" },
              { key: "cancelled", label: "Cancelled" },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => setFilter(item.key as any)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  filter === item.key
                    ? "bg-teal-100 text-teal-700"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Invoice List */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {filteredInvoices.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {filteredInvoices.map((invoice) => (
              <Link
                key={invoice.id}
                href={`/dashboard/invoices/${invoice.id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${getStatusColor(
                      invoice.status
                    )}`}
                  >
                    <Icon icon={getStatusIcon(invoice.status)} className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900">{invoice.invoiceNumber}</p>
                      {invoice.orderReference && (
                        <span className="text-sm text-gray-500">
                          • {invoice.orderReference}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>{format(new Date(invoice.createdAt), "MMM d, h:mm a")}</span>
                      {invoice.customerName && (
                        <>
                          <span>•</span>
                          <span>{invoice.customerName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {formatCurrency(invoice.total, invoice.currency)}
                    </p>
                    {invoice.tipAmount > 0 && (
                      <p className="text-xs text-gray-500">
                        Tip: {formatCurrency(invoice.tipAmount, invoice.currency)}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                      invoice.status
                    )}`}
                  >
                    {invoice.status.replace("_", " ")}
                  </span>
                  <Icon icon="solar:arrow-right-linear" className="w-4 h-4 text-gray-400" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <Icon icon="solar:document-text-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {searchQuery || filter !== "all" ? "No invoices found" : "No invoices yet"}
            </h3>
            <p className="text-gray-500 mb-6">
              {searchQuery || filter !== "all"
                ? "Try adjusting your search or filters"
                : "Create your first invoice to get started"}
            </p>
            {!searchQuery && filter === "all" && (
              <Link
                href="/dashboard/invoices/new"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all"
              >
                <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
                Create Invoice
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Stats Summary */}
      {invoices.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <p className="text-sm text-gray-500">Total Invoices</p>
            <p className="text-2xl font-bold text-gray-900">{invoices.length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <p className="text-sm text-gray-500">Paid</p>
            <p className="text-2xl font-bold text-green-600">
              {invoices.filter((i) => i.status === "PAID").length}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <p className="text-sm text-gray-500">Open</p>
            <p className="text-2xl font-bold text-blue-600">
              {invoices.filter((i) => ["OPEN", "PENDING_PAYMENT"].includes(i.status)).length}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <p className="text-sm text-gray-500">Total Revenue</p>
            <p className="text-2xl font-bold text-gray-900">
              {formatCurrency(
                invoices
                  .filter((i) => i.status === "PAID")
                  .reduce((sum, i) => sum + i.total, 0),
                invoices[0]?.currency || "CAD"
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
