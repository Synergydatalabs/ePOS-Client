"use client";

// =============================================================================
// InvoiceModal — create a supplier-issued invoice.
//
// Flow: customer info at the top, then line items. Each line can be either
// picked from the supplier's own catalog (populates product name + unit price +
// unit label) or typed free-form (blank product picker). Quantities and unit
// prices are always editable — the picked-from-catalog values are just seeds.
//
// Totals compute live at the bottom. Submit calls POST /api/supplier/invoices,
// which returns the created invoice with its payment link URL.
// =============================================================================

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { Button, Input, Modal } from "@/components/ui";

interface ProductOption {
  id: string;
  name: string;
  unitLabel: string;
  wholesalePriceCents: number;
  productType: string;
  // Phase H #1 (2026-09-02): per-product currency — invoice picker
  // auto-syncs its currency to match the first foreign-currency product
  // added to a line so the supplier doesn't have to remember.
  priceCurrency: string;
}

interface Line {
  productId: string | null;
  productName: string;
  unitLabel: string;
  quantity: number;
  unitPriceCents: number;
}

interface CreatedInvoice {
  id: string;
  invoiceNumber: string;
  paymentLinkUrl: string | null;
  customerEmail: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currency: string;
  onCreated: (invoice: CreatedInvoice) => void;
}

const BLANK_LINE: Line = {
  productId: null,
  productName: "",
  unitLabel: "unit",
  quantity: 1,
  unitPriceCents: 0,
};

