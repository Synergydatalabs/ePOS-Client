"use client";

// =============================================================================
// /pay/invoice/[invoiceId]/print — printable / save-as-PDF invoice view.
//
// Same data as the branded pay page but laid out for A4/Letter printing:
//   • No page chrome (nav, footer stripped)
//   • Black/white with brand accent
//   • Fixed 780px width, comfortable margins
//   • Uses @media print CSS to hide the "Print" button when actually printing
//   • Auto-triggers window.print() on first mount if ?auto=1 is passed
//
// Customers on browsers can hit Ctrl/Cmd+P → Save as PDF from this page.
// Suppliers can screenshot or bookmark it for records.
//
// This page is a stand-in until we add a proper server-side PDF library
// (pdf-lib) that lets us email a PDF attachment. That comes in a later pass;
// the print view unblocks the "customer can hold a paper receipt" case now.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";

interface Line {
  id: string;
  productName: string;
  productDescription: string | null;
  unitLabel: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  paymentStatus: string;
  paymentLinkUrl: string | null;
  paidAt: string | null;
  sentAt: string;
  customer: {
    name: string;
    email: string;
    company: string | null;
    address: string | null;
  };
  items: Line[];
}

interface Supplier {
  displayName: string;
  legalName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  brand: {
    logoUrl: string | null;
    primaryColor: string;
    accentColor: string;
    backgroundColor: string;
  };
}

