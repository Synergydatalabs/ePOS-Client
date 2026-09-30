"use client";

// Phase I #1 (2026-09-08) — Create Payment Link modal.
//
// Guided form for the supplier to build a link template. Fields grouped:
//   • Basics: product picker + nickname + partner tag
//   • Payment: mode (one-time / subscription), interval, price override
//   • Quantity: locked at N vs customer-picks with min/max/default
//   • Customer info: which fields to require (name/phone/company; email always)
//   • Advanced (collapsed): expiry, max uses, redirect URL, description override,
//     partner co-branding logo

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface ProductOption {
  id: string;
  name: string;
  wholesalePriceCents: number;
  priceCurrency: string;
  unitLabel: string;
}

// Existing link shape — subset of the row from the list page. When `editing`
// is passed in, the modal pre-fills fields from this record and issues a
// PATCH instead of POST on save. When null/undefined, it's create mode.
export interface EditableLink {
  id: string;
  productId: string | null;
  nickname: string;
  mode: "one_time" | "subscription";
  interval: string | null;
  intervalCount: number | null;
  unitAmountCents: number | null;
  currency: string;
  qtyLocked: boolean;
  qtyDefault: number;
  qtyMin: number;
  qtyMax: number | null;
  // Phase I #12 (2026-09-22): editable amount at pay time.
  amountLocked?: boolean;
  amountMinCents?: number | null;
  amountMaxCents?: number | null;
  partnerRef: string | null;
  partnerDisplayName: string | null;
  partnerLogoUrl: string | null;
  redirectUrl: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  requireName: boolean;
  requirePhone: boolean;
  requireCompany: boolean;
  descriptionOverride: string | null;
  // Phase I #3 (2026-09-10): comma-separated partner notification emails.
  notifyEmails: string | null;
  // Phase I #5 v2 (2026-09-14): per-link outbound webhook.
  webhookUrl?: string | null;
  webhookTemplate?: string | null;
  webhookEvents?: string[];
  webhookContentType?: string;
  webhookEnabled?: boolean;
  // Never returned in full — always masked. Fresh secret returned once
  // in the save response when a URL is first added.
  // Phase I #5 v3 (2026-09-14): secret is partner-supplied (cleartext
  // string). We return it as-is on edit so partners can see + edit
  // what they typed. If they want it masked, they can not paste it
  // into the field — the UI shows it as password-type input by default.
  webhookSecret?: string | null;
}

interface Props {
  products: ProductOption[];
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  /** When provided, the modal opens in EDIT mode (pre-filled + PATCH). */
  editing?: EditableLink | null;
}