export default function InvoiceModal({ isOpen, onClose, currency, onCreated }: Props) {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  // Phase F #6k (2026-08-28): CC recipients on the invoice email.
  // Free-text input the user separates with comma/space/enter; parsed on
  // submit into a validated array.
  const [ccInput, setCcInput] = useState("");
  const [customerCompany, setCustomerCompany] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");

  const [lines, setLines] = useState<Line[]>([{ ...BLANK_LINE }]);
  const [taxCents, setTaxCents] = useState<string>("0");
  const [notes, setNotes] = useState("");
  // Phase H #5 (2026-09-02): tenant-level tax defaults, loaded from
  // /api/supplier/me on modal open. The tax input auto-fills to
  // subtotal * taxRate/100 while `taxAutoFill` is still true; any manual
  // edit flips it false so the user's override sticks. Label swaps from
  // "Tax" to the supplier's chosen label ("HST", "GST", "VAT", ...).
  const [taxRatePercent, setTaxRatePercent] = useState<number>(0);
  const [taxLabel, setTaxLabel] = useState<string>("Tax");
  const [taxEnabled, setTaxEnabled] = useState<boolean>(true);
  const [taxAutoFill, setTaxAutoFill] = useState<boolean>(true);
  // Phase F #6l (2026-08-28): per-invoice currency override. Seeded from
  // the tenant's default (prop) but the supplier can pick another for
  // international customers — Stripe accepts 135+ currencies natively.
  const [invoiceCurrency, setInvoiceCurrency] = useState<string>(currency);

  const [saving, setSaving] = useState(false);

  // Phase G #1 (2026-08-30): subscription toggle. When enabled, POST body
  // includes `subscription: { enabled: true, interval }` and the invoice
  // becomes the first period of a recurring subscription. Cron generates
  // subsequent periods after the buyer pays this one.
  const [isSubscription, setIsSubscription] = useState(false);
  const [subInterval, setSubInterval] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");

  // Reset on open — modal is meant to be single-use per open.
  useEffect(() => {
    if (!isOpen) return;
    setCustomerName("");
    setCustomerEmail("");
    setCcInput("");
    setCustomerCompany("");
    setCustomerPhone("");
    setCustomerAddress("");
    setLines([{ ...BLANK_LINE }]);
    setTaxCents("0");
    setNotes("");
    setInvoiceCurrency(currency);
    setTaxAutoFill(true);

    // Phase H #5: fetch the supplier's tax defaults once per open so the
    // tax input auto-fills to subtotal * rate. Fire-and-forget — a slow
    // /me endpoint shouldn't stall the modal; user can still type a
    // manual value while it's loading.
    fetch("/api/supplier/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.taxSettings) {
          setTaxRatePercent(Number(d.taxSettings.taxRate) || 0);
          setTaxLabel(String(d.taxSettings.taxLabel || "Tax"));
          setTaxEnabled(Boolean(d.taxSettings.taxEnabled));
        }
        if (d?.tenant?.currency) {
          setInvoiceCurrency(String(d.tenant.currency));
        }
      })
      .catch(() => { /* silent — non-critical */ });

    // Lazy-load the supplier's own product catalog for the line-item picker.
    setLoadingProducts(true);
    fetch("/api/supplier/products?activeOnly=true")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setProducts(
            data.products.map((p: {
              id: string; name: string; unitLabel: string;
              wholesalePriceCents: number; productType?: string;
              priceCurrency?: string;
            }) => ({
              id: p.id,
              name: p.name,
              unitLabel: p.unitLabel,
              wholesalePriceCents: p.wholesalePriceCents,
              productType: p.productType || "PHYSICAL",
              // Phase H #1 (2026-09-02): per-product currency — used
              // to auto-sync the invoice currency when picking a
              // globally-priced product (e.g. a Mego licence in USD).
              priceCurrency: p.priceCurrency || currency,
            }))
          );
        }
      })
      .catch(() => toast.error("Failed to load your product catalog"))
      .finally(() => setLoadingProducts(false));
  }, [isOpen]);

  const updateLine = (i: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const pickProduct = (i: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateLine(i, { productId: null });
      return;
    }
    updateLine(i, {
      productId: product.id,
      productName: product.name,
      unitLabel: product.unitLabel,
      unitPriceCents: product.wholesalePriceCents,
    });
    // Phase H #1 (2026-09-02): if the picked product is priced in a
    // currency other than the current invoice currency, auto-swap the
    // invoice currency so the number the vendor stored on the product
    // is what the customer actually pays. Only fires when the invoice
    // has no other lines already pinned — avoids silently changing an
    // invoice mid-composition.
    if (product.priceCurrency && product.priceCurrency !== invoiceCurrency) {
      const hasOtherProducts = lines.some((l, idx) => idx !== i && l.productId);
      if (!hasOtherProducts) {
        setInvoiceCurrency(product.priceCurrency);
      }
    }
  };

  const addLine = () => setLines((prev) => [...prev, { ...BLANK_LINE }]);
  const removeLine = (i: number) => {
    if (lines.length === 1) {
      setLines([{ ...BLANK_LINE }]);
      return;
    }
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  };

  const subtotalCents = lines.reduce(
    (sum, l) => sum + Math.max(0, l.quantity) * Math.max(0, l.unitPriceCents),
    0
  );

  // Phase H #5 (2026-09-02): auto-fill tax from tenant defaults while
  // the user hasn't manually touched the tax input. subtotal * rate% ,
  // rounded to whole cents. Turning tax off in settings → auto-fill 0.
  useEffect(() => {
    if (!taxAutoFill) return;
    const nextCents = taxEnabled
      ? Math.round((subtotalCents * taxRatePercent) / 100)
      : 0;
    setTaxCents((nextCents / 100).toFixed(2));
  }, [subtotalCents, taxRatePercent, taxEnabled, taxAutoFill]);

  const taxNum = Math.max(0, Math.round(parseFloat(taxCents || "0") * 100));
  const totalCents = subtotalCents + taxNum;

  const money = (cents: number) =>
    `${invoiceCurrency} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  // Phase F #6k (2026-08-28): parse the CC input into a clean email array.
  // Split on comma/semicolon/whitespace so users can type any of the
  // usual separators. Validation happens both here (UX) and server-side.
  const parsedCcEmails = ccInput
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  const invalidCcEmails = parsedCcEmails.filter(
    (e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
  );

  const handleSubmit = async () => {
    if (!customerName.trim()) return toast.error("Customer name is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) {
      return toast.error("Enter a valid customer email");
    }
    if (invalidCcEmails.length > 0) {
      return toast.error(`CC address invalid: ${invalidCcEmails[0]}`);
    }
    const cleaned = lines
      .map((l) => ({ ...l, productName: l.productName.trim() }))
      .filter((l) => l.productName && l.quantity > 0 && l.unitPriceCents >= 0);
    if (cleaned.length === 0) {
      return toast.error("Add at least one line item with a product name, quantity, and price");
    }
    if (totalCents <= 0) {
      return toast.error("Invoice total must be greater than zero");
    }

    setSaving(true);
    try {
      const res = await fetch("/api/supplier/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerCcEmails: parsedCcEmails,
          customerCompany: customerCompany.trim() || null,
          customerPhone: customerPhone.trim() || null,
          customerAddress: customerAddress.trim() || null,
          currency: invoiceCurrency,
          taxCents: taxNum,
          notes: notes.trim() || null,
          lines: cleaned.map((l) => ({
            productId: l.productId,
            productName: l.productName,
            unitLabel: l.unitLabel,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
          })),
          // #G1: only include the subscription block when the vendor
          // enabled it. Absent = one-off invoice (existing behaviour).
          ...(isSubscription
            ? { subscription: { enabled: true, interval: subInterval } }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create invoice");
        return;
      }
      toast.success(
        isSubscription
          ? `Subscription started · first invoice ${data.invoice.invoiceNumber} sent`
          : `Invoice ${data.invoice.invoiceNumber} created`
      );
      onCreated({
        id: data.invoice.id,
        invoiceNumber: data.invoice.invoiceNumber,
        paymentLinkUrl: data.invoice.paymentLinkUrl,
        customerEmail: data.invoice.customerEmail,
      });
    } catch {
      toast.error("Failed to create invoice");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isSubscription ? "New Subscription" : "New Invoice"} size="lg">
      <div className="space-y-6">
        {/* Phase G #1 (2026-08-30): invoice type — one-time or subscription.
            Sits at the top so the vendor makes the choice up front. Flipping
            to Subscription doesn't change any other field — the first
            invoice looks identical, plus a note in the email + a
            recurring row created behind the scenes. */}
        <section className="rounded-2xl border border-teal-100 bg-teal-50/50 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Invoice type
          </h4>
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="flex items-start gap-3 flex-1 cursor-pointer rounded-xl border border-gray-200 bg-white p-3 hover:border-teal-400">
              <input
                type="radio"
                name="invoiceType"
                checked={!isSubscription}
                onChange={() => setIsSubscription(false)}
                className="mt-1"
              />
              <div>
                <div className="font-semibold text-gray-900">One-time invoice</div>
                <div className="text-xs text-gray-500">Single charge. Buyer pays once, done.</div>
              </div>
            </label>
            <label className="flex items-start gap-3 flex-1 cursor-pointer rounded-xl border border-gray-200 bg-white p-3 hover:border-teal-400">
              <input
                type="radio"
                name="invoiceType"
                checked={isSubscription}
                onChange={() => setIsSubscription(true)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-semibold text-gray-900">Subscription (recurring)</div>
                <div className="text-xs text-gray-500 mb-2">
                  First invoice pays now; a new invoice is auto-generated every period.
                </div>
                {isSubscription && (
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setSubInterval("MONTHLY")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                        subInterval === "MONTHLY"
                          ? "bg-teal-600 text-white border-teal-600"
                          : "bg-white text-gray-700 border-gray-200 hover:border-teal-400"
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubInterval("ANNUAL")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                        subInterval === "ANNUAL"
                          ? "bg-teal-600 text-white border-teal-600"
                          : "bg-white text-gray-700 border-gray-200 hover:border-teal-400"
                      }`}
                    >
                      Annual
                    </button>
                  </div>
                )}
              </div>
            </label>
          </div>
          {isSubscription && (
            <p className="mt-3 text-xs text-teal-800 bg-teal-100/60 rounded-lg px-3 py-2">
              <strong>Flavour A:</strong> we don't save the card. Every recurring invoice is a fresh
              emailed pay link the buyer clicks. Subscription activates only when the first
              invoice is paid.
            </p>
          )}
        </section>

        {/* Customer */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Customer
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Customer name"
              placeholder="Acme Coffee Co"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
            />
            <Input
              label="Customer email"
              type="email"
              placeholder="owner@acme.example"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              required
            />
            <Input
              label="Company (optional)"
              placeholder="Acme Holdings Ltd."
              value={customerCompany}
              onChange={(e) => setCustomerCompany(e.target.value)}
            />
            <Input
              label="Phone (optional)"
              placeholder="+1 (555) 555-0100"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </div>
          {/* Phase F #6k (2026-08-28): CC recipients — comma/space/enter
              separated. Rendered as one field with a badge preview strip
              under it so the operator can see the parsed emails. */}
          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              CC recipients <span className="text-xs text-gray-400 font-normal">(optional — separated by comma, space, or enter)</span>
            </label>
            <input
              type="text"
              value={ccInput}
              onChange={(e) => setCcInput(e.target.value)}
              placeholder="accounts@acme.com, procurement@acme.com"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
            />
            {parsedCcEmails.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parsedCcEmails.map((e, i) => {
                  const isInvalid = invalidCcEmails.includes(e);
                  return (
                    <span
                      key={`${e}-${i}`}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
                        isInvalid
                          ? "bg-red-50 text-red-700 border border-red-200"
                          : "bg-teal-50 text-teal-700 border border-teal-200"
                      }`}
                    >
                      {isInvalid && (
                        <Icon icon="solar:danger-triangle-linear" className="w-3 h-3" />
                      )}
                      {e}
                    </span>
                  );
                })}
              </div>
            )}
            {invalidCcEmails.length > 0 && (
              <p className="mt-1 text-xs text-red-600">
                {invalidCcEmails.length === 1 ? "One entry" : `${invalidCcEmails.length} entries`} not a valid email — remove or fix before saving.
              </p>
            )}
          </div>
          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Billing address (optional)
            </label>
            <textarea
              rows={2}
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="Street, city, state, postal code"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none"
            />
          </div>
        </section>

        {/* Phase F #6l (2026-08-28): currency picker. CAD is the strong
            default because Stripe charges an extra ~2.8% on international
            invoices (0.8% non-CA card + 2% FX). Suppliers who need to
            invoice in a customer's local currency can override — the trade
            is: buyer-friendly price display vs. higher Stripe fees.
            Phase F #6m (2026-08-28): live fee estimator below the picker
            so the supplier sees the net BEFORE hitting submit. */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Currency
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            {/* CAD — visually elevated as the recommended default */}
            <button
              type="button"
              onClick={() => setInvoiceCurrency("CAD")}
              className={`px-3.5 py-1.5 rounded-lg border-2 text-sm font-semibold transition-colors inline-flex items-center gap-1.5 ${
                invoiceCurrency === "CAD"
                  ? "border-teal-500 bg-teal-50 text-teal-800"
                  : "border-gray-300 text-gray-700 hover:border-teal-400"
              }`}
            >
              CAD
              <span className="text-[10px] font-medium bg-teal-100 text-teal-700 rounded px-1.5 py-0.5">
                Recommended
              </span>
            </button>
            {["USD", "GBP", "EUR", "INR", "AED", "AUD", "JPY", "KRW"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setInvoiceCurrency(c)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-semibold transition-colors ${
                  invoiceCurrency === c
                    ? "border-teal-500 bg-teal-50 text-teal-800"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {c}
              </button>
            ))}
            <input
              type="text"
              value={invoiceCurrency}
              onChange={(e) => setInvoiceCurrency(e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3}
              className="w-20 px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-mono uppercase text-center"
              placeholder="XXX"
              aria-label="Custom currency code"
            />
          </div>

          {/* Fee estimator + strategy hint. Rates are Stripe's published
              Canadian pricing as of Aug 2026 — update in one place here if
              they change. Estimate is worst-case (assumes international
              card for non-CAD); the real invoice may be a bit cheaper if
              a non-CAD invoice happens to be paid by a CA card. */}
          {(() => {
            const isCad = invoiceCurrency === "CAD";
            const percentFee = isCad ? 2.9 : 5.7; // 2.9 + 0.8 intl + 2.0 FX
            const feeCents = Math.round(totalCents * (percentFee / 100)) + 30;
            const netCents = Math.max(0, totalCents - feeCents);
            return (
              <div
                className={`mt-3 rounded-xl border p-3 text-xs space-y-1 ${
                  isCad
                    ? "border-teal-100 bg-teal-50/60 text-teal-900"
                    : "border-amber-200 bg-amber-50/60 text-amber-900"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">
                    {isCad
                      ? "Best rate — Canadian dollars"
                      : `Higher fees — non-Canadian currency (${invoiceCurrency})`}
                  </span>
                  <span className="font-mono font-semibold">
                    {percentFee.toFixed(1)}% + $0.30
                  </span>
                </div>
                <p className="opacity-80 leading-relaxed">
                  {isCad
                    ? "Canadian card holders pay directly in CAD — no FX. International cards still work; they pay in CAD and their bank does the conversion (no cost to you)."
                    : "Includes ~2% Stripe FX conversion + ~0.8% international card surcharge on top of standard processing. Better UX for the buyer, but every foreign-currency invoice costs you ~2.8% more than the same invoice in CAD."}
                </p>
                {totalCents > 0 && (
                  <div className="mt-2 pt-2 border-t border-current/20 flex items-center justify-between font-mono tabular-nums">
                    <span>Est. Stripe fee on {money(totalCents)}:</span>
                    <span className="font-semibold">−{money(feeCents)}</span>
                  </div>
                )}
                {totalCents > 0 && (
                  <div className="flex items-center justify-between font-mono tabular-nums">
                    <span className="font-semibold">
                      You net{isCad ? "" : " (after FX to CAD)"}:
                    </span>
                    <span className="font-bold">≈ {money(netCents)}</span>
                  </div>
                )}
              </div>
            );
          })()}
        </section>

        {/* Line items */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Line items
            </h4>
            <button
              type="button"
              onClick={addLine}
              className="text-sm font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1"
            >
              <Icon icon="solar:add-circle-linear" className="w-4 h-4" />
              Add line
            </button>
          </div>
          {/* Phase F #6k (2026-08-28): hint text making the free-form
              feature discoverable. Suppliers were missing that both the
              product picker AND the unit price are optional/overridable. */}
          <div className="mb-3 rounded-lg bg-teal-50/60 border border-teal-100 px-3 py-2 text-xs text-teal-900">
            <span className="font-semibold">Tip:</span> pick a product to auto-fill,
            or leave the picker blank and type a free-form service (like a PayPal invoice).
            The unit price is always editable — override the catalog price whenever you&apos;ve
            agreed on a different one with the customer.
          </div>
          <div className="space-y-3">
            {lines.map((line, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-4">
                <div className="grid grid-cols-12 gap-3 items-end">
                  <div className="col-span-12 md:col-span-5">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Product
                    </label>
                    <select
                      value={line.productId || ""}
                      onChange={(e) => pickProduct(i, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                      disabled={loadingProducts}
                    >
                      <option value="">— Free-form line (type below) —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.productType === "SOFTWARE" ? " · Software" : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={line.productName}
                      onChange={(e) => updateLine(i, { productName: e.target.value })}
                      placeholder="Line description"
                      className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Qty</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(e) => updateLine(i, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm tabular-nums text-right"
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
                    <input
                      type="text"
                      value={line.unitLabel}
                      onChange={(e) => updateLine(i, { unitLabel: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Unit price
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={(line.unitPriceCents / 100).toFixed(2)}
                      onChange={(e) =>
                        updateLine(i, {
                          unitPriceCents: Math.max(0, Math.round(parseFloat(e.target.value || "0") * 100)),
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm tabular-nums text-right"
                    />
                  </div>
                  <div className="col-span-12 md:col-span-1 flex md:justify-end">
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-gray-400 hover:text-red-600 p-2"
                      title="Remove line"
                    >
                      <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-500 text-right tabular-nums">
                  Line total: <span className="font-medium text-gray-800">{money(Math.max(0, line.quantity) * Math.max(0, line.unitPriceCents))}</span>
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Totals + notes */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={"Terms, delivery notes, thank-you message.\nShown on the invoice PDF + pay page."}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm"
            />
          </div>
          <div className="rounded-2xl bg-teal-50/50 border border-teal-100 p-4 text-sm">
            <div className="flex items-center justify-between py-1 text-gray-700">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium">{money(subtotalCents)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-1 text-gray-700">
              <span>{taxLabel} ({invoiceCurrency})</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={taxCents}
                onChange={(e) => {
                  // Phase H #5: any manual edit permanently disables the
                  // auto-fill for this modal open — user knows better.
                  setTaxAutoFill(false);
                  setTaxCents(e.target.value);
                }}
                className="w-28 px-2 py-1 border border-gray-200 rounded-md text-sm text-right tabular-nums"
              />
            </div>
            <div className="border-t border-teal-200 mt-2 pt-2 flex items-center justify-between text-base font-semibold text-teal-900">
              <span>Total</span>
              <span className="tabular-nums">{money(totalCents)}</span>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Creating…" : "Create + Send Payment Link"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