export default function PrintInvoicePage() {
  const params = useParams<{ invoiceId: string }>();
  const search = useSearchParams();
  const invoiceId = params?.invoiceId;
  const auto = search?.get("auto") === "1";

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!invoiceId) return;
    const res = await fetch(`/api/pay/invoice/${invoiceId}`);
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    const data = await res.json();
    if (data.success) {
      setInvoice(data.invoice);
      setSupplier(data.supplier);
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-open the print dialog once data is loaded (?auto=1 opt-in).
  useEffect(() => {
    if (auto && invoice && supplier && typeof window !== "undefined") {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [auto, invoice, supplier]);

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <p className="text-gray-700">Invoice not found.</p>
      </div>
    );
  }
  if (!invoice || !supplier) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  const money = (cents: number) =>
    `${invoice.currency} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const primary = supplier.brand.primaryColor || "#0F766E";

  return (
    <>
      {/* Print styles — hide the toolbar in print, tighten margins, force
          black text on white so weird brand backgrounds don't waste ink. */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
        @page {
          size: A4;
          margin: 18mm;
        }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="no-print bg-gray-100 border-b border-gray-200 py-3 px-6 flex items-center justify-between text-sm">
        <p className="text-gray-600">
          Printable invoice · <span className="font-mono">{invoice.invoiceNumber}</span>
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-white font-medium text-sm hover:bg-gray-800"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="max-w-[780px] mx-auto px-6 py-10 text-gray-900 print:py-0 print:px-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 pb-6 border-b" style={{ borderColor: primary }}>
          <div className="flex items-center gap-3">
            {supplier.brand.logoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={supplier.brand.logoUrl} alt="" className="h-12 w-auto object-contain" />
            )}
            <div>
              <p className="text-xl font-bold" style={{ color: primary }}>{supplier.displayName}</p>
              {supplier.legalName && supplier.legalName !== supplier.displayName && (
                <p className="text-xs text-gray-500">{supplier.legalName}</p>
              )}
              <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                {supplier.contactEmail && <p>{supplier.contactEmail}</p>}
                {supplier.contactPhone && <p>{supplier.contactPhone}</p>}
                {supplier.websiteUrl && <p>{supplier.websiteUrl}</p>}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold uppercase tracking-wider" style={{ color: primary }}>Invoice</p>
            <p className="font-mono font-semibold mt-1">{invoice.invoiceNumber}</p>
            <p className="text-xs text-gray-500 mt-1">
              Issued {new Date(invoice.sentAt).toLocaleDateString(undefined, {
                month: "long", day: "numeric", year: "numeric",
              })}
            </p>
          </div>
        </div>

        {/* Bill to + status */}
        <div className="grid grid-cols-2 gap-6 mt-6 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Bill to</p>
            <p className="font-semibold">{invoice.customer.name}</p>
            {invoice.customer.company && <p>{invoice.customer.company}</p>}
            <p className="text-gray-600">{invoice.customer.email}</p>
            {invoice.customer.address && (
              <p className="text-gray-600 mt-1 whitespace-pre-line">{invoice.customer.address}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Amount due</p>
            <p className="text-3xl font-bold tabular-nums" style={{ color: primary }}>{money(invoice.totalCents)}</p>
            {invoice.paymentStatus === "PAID" ? (
              <p className="mt-2 inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                PAID{invoice.paidAt ? ` · ${new Date(invoice.paidAt).toLocaleDateString()}` : ""}
              </p>
            ) : invoice.status === "CANCELLED" ? (
              <p className="mt-2 inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                CANCELLED
              </p>
            ) : null}
          </div>
        </div>

        {/* Line items */}
        <table className="w-full mt-8 text-sm border-collapse">
          <thead>
            <tr className="border-b-2" style={{ borderColor: primary }}>
              <th className="text-left py-2 font-semibold">Description</th>
              <th className="text-right py-2 font-semibold w-16">Qty</th>
              <th className="text-right py-2 font-semibold w-28">Unit price</th>
              <th className="text-right py-2 font-semibold w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((it) => (
              <tr key={it.id} className="border-b border-gray-200">
                <td className="py-3">
                  <p className="font-medium">{it.productName}</p>
                  {it.productDescription && (
                    <p className="text-xs text-gray-500 mt-0.5">{it.productDescription}</p>
                  )}
                </td>
                <td className="py-3 text-right tabular-nums">{it.quantity}</td>
                <td className="py-3 text-right tabular-nums">
                  {money(it.unitPriceCents)}
                  <span className="text-gray-400 text-xs"> /{it.unitLabel}</span>
                </td>
                <td className="py-3 text-right tabular-nums font-medium">{money(it.lineTotalCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-4 text-right text-gray-600">Subtotal</td>
              <td className="pt-4 text-right tabular-nums">{money(invoice.subtotalCents)}</td>
            </tr>
            {invoice.taxCents > 0 && (
              <tr>
                <td colSpan={3} className="py-1 text-right text-gray-600">Tax</td>
                <td className="py-1 text-right tabular-nums">{money(invoice.taxCents)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={3} className="py-3 text-right font-bold text-base border-t" style={{ borderColor: primary }}>Total</td>
              <td className="py-3 text-right tabular-nums font-bold text-base border-t" style={{ borderColor: primary, color: primary }}>
                {money(invoice.totalCents)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Notes + pay link */}
        <div className="grid grid-cols-[1fr_auto] gap-6 mt-8 items-start">
          <div className="text-sm">
            {invoice.notes && (
              <>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Notes</p>
                <p className="text-gray-700 whitespace-pre-line">{invoice.notes}</p>
              </>
            )}
            {invoice.paymentLinkUrl && invoice.paymentStatus !== "PAID" && invoice.status !== "CANCELLED" && (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Pay online</p>
                <p className="font-mono text-xs break-all" style={{ color: primary }}>{invoice.paymentLinkUrl}</p>
              </div>
            )}
          </div>
          {invoice.paymentLinkUrl && invoice.paymentStatus !== "PAID" && invoice.status !== "CANCELLED" && (
            <div className="text-center">
              <QRCodeSVG
                value={invoice.paymentLinkUrl}
                size={120}
                level="M"
                bgColor="#FFFFFF"
                fgColor={primary}
              />
              <p className="mt-1 text-[10px] uppercase tracking-wider text-gray-500">Scan to pay</p>
            </div>
          )}
        </div>

        <p className="mt-10 text-center text-xs text-gray-400 border-t pt-4">
          Thank you for your business. — {supplier.displayName}
        </p>
      </div>
    </>
  );
}
