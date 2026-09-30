"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Profile {
  legalName: string | null;
  displayName: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  aboutText: string | null;
  warehouseAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  } | null;
  categories: string[];
  minOrderCents: number;
  defaultLeadDays: number;
  // Phase D #75: default payment terms — days after PO submission before
  // the balance is considered "due" for the AR aging report.
  defaultNetTermsDays: number;
  currency: string;
  isPublic: boolean;
  onboardingStatus: string;
}

// Phase H #5 (2026-09-02): billing defaults surfaced from
// Tenant.currency + TenantSettings.tax*. Invoice modal auto-fills tax
// from these; supplier can still override per-invoice.
interface TaxSettings {
  taxEnabled: boolean;
  taxRate: number;
  taxLabel: string;
}

export default function SupplierSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [categoriesInput, setCategoriesInput] = useState("");
  const [tax, setTax] = useState<TaxSettings>({
    taxEnabled: true, taxRate: 13, taxLabel: "HST",
  });

  useEffect(() => {
    fetch("/api/supplier/me")
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.profile) {
          setProfile(json.profile);
          setCategoriesInput((json.profile.categories || []).join(", "));
        }
        if (json.taxSettings) {
          setTax({
            taxEnabled: Boolean(json.taxSettings.taxEnabled),
            taxRate: Number(json.taxSettings.taxRate) || 0,
            taxLabel: String(json.taxSettings.taxLabel || "HST"),
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    if (!profile) return;
    setProfile({ ...profile, [key]: value });
  };

  const updateAddress = (patch: Partial<NonNullable<Profile["warehouseAddress"]>>) => {
    if (!profile) return;
    setProfile({
      ...profile,
      warehouseAddress: { ...(profile.warehouseAddress || {}), ...patch },
    });
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const res = await fetch("/api/supplier/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName: profile.legalName,
          displayName: profile.displayName,
          websiteUrl: profile.websiteUrl,
          contactEmail: profile.contactEmail,
          contactPhone: profile.contactPhone,
          aboutText: profile.aboutText,
          warehouseAddress: profile.warehouseAddress,
          categories: categoriesInput
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          minOrderCents: profile.minOrderCents,
          defaultLeadDays: profile.defaultLeadDays,
          defaultNetTermsDays: profile.defaultNetTermsDays,
          // Phase H #5: tenant-level billing defaults for invoicing.
          currency: profile.currency,
          taxEnabled: tax.taxEnabled,
          taxRate: tax.taxRate,
          taxLabel: tax.taxLabel,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Profile updated");
        setProfile(data.profile);
      } else {
        toast.error(data.error || "Save failed");
      }
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !profile) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4 max-w-3xl">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-100 rounded-2xl" />
          <div className="h-64 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  const address = profile.warehouseAddress || {};

  return (
    <div className="p-6 lg:p-10 max-w-3xl mx-auto pb-32">
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">
          Your business profile — what merchants see when they view you in the
          marketplace.
        </p>
      </div>

      {/* Phase F #6d (2026-08-27): quick jump to Stripe settings so it's
          discoverable both from here and from /supplier/payments. */}
      <a
        href="/supplier/settings/payments"
        className="mb-3 flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50/60 p-4 hover:bg-teal-50 transition-colors"
      >
        <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
          <Icon icon="solar:key-bold-duotone" className="w-5 h-5 text-teal-700" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-teal-900">Stripe API keys &amp; webhook</p>
          <p className="text-sm text-teal-800/80">
            Bring your own Stripe account to accept card payments on invoices.
          </p>
        </div>
        <Icon icon="solar:arrow-right-linear" className="w-5 h-5 text-teal-700 flex-shrink-0" />
      </a>

      {/* Phase I #5 v2 (2026-09-14): webhooks moved from global settings
          to per-payment-link (each link goes to a different partner, so
          URL + template + secret live on the link itself). Configure
          when creating or editing a payment link. */}

      {/* Phase I #6 (2026-09-18): quick jump to Payments API keys. */}
      <a
        href="/supplier/settings/api-keys"
        className="mb-6 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 hover:bg-indigo-50 transition-colors"
      >
        <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
          <Icon icon="solar:code-square-bold-duotone" className="w-5 h-5 text-indigo-700" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-indigo-900">Payments API keys</p>
          <p className="text-sm text-indigo-800/80">
            Mint bearer keys so your other systems can POST payments and get a hosted checkout URL back.
          </p>
        </div>
        <Icon icon="solar:arrow-right-linear" className="w-5 h-5 text-indigo-700 flex-shrink-0" />
      </a>

      {/* Business info card */}
      <Card title="Business Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Display name"
            hint="Shown to merchants"
            value={profile.displayName || ""}
            onChange={(v) => update("displayName", v)}
          />
          <Field
            label="Legal name"
            hint="For payment gateway applications"
            value={profile.legalName || ""}
            onChange={(v) => update("legalName", v)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <Field
            label="Contact email"
            type="email"
            value={profile.contactEmail || ""}
            onChange={(v) => update("contactEmail", v)}
          />
          <Field
            label="Contact phone"
            type="tel"
            value={profile.contactPhone || ""}
            onChange={(v) => update("contactPhone", v)}
          />
        </div>
        <div className="mt-4">
          <Field
            label="Website"
            type="url"
            placeholder="https://…"
            value={profile.websiteUrl || ""}
            onChange={(v) => update("websiteUrl", v)}
          />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            About your business
          </label>
          <textarea
            rows={4}
            value={profile.aboutText || ""}
            onChange={(e) => update("aboutText", e.target.value)}
            placeholder="Tell merchants about your business, what you specialize in, delivery zones…"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      </Card>

      {/* Categories card */}
      <Card title="Product Categories" className="mt-6">
        <p className="text-sm text-gray-500 mb-3">
          Comma-separated tags for what you sell. Helps merchants find you.
        </p>
        <input
          type="text"
          value={categoriesInput}
          onChange={(e) => setCategoriesInput(e.target.value)}
          placeholder="dairy, produce, packaging, beverages"
          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
        />
        {categoriesInput.trim() && (
          <div className="flex flex-wrap gap-2 mt-3">
            {categoriesInput
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean)
              .map((c) => (
                <span
                  key={c}
                  className="text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-medium"
                >
                  {c}
                </span>
              ))}
          </div>
        )}
      </Card>

      {/* Warehouse address card */}
      <Card title="Warehouse / Shipping Origin" className="mt-6">
        <p className="text-sm text-gray-500 mb-4">
          Where you ship from. Used for delivery zone + lead time estimates.
        </p>
        <Field
          label="Address line 1"
          value={address.line1 || ""}
          onChange={(v) => updateAddress({ line1: v })}
        />
        <div className="mt-4">
          <Field
            label="Address line 2 (optional)"
            value={address.line2 || ""}
            onChange={(v) => updateAddress({ line2: v })}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <Field
            label="City"
            value={address.city || ""}
            onChange={(v) => updateAddress({ city: v })}
          />
          <Field
            label="Province / State"
            value={address.region || ""}
            onChange={(v) => updateAddress({ region: v })}
          />
          <Field
            label="Postal / ZIP"
            value={address.postalCode || ""}
            onChange={(v) => updateAddress({ postalCode: v })}
          />
        </div>
        <div className="mt-4">
          <Field
            label="Country"
            value={address.country || ""}
            onChange={(v) => updateAddress({ country: v })}
          />
        </div>
      </Card>

      {/* Phase H #5 (2026-09-02): Billing & Tax card.
          Default currency lives on Tenant; tax fields on TenantSettings.
          Invoice modal reads these on open and auto-fills so the vendor
          never has to remember to type HST 13% again. */}
      <Card title="Billing & Tax" className="mt-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Default currency
            </label>
            <select
              value={profile.currency}
              onChange={(e) => update("currency", e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none bg-white"
            >
              {["CAD","USD","GBP","EUR","INR","AED","AUD","JPY"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Every invoice you create defaults to this currency.
              You can still switch per invoice.
            </p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
              <input
                type="checkbox"
                checked={tax.taxEnabled}
                onChange={(e) => setTax({ ...tax, taxEnabled: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              Charge tax on invoices
            </label>
            <p className="text-xs text-gray-400 mt-1">
              When off, tax on new invoices defaults to zero.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Tax label
            </label>
            <input
              type="text"
              maxLength={20}
              value={tax.taxLabel}
              onChange={(e) => setTax({ ...tax, taxLabel: e.target.value })}
              placeholder="HST"
              disabled={!tax.taxEnabled}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <p className="text-xs text-gray-400 mt-1">
              Shown on the invoice pay page: "Tax (HST)", "Tax (GST)", "Tax (VAT)".
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Default tax rate (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={tax.taxRate}
              onChange={(e) =>
                setTax({ ...tax, taxRate: Math.max(0, Math.min(100, parseFloat(e.target.value || "0"))) })
              }
              disabled={!tax.taxEnabled}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <p className="text-xs text-gray-400 mt-1">
              Auto-applied to every new invoice as{" "}
              <span className="font-mono">subtotal × {tax.taxRate}%</span>. Editable per invoice.
            </p>
          </div>
        </div>
      </Card>

      {/* Order rules card */}
      <Card title="Order Rules" className="mt-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Minimum order ({profile.currency})
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={(profile.minOrderCents / 100).toString()}
              onChange={(e) =>
                update(
                  "minOrderCents",
                  Math.max(0, Math.round(parseFloat(e.target.value || "0") * 100))
                )
              }
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              Merchants must reach this total before checkout.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Default lead time (days)
            </label>
            <input
              type="number"
              min={0}
              max={90}
              value={profile.defaultLeadDays}
              onChange={(e) =>
                update("defaultLeadDays", Math.max(0, parseInt(e.target.value || "0", 10)))
              }
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              Typical delivery time from order to arrival.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Payment terms (Net days)
            </label>
            <input
              type="number"
              min={0}
              max={180}
              value={profile.defaultNetTermsDays ?? 30}
              onChange={(e) =>
                update(
                  "defaultNetTermsDays",
                  Math.max(0, parseInt(e.target.value || "0", 10))
                )
              }
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              Days after submission a PO is considered due. 30 = Net 30. Drives
              the AR aging report.
            </p>
          </div>
        </div>
      </Card>

      {/* Marketplace visibility (read-only in Phase A) */}
      <Card title="Marketplace Visibility" className="mt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">
              {profile.isPublic
                ? "Public — listed in marketplace"
                : "Private — only invited merchants"}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {profile.isPublic
                ? "Any merchant on iTap POS can find you and place orders."
                : "Only merchants who invited you can see your catalog."}
            </p>
          </div>
          <span className="text-xs text-gray-400 italic">
            Toggle unlocks after catalog setup (Phase B)
          </span>
        </div>
      </Card>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 lg:left-64 right-0 bg-white border-t border-gray-200 px-6 py-3 flex justify-end gap-3 z-30">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-60"
        >
          <Icon icon="solar:diskette-bold" className="w-4 h-4" />
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ----- small local UI helpers -----

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 ${className || ""}`}>
      <div className="p-5 border-b border-gray-100">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
      />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
