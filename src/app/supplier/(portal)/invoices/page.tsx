"use client";

// =============================================================================
// /supplier/invoices — supplier-issued invoice list + entry point to create.
//
// Table columns kept minimal on purpose (# / Customer / Amount / Status /
// Sent / Actions) — anything richer lives on the detail page. Filter dropdown
// scopes by status; there's no server-side pagination in v1 because a supplier
// won't have 200+ open invoices before we build proper analytics.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui";
import InvoiceModal from "./InvoiceModal";

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  status: string;
  paymentStatus: string;
  currency: string;
  totalCents: number;
  customerName: string;
  customerEmail: string;
  sentAt: string;
  paidAt: string | null;
  emailSentAt: string | null;
}

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  SENT:      { bg: "bg-teal-50",   fg: "text-teal-800",   label: "Sent" },
  PAID:      { bg: "bg-green-50",  fg: "text-green-800",  label: "Paid" },
  CANCELLED: { bg: "bg-gray-100",  fg: "text-gray-500",   label: "Cancelled" },
  REFUNDED:  { bg: "bg-amber-50",  fg: "text-amber-800",  label: "Refunded" },
};

export default function SupplierInvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [currency, setCurrency] = useState("CAD");
  const [modalOpen, setModalOpen] = useState(false);
  // The most-recent invoice from a successful create — we show its pay link
  // in a "share this" panel above the list so the supplier can copy it out
  // to WhatsApp / SMS / print for the customer.
  const [freshInvoice, setFreshInvoice] = useState<{
    id: string;
    invoiceNumber: string;
    paymentLinkUrl: string | null;
    customerEmail: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, invRes] = await Promise.all([
        fetch("/api/supplier/me"),
        fetch("/api/supplier/invoices" + (statusFilter ? `?status=${statusFilter}` : "")),
      ]);
      const meData = await meRes.json();
      const invData = await invRes.json();
      if (meData.success) setCurrency(meData.tenant.currency);
      if (invData.success) setInvoices(invData.invoices);
      else toast.error(invData.error || "Failed to load invoices");
    } catch {
      toast.error("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const money = (cents: number, ccy = currency) =>
    `${ccy} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Phase F #6k (2026-08-28): resend supports an override recipient +
  // extra CCs. Uses a browser prompt to keep the UI change minimal; a
  // proper modal is a nice-to-have polish. Empty override → send to the
  // saved customer email. Supplier can also add CCs by separating with
  // comma/space in the second prompt.
  const resendEmail = async (
    invoiceId: string,
    invoiceNumber: string,
    defaultEmail: string
  ) => {
    const overrideEmail = window.prompt(
      `Resend invoice ${invoiceNumber} to which email?\n\nLeave blank to keep the original recipient.`,
      defaultEmail
    );
    if (overrideEmail === null) return; // cancelled
    const ccRaw = window.prompt(
      `Any CC recipients? (separate with comma or space, or leave blank)`,
      ""
    );
    if (ccRaw === null) return; // cancelled
    const overrideCc = ccRaw
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    const body: { overrideEmail?: string; overrideCc?: string[] } = {};
    if (overrideEmail.trim() && overrideEmail.trim() !== defaultEmail) {
      body.overrideEmail = overrideEmail.trim();
    }
    if (overrideCc.length > 0) {
      body.overrideCc = overrideCc;
    }

    const res = await fetch(`/api/supplier/invoices/${invoiceId}/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Object.keys(body).length ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to send email");
      return;
    }
    const recipient = body.overrideEmail || defaultEmail;
    toast.success(`Invoice ${invoiceNumber} sent to ${recipient}`);
  };

  const cancel = async (row: InvoiceRow) => {
    if (row.paymentStatus === "PAID") {
      toast.error("Paid invoices can't be cancelled — issue a refund instead");
      return;
    }
    if (!confirm(`Cancel invoice ${row.invoiceNumber}? The customer's payment link stops working.`)) {
      return;
    }
    const res = await fetch(`/api/supplier/invoices/${row.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: null }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to cancel invoice");
      return;
    }
    toast.success(`Invoice ${row.invoiceNumber} cancelled`);
    load();
  };

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Invoices</h1>
          <p className="text-gray-500 mt-1">
            {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="">All statuses</option>
            <option value="SENT">Sent</option>
            <option value="PAID">Paid</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="REFUNDED">Refunded</option>
          </select>
          <Button icon="solar:add-circle-linear" onClick={() => setModalOpen(true)}>
            New Invoice
          </Button>
        </div>
      </div>

      {/* Fresh-invoice pay link panel — one-shot after a successful create.
          Shows the pay link URL to copy + a QR code the supplier can screenshot
          or print for the customer + a "Resend email" button in case SES was
          slow or the address was mistyped. Dismisses on close-button click. */}
      {freshInvoice && freshInvoice.paymentLinkUrl && (
        <div className="mb-6 rounded-2xl border border-teal-200 bg-teal-50/50 p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-teal-900">
                Invoice {freshInvoice.invoiceNumber} created
              </p>
              <p className="mt-1 text-sm text-teal-800">
                Email sent to <span className="font-medium">{freshInvoice.customerEmail}</span>.
                You can also share the payment link directly via WhatsApp, SMS, or any other channel:
              </p>
            </div>
            <button
              onClick={() => setFreshInvoice(null)}
              className="shrink-0 text-teal-700 hover:text-teal-900"
              aria-label="Dismiss"
            >
              <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
            <div className="space-y-3 min-w-0">
              <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-white px-3 py-2">
                <input
                  readOnly
                  value={freshInvoice.paymentLinkUrl}
                  className="flex-1 min-w-0 text-sm bg-transparent outline-none font-mono text-teal-900"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  className="shrink-0 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-600"
                  onClick={() => {
                    navigator.clipboard.writeText(freshInvoice.paymentLinkUrl!);
                    toast.success("Payment link copied");
                  }}
                >
                  Copy link
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => resendEmail(freshInvoice.id, freshInvoice.invoiceNumber, freshInvoice.customerEmail)}
                  className="inline-flex items-center gap-1.5 text-sm text-teal-800 hover:text-teal-900 font-medium"
                >
                  <Icon icon="solar:letter-linear" className="w-4 h-4" />
                  Resend email
                </button>
                <a
                  href={`/pay/invoice/${freshInvoice.id}/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-teal-800 hover:text-teal-900 font-medium"
                >
                  <Icon icon="solar:printer-linear" className="w-4 h-4" />
                  Printable invoice
                </a>
                <a
                  href={freshInvoice.paymentLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-teal-800 hover:text-teal-900 font-medium"
                >
                  <Icon icon="solar:eye-linear" className="w-4 h-4" />
                  Preview pay page
                </a>
              </div>
            </div>
            {/* QR code for the pay link — customer scans from a printout
                or another device. Boxed in white so it works on any brand. */}
            <div className="rounded-xl bg-white border border-teal-100 p-3 flex flex-col items-center gap-1">
              <QRCodeSVG
                value={freshInvoice.paymentLinkUrl}
                size={112}
                level="M"
                bgColor="#FFFFFF"
                fgColor="#0F766E"
              />
              <p className="text-[10px] uppercase tracking-wider text-teal-700 font-medium">
                Scan to pay
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 p-14 text-center">
          <Icon icon="solar:bill-list-linear" className="w-12 h-12 mx-auto text-gray-300" />
          <p className="mt-3 text-lg font-semibold text-gray-800">No invoices yet</p>
          <p className="mt-1 text-sm text-gray-500 max-w-md mx-auto">
            Pick from your product catalog, add customer details, and hub emails a payment
            link + QR code. Payment status updates when the customer pays.
          </p>
          <Button className="mt-5 inline-flex" icon="solar:add-circle-linear" onClick={() => setModalOpen(true)}>
            Create your first invoice
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Invoice</th>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Sent</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((row) => {
                const s = STATUS_STYLES[row.status] || STATUS_STYLES.SENT;
                const isPaid = row.paymentStatus === "PAID";
                return (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="font-mono text-sm font-semibold text-gray-900">{row.invoiceNumber}</p>
                      {isPaid && (
                        <p className="text-[11px] font-medium text-green-700 mt-0.5">
                          Paid {fmtDate(row.paidAt)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{row.customerName}</p>
                      <p className="text-xs text-gray-500">{row.customerEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 tabular-nums">
                      {money(row.totalCents, row.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full ${s.bg} ${s.fg} px-2 py-0.5 text-xs font-medium`}>
                        {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(row.sentAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/pay/invoice/${row.id}`;
                            navigator.clipboard.writeText(url);
                            toast.success("Payment link copied");
                          }}
                          className="text-gray-500 hover:text-teal-700"
                          title="Copy payment link"
                        >
                          <Icon icon="solar:link-linear" className="w-4 h-4" />
                        </button>
                        {row.status !== "CANCELLED" && !isPaid && (
                          <button
                            onClick={() => resendEmail(row.id, row.invoiceNumber, row.customerEmail)}
                            className="text-gray-500 hover:text-teal-700"
                            title="Resend email"
                          >
                            <Icon icon="solar:letter-linear" className="w-4 h-4" />
                          </button>
                        )}
                        <a
                          href={`/pay/invoice/${row.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-500 hover:text-teal-700"
                          title="Preview pay page"
                        >
                          <Icon icon="solar:eye-linear" className="w-4 h-4" />
                        </a>
                        <a
                          href={`/pay/invoice/${row.id}/print`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-500 hover:text-teal-700"
                          title="Printable invoice"
                        >
                          <Icon icon="solar:printer-linear" className="w-4 h-4" />
                        </a>
                        {row.status !== "CANCELLED" && !isPaid && (
                          <button
                            onClick={() => cancel(row)}
                            className="text-gray-500 hover:text-red-600"
                            title="Cancel invoice"
                          >
                            <Icon icon="solar:close-circle-linear" className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <InvoiceModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        currency={currency}
        onCreated={(inv) => {
          setFreshInvoice({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            paymentLinkUrl: inv.paymentLinkUrl,
            customerEmail: inv.customerEmail,
          });
          setModalOpen(false);
          load();
        }}
      />
    </div>
  );
}