export default function PaymentLinkModal({ products, onClose, onCreated, editing }: Props) {
  const isEdit = !!editing;
  const [saving, setSaving] = useState(false);
  // Advanced defaults to open in edit mode when any advanced field is set —
  // less surprising than hiding fields the user already populated.
  const [advanced, setAdvanced] = useState<boolean>(
    Boolean(
      editing &&
        (editing.expiresAt ||
          editing.maxUses != null ||
          editing.redirectUrl ||
          editing.notifyEmails ||
          editing.descriptionOverride ||
          editing.partnerDisplayName ||
          editing.partnerLogoUrl)
    )
  );

  // Basics
  const [productId, setProductId] = useState<string>(
    editing?.productId ?? products[0]?.id ?? ""
  );
  const [nickname, setNickname] = useState(editing?.nickname ?? "");
  const [partnerRef, setPartnerRef] = useState(editing?.partnerRef ?? "");

  // Payment
  const [mode, setMode] = useState<"one_time" | "subscription">(editing?.mode ?? "one_time");
  const [interval, setInterval] = useState<"day" | "week" | "month" | "year">(
    (editing?.interval as any) ?? "month"
  );
  const [intervalCount, setIntervalCount] = useState(editing?.intervalCount ?? 1);
  const [priceOverride, setPriceOverride] = useState<string>(
    editing?.unitAmountCents != null ? (editing.unitAmountCents / 100).toFixed(2) : ""
  );
  const [currency, setCurrency] = useState<string>(
    editing?.currency ?? products[0]?.priceCurrency ?? "CAD"
  );

  // Quantity
  const [qtyLocked, setQtyLocked] = useState(editing?.qtyLocked ?? true);
  const [qtyDefault, setQtyDefault] = useState(editing?.qtyDefault ?? 1);
  const [qtyMin, setQtyMin] = useState(editing?.qtyMin ?? 1);
  const [qtyMax, setQtyMax] = useState<string>(editing?.qtyMax != null ? String(editing.qtyMax) : "");
  // Phase I #12 (2026-09-22): editable amount at pay time.
  const [amountLocked, setAmountLocked] = useState<boolean>(
    (editing as { amountLocked?: boolean } | undefined)?.amountLocked ?? true
  );
  const [amountMinDollars, setAmountMinDollars] = useState<string>(() => {
    const v = (editing as { amountMinCents?: number | null } | undefined)?.amountMinCents;
    return v != null ? (v / 100).toFixed(2) : "";
  });
  const [amountMaxDollars, setAmountMaxDollars] = useState<string>(() => {
    const v = (editing as { amountMaxCents?: number | null } | undefined)?.amountMaxCents;
    return v != null ? (v / 100).toFixed(2) : "";
  });

  // Customer info fields
  const [requireName, setRequireName] = useState(editing?.requireName ?? true);
  const [requirePhone, setRequirePhone] = useState(editing?.requirePhone ?? false);
  const [requireCompany, setRequireCompany] = useState(editing?.requireCompany ?? false);

  // Advanced
  const [expiresAt, setExpiresAt] = useState<string>(
    editing?.expiresAt ? new Date(editing.expiresAt).toISOString().slice(0, 16) : ""
  );
  const [maxUses, setMaxUses] = useState<string>(
    editing?.maxUses != null ? String(editing.maxUses) : ""
  );
  const [redirectUrl, setRedirectUrl] = useState(editing?.redirectUrl ?? "");
  // Phase I #3 (2026-09-10): comma-separated emails that get notified
  // when a payment through this link succeeds.
  const [notifyEmails, setNotifyEmails] = useState(editing?.notifyEmails ?? "");
  const [descriptionOverride, setDescriptionOverride] = useState(editing?.descriptionOverride ?? "");
  const [partnerDisplayName, setPartnerDisplayName] = useState(editing?.partnerDisplayName ?? "");
  const [partnerLogoUrl, setPartnerLogoUrl] = useState(editing?.partnerLogoUrl ?? "");
  // Slug is immutable after create — we don't offer editing it, and hide
  // the input in edit mode below.
  const [customSlug, setCustomSlug] = useState("");

  // Phase I #5 v2 (2026-09-14): per-link webhook state.
  const DEFAULT_WEBHOOK_TEMPLATE = `{
  "event": "{{event.type}}",
  "event_id": "{{event.id}}",
  "amount": {{payment.amount}},
  "currency": "{{payment.currency}}",
  "customer_email": "{{customer.email}}",
  "invoice_number": "{{source.invoice.number}}",
  "payment_link_slug": "{{source.payment_link.slug}}"
}`;
  const [webhookOpen, setWebhookOpen] = useState<boolean>(
    Boolean(editing?.webhookUrl)
  );
  const [webhookUrl, setWebhookUrl] = useState(editing?.webhookUrl ?? "");
  const [webhookTemplate, setWebhookTemplate] = useState(
    editing?.webhookTemplate ?? DEFAULT_WEBHOOK_TEMPLATE
  );
  const [webhookEvents, setWebhookEvents] = useState<string[]>(
    editing?.webhookEvents?.length
      ? editing.webhookEvents
      : ["payment.succeeded"]
  );
  const [webhookEnabled, setWebhookEnabled] = useState<boolean>(
    editing?.webhookEnabled ?? true
  );
  // Phase I #5 v3 (2026-09-14): partner-supplied secret. Free-form
  // string — we store, echo back on edit, and use for HMAC signing IF
  // set. Empty = no signature header sent, URL-token / no-auth flows
  // still work.
  const [webhookSecret, setWebhookSecret] = useState<string>(
    editing?.webhookSecret ?? ""
  );
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    finalStatus?: number;
    errorMessage?: string;
    renderedBody?: string;
  } | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  function toggleWebhookEvent(e: string) {
    setWebhookEvents((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]
    );
  }

  // Recompute currency when product changes so the price hint stays honest.
  function onProductChange(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p) setCurrency(p.priceCurrency);
  }

  const selectedProduct = products.find((p) => p.id === productId);

  // Phase I #5 v2 (2026-09-14): fire a synthetic payment.succeeded to
  // this link's webhook. Only enabled in edit mode — new links need to
  // save first (secret is auto-generated at that point).
  async function sendTestEvent() {
    if (!isEdit || !editing) {
      toast.error("Save the link first, then send a test");
      return;
    }
    if (!webhookUrl.trim()) {
      toast.error("Set a webhook URL first");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(
        `/api/supplier/payment-links/${editing.id}/webhook-test`,
        { method: "POST" }
      );
      const data = await res.json();
      setTestResult({
        ok: data.ok,
        finalStatus: data.finalStatus,
        errorMessage: data.errorMessage,
        renderedBody: data.renderedBody,
      });
      if (data.ok) toast.success(`Delivered (HTTP ${data.finalStatus})`);
      else toast.error(
        data.errorMessage || (data.finalStatus ? `HTTP ${data.finalStatus}` : "Test failed")
      );
    } catch {
      toast.error("Network error");
    } finally {
      setTesting(false);
    }
  }

  async function submit() {
    if (!nickname.trim()) {
      toast.error("Nickname is required");
      return;
    }
    if (!productId && !isEdit) {
      toast.error("Pick a product");
      return;
    }

    setSaving(true);
    try {
      // Payload shape is the same for POST (create) and PATCH (update) —
      // the API handlers just whitelist the fields they accept per method.
      // In edit mode we intentionally skip productId / mode / interval —
      // changing the mode or product of an existing link would strand any
      // links customers have already bookmarked; supplier disables + creates.
      const body: Record<string, unknown> = {
        nickname: nickname.trim(),
        currency,
        qtyLocked,
        qtyDefault,
        qtyMin,
        qtyMax: qtyMax ? Number(qtyMax) : null,
        // Phase I #12 (2026-09-22): editable amount.
        amountLocked,
        amountMinCents: amountMinDollars.trim()
          ? Math.round(Number(amountMinDollars) * 100)
          : null,
        amountMaxCents: amountMaxDollars.trim()
          ? Math.round(Number(amountMaxDollars) * 100)
          : null,
        requireName,
        requirePhone,
        requireCompany,
        partnerRef: partnerRef.trim() || null,
      };
      if (!isEdit) {
        body.productId = productId;
        body.mode = mode;
        if (mode === "subscription") {
          body.interval = interval;
          body.intervalCount = intervalCount;
        }
      }
      // Price: dollars input → cents. Empty = fall back to product price.
      // Explicit null on edit so clearing the field removes the override.
      if (priceOverride.trim()) {
        const cents = Math.round(Number(priceOverride) * 100);
        if (Number.isFinite(cents) && cents > 0) body.unitAmountCents = cents;
      } else if (isEdit) {
        body.unitAmountCents = null;
      }
      if (advanced) {
        body.expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
        body.maxUses = maxUses ? Number(maxUses) : null;
        body.redirectUrl = redirectUrl.trim() || null;
        body.notifyEmails = notifyEmails.trim() || null;
        body.descriptionOverride = descriptionOverride.trim() || null;
        body.partnerDisplayName = partnerDisplayName.trim() || null;
        body.partnerLogoUrl = partnerLogoUrl.trim() || null;
        if (!isEdit && customSlug.trim()) body.customSlug = customSlug.trim();
      }

      // Phase I #5 v2 (2026-09-14): webhook fields. Always sent so the
      // partner can clear a webhook by opening the section, clearing
      // the URL, and saving (null value on PATCH removes it). When the
      // section was never opened on create, all fields stay at defaults
      // and the service persists null/[] which means "webhook off."
      if (webhookOpen && webhookUrl.trim()) {
        body.webhookUrl = webhookUrl.trim();
        body.webhookTemplate = webhookTemplate;
        body.webhookEvents = webhookEvents;
        body.webhookEnabled = webhookEnabled;
        // Phase I #5 v3 (2026-09-14): partner-supplied secret. Empty
        // string = clear it server-side (`webhookSecret: null`),
        // otherwise send the exact value they typed.
        body.webhookSecret = webhookSecret.trim() || null;
      } else if (isEdit) {
        // Explicit null clears the webhook on edit — supports "collapse
        // section = disable" without needing a separate delete action.
        body.webhookUrl = null;
        body.webhookTemplate = null;
        body.webhookEvents = [];
        body.webhookSecret = null;
      }

      const url = isEdit
        ? `/api/supplier/payment-links/${editing!.id}`
        : "/api/supplier/payment-links";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (isEdit ? "Failed to save changes" : "Failed to create link"));
      }
      toast.success(isEdit ? "Payment link updated" : "Payment link created");
      // Copy the URL immediately for new links (save the user a click on
      // the detail drawer). Skip on edit — they already have the URL.
      if (!isEdit && data.publicUrl) {
        try {
          await navigator.clipboard.writeText(data.publicUrl);
          toast.info("URL copied to clipboard");
        } catch {
          /* clipboard permission denied — non-fatal */
        }
      }
      await onCreated();
    } catch (err: any) {
      toast.error(err?.message || (isEdit ? "Failed to save changes" : "Failed to create link"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {isEdit ? "Edit Payment Link" : "New Payment Link"}
            </h2>
            <p className="text-sm text-gray-600 mt-0.5">
              {isEdit
                ? "Changes take effect immediately. The public URL and product stay the same."
                : "Share the URL; each click creates a fresh invoice."}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
            <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {products.length === 0 ? (
            <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-sm text-amber-900">
                You need at least one product to create a payment link.
                <a href="/supplier/products" className="ml-1 font-semibold underline">
                  Add a product first
                </a>
                .
              </p>
            </div>
          ) : (
            <>
              {/* Basics */}
              <section>
                <h3 className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">
                  Basics
                </h3>
                <label className="block mb-3">
                  <span className="text-sm font-medium text-gray-700">Product</span>
                  <select
                    value={productId}
                    onChange={(e) => onProductChange(e.target.value)}
                    disabled={isEdit}
                    className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {(p.wholesalePriceCents / 100).toFixed(2)} {p.priceCurrency}
                      </option>
                    ))}
                  </select>
                  {isEdit && (
                    <span className="text-xs text-gray-500 mt-1 block">
                      Product is locked on an existing link — disable and create a new one to switch products.
                    </span>
                  )}
                </label>
                <label className="block mb-3">
                  <span className="text-sm font-medium text-gray-700">Nickname</span>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Partner A — Retail"
                    className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    maxLength={120}
                  />
                  <span className="text-xs text-gray-500 mt-1 block">
                    Internal label — customers never see this.
                  </span>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">
                    Partner tag <span className="text-gray-400 font-normal">(optional)</span>
                  </span>
                  <input
                    type="text"
                    value={partnerRef}
                    onChange={(e) => setPartnerRef(e.target.value)}
                    placeholder="widget_weekly_website"
                    className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm font-mono"
                    maxLength={120}
                  />
                  <span className="text-xs text-gray-500 mt-1 block">
                    Free-text attribution — shows on generated invoices, filterable in reports.
                  </span>
                </label>
              </section>

              {/* Payment */}
              <section>
                <h3 className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">
                  Payment
                </h3>
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => !isEdit && setMode("one_time")}
                    disabled={isEdit}
                    className={`flex-1 px-4 py-3 rounded-lg text-sm font-semibold border-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                      mode === "one_time"
                        ? "bg-indigo-50 border-indigo-500 text-indigo-700"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Icon icon="solar:cart-large-bold" className="w-5 h-5 mx-auto mb-1" />
                    One-time
                  </button>
                  <button
                    type="button"
                    onClick={() => !isEdit && setMode("subscription")}
                    disabled={isEdit}
                    className={`flex-1 px-4 py-3 rounded-lg text-sm font-semibold border-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                      mode === "subscription"
                        ? "bg-indigo-50 border-indigo-500 text-indigo-700"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Icon icon="solar:refresh-circle-bold" className="w-5 h-5 mx-auto mb-1" />
                    Subscription
                  </button>
                </div>
                {isEdit && (
                  <div className="text-xs text-gray-500 mb-3 -mt-1">
                    Mode + interval locked on an existing link — customers who already bookmarked the URL expect the same billing cadence.
                  </div>
                )}

                {mode === "subscription" && (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Every</span>
                      <input
                        type="number"
                        min={1}
                        value={intervalCount}
                        onChange={(e) => setIntervalCount(Math.max(1, Number(e.target.value)))}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Period</span>
                      <select
                        value={interval}
                        onChange={(e) => setInterval(e.target.value as any)}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      >
                        <option value="day">day{intervalCount === 1 ? "" : "s"}</option>
                        <option value="week">week{intervalCount === 1 ? "" : "s"}</option>
                        <option value="month">month{intervalCount === 1 ? "" : "s"}</option>
                        <option value="year">year{intervalCount === 1 ? "" : "s"}</option>
                      </select>
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <label className="col-span-2 block">
                    <span className="text-sm font-medium text-gray-700">
                      Price override <span className="text-gray-400 font-normal">(optional)</span>
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={priceOverride}
                      onChange={(e) => setPriceOverride(e.target.value)}
                      placeholder={
                        selectedProduct
                          ? `Product default: ${(selectedProduct.wholesalePriceCents / 100).toFixed(2)}`
                          : "0.00"
                      }
                      className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">Currency</span>
                    <div className="mt-1 flex gap-2">
                      <select
                        value={
                          ["CAD","USD","EUR","GBP","INR","AED","AUD","JPY"].includes(currency)
                            ? currency
                            : "__custom__"
                        }
                        onChange={(e) => {
                          if (e.target.value !== "__custom__") setCurrency(e.target.value);
                        }}
                        className="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      >
                        <option value="CAD">CAD — Canadian Dollar</option>
                        <option value="USD">USD — US Dollar</option>
                        <option value="EUR">EUR — Euro</option>
                        <option value="GBP">GBP — British Pound</option>
                        <option value="INR">INR — Indian Rupee</option>
                        <option value="AED">AED — UAE Dirham</option>
                        <option value="AUD">AUD — Australian Dollar</option>
                        <option value="JPY">JPY — Japanese Yen</option>
                        <option value="__custom__">Custom…</option>
                      </select>
                      <input
                        type="text"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                        maxLength={3}
                        className="w-20 rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm font-mono uppercase text-center"
                        placeholder="XXX"
                        aria-label="ISO 4217 currency code"
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Any ISO 4217 currency Stripe supports works. Settlement to
                      your bank depends on your Stripe account&apos;s country.
                    </p>
                  </label>
                </div>

                {/* Editable amount toggle — Phase I #12 */}
                <div className="mt-4">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!amountLocked}
                      onChange={(e) => setAmountLocked(!e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-gray-800">
                        Let the customer edit the amount at pay time
                      </span>
                      <span className="block text-xs text-gray-500 mt-0.5">
                        The price above becomes the suggested / default amount.
                        Customer can type any value within the min/max bounds below.
                      </span>
                    </span>
                  </label>
                  {!amountLocked && (
                    <div className="mt-3 grid grid-cols-2 gap-3 pl-6">
                      <label className="block">
                        <span className="text-xs font-medium text-gray-600">
                          Minimum ({currency}) — optional
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          value={amountMinDollars}
                          onChange={(e) => setAmountMinDollars(e.target.value)}
                          placeholder="e.g. 5.00"
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-gray-600">
                          Maximum ({currency}) — optional
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          value={amountMaxDollars}
                          onChange={(e) => setAmountMaxDollars(e.target.value)}
                          placeholder="e.g. 500.00"
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                        />
                      </label>
                      <p className="col-span-2 text-xs text-gray-500">
                        Leave both empty for a truly &ldquo;pay what you want&rdquo; link.
                        Use case: donations, top-ups, tipping.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Quantity */}
              <section>
                <h3 className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">
                  Quantity
                </h3>
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setQtyLocked(true)}
                    className={`flex-1 px-4 py-3 rounded-lg text-sm font-semibold border-2 transition-colors ${
                      qtyLocked
                        ? "bg-indigo-50 border-indigo-500 text-indigo-700"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Lock at fixed quantity
                  </button>
                  <button
                    type="button"
                    onClick={() => setQtyLocked(false)}
                    className={`flex-1 px-4 py-3 rounded-lg text-sm font-semibold border-2 transition-colors ${
                      !qtyLocked
                        ? "bg-indigo-50 border-indigo-500 text-indigo-700"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Customer picks
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">
                      {qtyLocked ? "Quantity" : "Default"}
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={qtyDefault}
                      onChange={(e) => setQtyDefault(Math.max(1, Number(e.target.value)))}
                      className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                    />
                  </label>
                  {!qtyLocked && (
                    <>
                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">Min</span>
                        <input
                          type="number"
                          min={1}
                          value={qtyMin}
                          onChange={(e) => setQtyMin(Math.max(1, Number(e.target.value)))}
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">
                          Max <span className="text-gray-400 font-normal">(blank = ∞)</span>
                        </span>
                        <input
                          type="number"
                          min={1}
                          value={qtyMax}
                          onChange={(e) => setQtyMax(e.target.value)}
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                        />
                      </label>
                    </>
                  )}
                </div>
                <div className="mt-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-2">
                  <strong>Rule:</strong> if the URL has <code className="text-gray-800">?qty=N</code>,
                  the checkout locks at that value (clamped to min/max). Otherwise this
                  config applies.
                </div>
              </section>

              {/* Customer info */}
              <section>
                <h3 className="text-xs font-semibold uppercase text-gray-500 tracking-wider mb-3">
                  Required customer info
                </h3>
                <div className="space-y-2">
                  <div className="text-sm text-gray-600 mb-2">
                    Email is always required. Toggle the others as needed:
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireName}
                      onChange={(e) => setRequireName(e.target.checked)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Full name</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requirePhone}
                      onChange={(e) => setRequirePhone(e.target.checked)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Phone number</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireCompany}
                      onChange={(e) => setRequireCompany(e.target.checked)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">Company</span>
                  </label>
                </div>
              </section>

              {/* Advanced (collapsible) */}
              <section>
                <button
                  type="button"
                  onClick={() => setAdvanced(!advanced)}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                >
                  <Icon
                    icon={advanced ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"}
                    className="w-4 h-4"
                  />
                  Advanced options
                </button>
                {advanced && (
                  <div className="mt-3 space-y-3 pl-4 border-l-2 border-indigo-100">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Expires at</span>
                      <input
                        type="datetime-local"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Max uses</span>
                      <input
                        type="number"
                        min={1}
                        value={maxUses}
                        onChange={(e) => setMaxUses(e.target.value)}
                        placeholder="Unlimited"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Redirect after payment</span>
                      <input
                        type="url"
                        value={redirectUrl}
                        onChange={(e) => setRedirectUrl(e.target.value)}
                        placeholder="https://widgetweekly.com/thanks"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">
                        Notify email(s) on payment
                      </span>
                      <input
                        type="text"
                        value={notifyEmails}
                        onChange={(e) => setNotifyEmails(e.target.value)}
                        placeholder="sales@widgetweekly.com, ops@widgetweekly.com"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Comma-separated. We&apos;ll email these addresses when
                        a payment through this link succeeds. Customer always
                        gets their own receipt.
                      </p>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Description override</span>
                      <textarea
                        rows={2}
                        value={descriptionOverride}
                        onChange={(e) => setDescriptionOverride(e.target.value)}
                        placeholder="Custom description shown on checkout (else uses product's)"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">
                        Partner display name (for co-branding)
                      </span>
                      <input
                        type="text"
                        value={partnerDisplayName}
                        onChange={(e) => setPartnerDisplayName(e.target.value)}
                        placeholder="Widget Weekly"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Partner logo URL</span>
                      <input
                        type="url"
                        value={partnerLogoUrl}
                        onChange={(e) => setPartnerLogoUrl(e.target.value)}
                        placeholder="https://widgetweekly.com/logo.png"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                    </label>
                    {!isEdit && (
                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">
                          Custom slug <span className="text-gray-400 font-normal">(optional)</span>
                        </span>
                        <input
                          type="text"
                          value={customSlug}
                          onChange={(e) => setCustomSlug(e.target.value)}
                          placeholder="widget-pro"
                          className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm font-mono"
                        />
                        <span className="text-xs text-gray-500 mt-1 block">
                          URL suffix. If taken, a random suffix will be appended.
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </section>

              {/* Phase I #5 v2 (2026-09-14): per-link outbound webhook.
                  Top-level section (not nested under Advanced) because
                  it's the primary reason each partner has their own link
                  — different partner = different webhook. */}
              <section>
                <button
                  type="button"
                  onClick={() => setWebhookOpen((v) => !v)}
                  className="w-full flex items-center justify-between py-2 text-sm font-semibold text-gray-800 hover:text-gray-900"
                >
                  <span className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${webhookUrl.trim() && webhookEnabled ? "bg-emerald-500" : "bg-gray-300"}`} />
                    Webhook notification
                    {webhookUrl.trim() && (
                      <span className="text-xs font-normal text-gray-500 truncate max-w-[280px]">
                        → {webhookUrl}
                      </span>
                    )}
                  </span>
                  <span className="text-gray-400">{webhookOpen ? "−" : "+"}</span>
                </button>
                {webhookOpen && (
                  <div className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                    <p className="text-xs text-gray-600">
                      When a payment through this link succeeds, we POST your JSON
                      template to the URL below, signed with HMAC-SHA256 in
                      <code className="mx-1 rounded bg-white px-1 py-0.5">X-Payment-Signature</code>.
                      Different link, different partner, different endpoint.
                    </p>

                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Endpoint URL</span>
                      <input
                        type="url"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder="https://partner-a.com/api/oreugo-webhook"
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm"
                      />
                    </label>

                    <div>
                      <span className="text-sm font-medium text-gray-700 block mb-1.5">Events</span>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: "payment.succeeded", label: "Payment succeeded" },
                          { id: "payment.failed", label: "Payment failed" },
                          { id: "payment.refunded", label: "Payment refunded" },
                        ].map((e) => (
                          <label
                            key={e.id}
                            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={webhookEvents.includes(e.id)}
                              onChange={() => toggleWebhookEvent(e.id)}
                            />
                            <span className="font-mono">{e.id}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Body template</span>
                      <textarea
                        rows={12}
                        spellCheck={false}
                        value={webhookTemplate}
                        onChange={(e) => setWebhookTemplate(e.target.value)}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs font-mono"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Placeholders: <code>{"{{event.type}}"}</code>{" "}
                        <code>{"{{payment.amount}}"}</code>{" "}
                        <code>{"{{customer.email}}"}</code>{" "}
                        <code>{"{{source.invoice.number}}"}</code>{" "}
                        <code>{"{{source.payment_link.slug}}"}</code>{" "}
                        <code>{"{{.}}"}</code> for the whole context. Missing
                        paths render as empty. Amount is in cents (integer).
                      </p>
                    </label>

                    {/* Phase I #5 v3 (2026-09-14): partner-supplied
                        secret. Optional — set it if the partner's
                        endpoint expects a shared token OR if they
                        want HMAC signature verification. We send it
                        as `X-Payment-Signature` (HMAC-SHA256 of body)
                        when present, and expose it in the template
                        as `{{webhook.secret}}` so partners can also
                        drop it into URLs or body fields as-is. */}
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">
                        Secret / token <span className="text-gray-400 font-normal">(optional)</span>
                      </span>
                      <div className="mt-1 relative">
                        <input
                          type={showSecret ? "text" : "password"}
                          value={webhookSecret}
                          onChange={(e) => setWebhookSecret(e.target.value)}
                          placeholder="whsec_your_shared_token"
                          autoComplete="off"
                          spellCheck={false}
                          className="w-full pr-16 rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-800 px-2 py-0.5"
                        >
                          {showSecret ? "Hide" : "Show"}
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Provided by the partner (we don&apos;t generate this).
                        When set, we send <code>X-Payment-Signature</code>
                        (HMAC-SHA256 of the body) so partner can verify.
                        Also available in the template as{" "}
                        <code>{"{{webhook.secret}}"}</code> — drop into a URL
                        query, body field, or wherever the partner expects it.
                        Leave empty for simple URL-token auth.
                      </p>
                    </label>

                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={webhookEnabled}
                        onChange={(e) => setWebhookEnabled(e.target.checked)}
                      />
                      Enabled (uncheck to pause without deleting the config)
                    </label>

                    {isEdit && (
                      <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                        <button
                          type="button"
                          onClick={() => void sendTestEvent()}
                          disabled={testing || !webhookUrl.trim()}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                        >
                          {testing ? "Sending…" : "Send test event"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setLogOpen(true)}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                        >
                          View delivery log
                        </button>
                      </div>
                    )}

                    {testResult && (
                      <div
                        className={`rounded-lg border p-3 text-xs ${
                          testResult.ok
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-red-200 bg-red-50 text-red-900"
                        }`}
                      >
                        <p className="font-medium mb-1">
                          {testResult.ok ? "✓ Delivered" : "✗ Failed"}
                          {testResult.finalStatus && ` — HTTP ${testResult.finalStatus}`}
                        </p>
                        {testResult.errorMessage && (
                          <p className="mb-1">Error: {testResult.errorMessage}</p>
                        )}
                        {testResult.renderedBody && (
                          <details className="mt-2">
                            <summary className="cursor-pointer font-medium">Rendered body</summary>
                            <pre className="mt-2 overflow-x-auto rounded bg-white/60 p-2 font-mono">
                              {testResult.renderedBody}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Phase I #5 v3 (2026-09-14): removed the one-shot secret banner —
            partner types their own secret now, so there's nothing new
            to reveal on save. */}

        {logOpen && editing && (
          <DeliveryLogPanel
            paymentLinkId={editing.id}
            onClose={() => setLogOpen(false)}
          />
        )}

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || (products.length === 0 && !isEdit)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg disabled:opacity-50"
          >
            {saving && <Icon icon="solar:refresh-linear" className="w-4 h-4 animate-spin" />}
            {isEdit ? "Save changes" : "Create link"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Delivery log panel (Phase I #5 v2) ----------------

interface Delivery {
  id: string;
  eventType: string;
  eventId: string;
  url: string;
  requestBody: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  durationMs: number | null;
  attempt: number;
  succeeded: boolean;
  errorMessage: string | null;
  createdAt: string;
}

function DeliveryLogPanel({
  paymentLinkId,
  onClose,
}: {
  paymentLinkId: string;
  onClose: () => void;
}) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(
          `/api/supplier/payment-links/${paymentLinkId}/webhook-deliveries?limit=50`
        );
        const data = await res.json();
        if (res.ok) setDeliveries(data.deliveries || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [paymentLinkId]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Webhook delivery log</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl"
          >
            ×
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-gray-500">
              No delivery attempts yet. Pay through this link, or click{" "}
              <strong>Send test event</strong> in the webhook section.
            </p>
          ) : (
            <ul className="space-y-2">
              {deliveries.map((d) => (
                <li
                  key={d.id}
                  className="rounded-lg border border-gray-100 bg-white p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          d.succeeded ? "bg-emerald-500" : "bg-red-500"
                        }`}
                      />
                      <span className="font-mono font-medium">{d.eventType}</span>
                      <span className="text-gray-400">·</span>
                      <span className="font-mono text-gray-500">{d.eventId}</span>
                    </div>
                    <span className="text-gray-500 tabular-nums">
                      {d.responseStatus ? `HTTP ${d.responseStatus}` : "network err"}
                      {d.durationMs != null && ` · ${d.durationMs}ms`}
                      {d.attempt > 1 && ` · try ${d.attempt}`}
                    </span>
                  </div>
                  <div className="mt-1 text-gray-500">
                    {new Date(d.createdAt).toLocaleString()}
                  </div>
                  {d.errorMessage && (
                    <p className="mt-1 text-red-700">{d.errorMessage}</p>
                  )}
                  {(d.requestBody || d.responseBody) && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-gray-600 hover:text-gray-900">
                        Request / response
                      </summary>
                      <div className="mt-2 space-y-2">
                        {d.requestBody && (
                          <div>
                            <p className="font-semibold text-gray-700">Request body</p>
                            <pre className="overflow-x-auto rounded bg-gray-50 p-2 font-mono text-[10px]">
                              {d.requestBody}
                            </pre>
                          </div>
                        )}
                        {d.responseBody && (
                          <div>
                            <p className="font-semibold text-gray-700">Response body</p>
                            <pre className="overflow-x-auto rounded bg-gray-50 p-2 font-mono text-[10px]">
                              {d.responseBody}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
