"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Select, Card, Toggle } from "@/components/ui";

interface Settings {
  businessName: string;
  currency: string;
  timezone: string;
  taxRate: number;
  orderNumberPrefix: string;
  autoAcceptOrders: boolean;
  requireTableForDineIn: boolean;
  allowTips: boolean;
  tipPercentages: number[];
  kitchenDisplayAutoRefresh: number;
  lowStockAlerts: boolean;
  receiptHeader: string;
  receiptFooter: string;
  // Table Ordering settings
  tableOrderingEnabled: boolean;
  tablePaymentType: "UPFRONT" | "PAY_AT_END";
  allowGuestOrdering: boolean;
  // Cash discount / dual pricing
  cashDiscountEnabled: boolean;
  cashDiscountPercent: number;
  cashDiscountMode: "SURCHARGE" | "DISCOUNT";
  cashDiscountLabel: string;
  // Brand logo shown in the admin sidebar + partner pages
  brandLogoUrl: string;
}

const CURRENCIES = [
  { value: "CAD", label: "Canadian Dollar (CAD)" },
  { value: "USD", label: "US Dollar (USD)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "GBP", label: "British Pound (GBP)" },
  { value: "AUD", label: "Australian Dollar (AUD)" },
];

const TIMEZONES = [
  { value: "America/Toronto", label: "Toronto (EST)" },
  { value: "America/Vancouver", label: "Vancouver (PST)" },
  { value: "America/New_York", label: "New York (EST)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PST)" },
  { value: "America/Chicago", label: "Chicago (CST)" },
  { value: "Europe/London", label: "London (GMT)" },
  { value: "Europe/Paris", label: "Paris (CET)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
];

export default function SettingsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "orders" | "kitchen" | "receipts" | "tables">("general");
  const [businessType, setBusinessType] = useState("restaurant");

  const [settings, setSettings] = useState<Settings>({
    businessName: "",
    currency: "CAD",
    timezone: "America/Toronto",
    taxRate: 13,
    orderNumberPrefix: "",
    autoAcceptOrders: true,
    requireTableForDineIn: true,
    allowTips: true,
    tipPercentages: [15, 18, 20, 25],
    kitchenDisplayAutoRefresh: 5,
    lowStockAlerts: true,
    receiptHeader: "",
    receiptFooter: "",
    // Table Ordering defaults
    tableOrderingEnabled: true,
    tablePaymentType: "UPFRONT",
    allowGuestOrdering: true,
    // Cash discount defaults — off by default; merchant opts in
    cashDiscountEnabled: false,
    cashDiscountPercent: 3,
    cashDiscountMode: "SURCHARGE",
    cashDiscountLabel: "",
    brandLogoUrl: "",
  });

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  // Kitchen Display URL includes tenantId + locationId, so the tab needs
  // to know the tenant's default location. Fetched alongside settings.
  const [defaultLocationId, setDefaultLocationId] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    if (!tenantId) return;

    try {
      const [res, locRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/settings`),
        fetch(`/api/tenants/${tenantId}/locations`),
      ]);
      const data = await res.json();
      const locData = await locRes.json();
      if (locData.success && Array.isArray(locData.locations)) {
        // Prefer isDefault=true; fall back to the first active location.
        const def =
          locData.locations.find((l: any) => l.isDefault) ||
          locData.locations[0];
        if (def) setDefaultLocationId(def.id);
      }

      if (data.success && data.tenant) {
        if (data.tenant.businessType) setBusinessType(data.tenant.businessType);
        setSettings({
          businessName: data.tenant.name || "",
          currency: data.tenant.currency || "CAD",
          timezone: data.tenant.timezone || "America/Toronto",
          taxRate: data.tenant.settings?.taxRate || 13,
          orderNumberPrefix: data.tenant.settings?.orderNumberPrefix || "",
          autoAcceptOrders: data.tenant.settings?.autoAcceptOrders ?? true,
          requireTableForDineIn: data.tenant.settings?.requireTableForDineIn ?? true,
          allowTips: data.tenant.settings?.allowTips ?? true,
          tipPercentages: data.tenant.settings?.tipPercentages || [15, 18, 20, 25],
          kitchenDisplayAutoRefresh: data.tenant.settings?.kitchenDisplayAutoRefresh || 5,
          lowStockAlerts: data.tenant.settings?.lowStockAlerts ?? true,
          receiptHeader: data.tenant.settings?.receiptHeader || "",
          receiptFooter: data.tenant.settings?.receiptFooter || "",
          // Table Ordering settings
          tableOrderingEnabled: data.tenant.settings?.tableOrderingEnabled ?? true,
          tablePaymentType: data.tenant.settings?.tablePaymentType || "UPFRONT",
          allowGuestOrdering: data.tenant.settings?.allowGuestOrdering ?? true,
          // Cash discount
          cashDiscountEnabled: data.tenant.settings?.cashDiscountEnabled ?? false,
          cashDiscountPercent: Number(data.tenant.settings?.cashDiscountPercent) || 3,
          cashDiscountMode: (data.tenant.settings?.cashDiscountMode || "SURCHARGE") as "SURCHARGE" | "DISCOUNT",
          cashDiscountLabel: data.tenant.settings?.cashDiscountLabel || "",
          brandLogoUrl: data.tenant.settings?.brandLogoUrl || "",
        });
      }
    } catch (error) {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);

    try {
      const res = await fetch(`/api/tenants/${tenantId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: settings.businessName,
          currency: settings.currency,
          timezone: settings.timezone,
          settings: {
            taxRate: settings.taxRate,
            orderNumberPrefix: settings.orderNumberPrefix,
            autoAcceptOrders: settings.autoAcceptOrders,
            requireTableForDineIn: settings.requireTableForDineIn,
            allowTips: settings.allowTips,
            tipPercentages: settings.tipPercentages,
            kitchenDisplayAutoRefresh: settings.kitchenDisplayAutoRefresh,
            lowStockAlerts: settings.lowStockAlerts,
            receiptHeader: settings.receiptHeader,
            receiptFooter: settings.receiptFooter,
            // Table Ordering settings
            tableOrderingEnabled: settings.tableOrderingEnabled,
            tablePaymentType: settings.tablePaymentType,
            allowGuestOrdering: settings.allowGuestOrdering,
            // Cash discount
            cashDiscountEnabled: settings.cashDiscountEnabled,
            cashDiscountPercent: settings.cashDiscountPercent,
            cashDiscountMode: settings.cashDiscountMode,
            cashDiscountLabel: settings.cashDiscountLabel || null,
            // Branding
            brandLogoUrl: settings.brandLogoUrl || null,
          },
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Settings saved successfully");
      } else {
        toast.error(data.error || "Failed to save settings");
      }
    } catch (error) {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key: keyof Settings, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Please select a business first</p>
      </div>
    );
  }

  const isSalon = businessType === "salon";
  const isRetail = businessType === "retail";
  const isCab = businessType === "cab";
  const isRestaurant = !isSalon && !isRetail && !isCab;

  const tabs = [
    { id: "general", label: "General", icon: "solar:settings-linear" },
    ...(isRestaurant ? [
      { id: "orders", label: "Orders", icon: "solar:bag-2-linear" },
      { id: "tables", label: "Table Ordering", icon: "solar:qr-code-linear" },
      { id: "kitchen", label: "Kitchen", icon: "solar:chef-hat-linear" },
    ] : []),
    ...(isRetail ? [
      { id: "orders", label: "Orders", icon: "solar:bag-2-linear" },
    ] : []),
    ...(isCab ? [
      { id: "orders", label: "Trips & Dispatch", icon: "solar:route-linear" },
    ] : []),
    ...(!isCab ? [
      { id: "receipts", label: "Receipts", icon: "solar:document-text-linear" },
    ] : []),
  ];

  return (
    <div>
      <AdminHeader
        title="Settings"
        subtitle="Configure your POS system"
        actions={
          <Button icon="solar:check-circle-bold" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        }
      />

      <div className="p-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? "bg-indigo-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Icon icon={tab.icon} className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <Card>
            <div className="animate-pulse space-y-4">
              <div className="h-10 bg-gray-200 rounded w-1/3" />
              <div className="h-10 bg-gray-200 rounded w-full" />
              <div className="h-10 bg-gray-200 rounded w-2/3" />
            </div>
          </Card>
        ) : (
          <>
            {/* General Settings */}
            {activeTab === "general" && (
              <div className="space-y-6">
                <Card title="Business Information">
                  <div className="space-y-4">
                    {/* Logo upload — shown in admin sidebar + partner pages. */}
                    <LogoUploader
                      tenantId={tenantId}
                      currentUrl={settings.brandLogoUrl}
                      onChange={(url) => updateSetting("brandLogoUrl", url)}
                    />

                    <Input
                      label="Business Name"
                      placeholder="Your Restaurant Name"
                      value={settings.businessName}
                      onChange={(e) => updateSetting("businessName", e.target.value)}
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Select
                        label="Currency"
                        options={CURRENCIES}
                        value={settings.currency}
                        onChange={(e) => updateSetting("currency", e.target.value)}
                      />
                      <Select
                        label="Timezone"
                        options={TIMEZONES}
                        value={settings.timezone}
                        onChange={(e) => updateSetting("timezone", e.target.value)}
                      />
                    </div>

                    <Input
                      label="Tax Rate (%)"
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={settings.taxRate}
                      onChange={(e) => updateSetting("taxRate", parseFloat(e.target.value) || 0)}
                      helperText="Applied to taxable items"
                    />
                  </div>
                </Card>

                {/* Cash discount / dual pricing — offsets card processing fees.
                    Off by default. SURCHARGE is the US-standard "credit
                    surcharge" model; DISCOUNT is the "cash discount program"
                    model that avoids some state anti-surcharge rules. */}
                <Card title="Payment Processing">
                  <div className="space-y-4">
                    <Toggle
                      label="Cash Discount / Card Surcharge"
                      description="Charge more to card users (or less to cash users) to offset ~3% processing fees"
                      checked={settings.cashDiscountEnabled}
                      onChange={(v) => updateSetting("cashDiscountEnabled", v)}
                    />
                    {settings.cashDiscountEnabled && (
                      <div className="pl-4 border-l-2 border-indigo-100 space-y-3">
                        <Select
                          label="Mode"
                          options={[
                            {
                              value: "SURCHARGE",
                              label: "Card Surcharge (menu prices are cash prices; cards pay more)",
                            },
                            {
                              value: "DISCOUNT",
                              label: "Cash Discount (menu prices are card prices; cash pays less)",
                            },
                          ]}
                          value={settings.cashDiscountMode}
                          onChange={(e) =>
                            updateSetting(
                              "cashDiscountMode",
                              e.target.value as "SURCHARGE" | "DISCOUNT"
                            )
                          }
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <Input
                            label="Percentage"
                            type="number"
                            step="0.1"
                            min={0}
                            max={15}
                            value={settings.cashDiscountPercent}
                            onChange={(e) =>
                              updateSetting(
                                "cashDiscountPercent",
                                Math.min(15, parseFloat(e.target.value) || 0)
                              )
                            }
                            helperText="Typical: 2.5–4%. Max 15%."
                          />
                          <Input
                            label="Label (optional)"
                            placeholder={
                              settings.cashDiscountMode === "DISCOUNT"
                                ? "Cash Discount"
                                : "Card Processing Fee"
                            }
                            value={settings.cashDiscountLabel}
                            onChange={(e) =>
                              updateSetting("cashDiscountLabel", e.target.value)
                            }
                            helperText="Shown on receipts + POS"
                          />
                        </div>
                        <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
                          <p className="font-medium mb-1">Legal note</p>
                          <p>
                            Some US states (CT, MA, ME) ban credit surcharges — use{" "}
                            <span className="font-mono">Cash Discount</span> mode there.
                            All programs require clear POS + receipt disclosure. Not
                            legal advice — confirm with your acquirer.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                <Card title="Notifications">
                  <Toggle
                    label="Low Stock Alerts"
                    description="Get notified when inventory is low"
                    checked={settings.lowStockAlerts}
                    onChange={(checked) => updateSetting("lowStockAlerts", checked)}
                  />
                </Card>
              </div>
            )}

            {/* Order Settings */}
            {activeTab === "orders" && (
              <div className="space-y-6">
                <Card title="Order Settings">
                  <div className="space-y-4">
                    <Input
                      label="Order Number Prefix"
                      placeholder="e.g., ORD-"
                      value={settings.orderNumberPrefix}
                      onChange={(e) => updateSetting("orderNumberPrefix", e.target.value)}
                      helperText="Prefix for order numbers (e.g., ORD-001)"
                    />

                    <Toggle
                      label="Auto-Accept Orders"
                      description="Automatically accept incoming orders"
                      checked={settings.autoAcceptOrders}
                      onChange={(checked) => updateSetting("autoAcceptOrders", checked)}
                    />

                    <Toggle
                      label="Require Table for Dine-In"
                      description="Dine-in orders must have a table assigned"
                      checked={settings.requireTableForDineIn}
                      onChange={(checked) => updateSetting("requireTableForDineIn", checked)}
                    />
                  </div>
                </Card>

                <Card title="Tipping">
                  <div className="space-y-4">
                    <Toggle
                      label="Allow Tips"
                      description="Enable tipping on orders"
                      checked={settings.allowTips}
                      onChange={(checked) => updateSetting("allowTips", checked)}
                    />

                    {settings.allowTips && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Quick Tip Percentages
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {settings.tipPercentages.map((percentage, index) => (
                            <div key={index} className="relative">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={percentage}
                                onChange={(e) => {
                                  const newPercentages = [...settings.tipPercentages];
                                  newPercentages[index] = parseInt(e.target.value) || 0;
                                  updateSetting("tipPercentages", newPercentages);
                                }}
                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-center"
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                                %
                              </span>
                            </div>
                          ))}
                          {settings.tipPercentages.length < 5 && (
                            <button
                              onClick={() =>
                                updateSetting("tipPercentages", [...settings.tipPercentages, 0])
                              }
                              className="w-20 h-10 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-indigo-500 hover:text-indigo-500"
                            >
                              +
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            )}

            {/* Table Ordering Settings */}
            {activeTab === "tables" && (
              <div className="space-y-6">
                <Card title="Table Ordering">
                  <div className="space-y-4">
                    <Toggle
                      label="Enable Table Ordering"
                      description="Allow customers to scan QR codes and order from their table"
                      checked={settings.tableOrderingEnabled}
                      onChange={(checked) => updateSetting("tableOrderingEnabled", checked)}
                    />

                    {settings.tableOrderingEnabled && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Payment Type
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                              type="button"
                              onClick={() => updateSetting("tablePaymentType", "UPFRONT")}
                              className={`p-4 rounded-xl border-2 text-left transition-all ${
                                settings.tablePaymentType === "UPFRONT"
                                  ? "border-indigo-500 bg-indigo-50"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              <div className="flex items-center gap-3 mb-2">
                                <Icon icon="solar:card-bold" className={`w-6 h-6 ${settings.tablePaymentType === "UPFRONT" ? "text-indigo-600" : "text-gray-400"}`} />
                                <span className={`font-semibold ${settings.tablePaymentType === "UPFRONT" ? "text-indigo-700" : "text-gray-700"}`}>
                                  Pay Upfront
                                </span>
                              </div>
                              <p className="text-sm text-gray-500">
                                Customer pays before order is sent to kitchen. Ideal for fast food, quick service, or food courts.
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => updateSetting("tablePaymentType", "PAY_AT_END")}
                              className={`p-4 rounded-xl border-2 text-left transition-all ${
                                settings.tablePaymentType === "PAY_AT_END"
                                  ? "border-indigo-500 bg-indigo-50"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              <div className="flex items-center gap-3 mb-2">
                                <Icon icon="solar:bill-list-bold" className={`w-6 h-6 ${settings.tablePaymentType === "PAY_AT_END" ? "text-indigo-600" : "text-gray-400"}`} />
                                <span className={`font-semibold ${settings.tablePaymentType === "PAY_AT_END" ? "text-indigo-700" : "text-gray-700"}`}>
                                  Pay at End
                                </span>
                              </div>
                              <p className="text-sm text-gray-500">
                                Orders go to kitchen immediately, customer pays when leaving. Traditional restaurant style.
                              </p>
                            </button>
                          </div>
                        </div>

                        <Toggle
                          label="Allow Group Ordering"
                          description="Multiple guests at the same table can add items to a shared order"
                          checked={settings.allowGuestOrdering}
                          onChange={(checked) => updateSetting("allowGuestOrdering", checked)}
                        />
                      </>
                    )}
                  </div>
                </Card>

                <Card title="QR Code Information">
                  <div className="p-4 bg-gray-50 rounded-xl">
                    <p className="text-sm text-gray-600 mb-3">
                      Generate and print QR codes for each table from the <strong>Tables</strong> page.
                      Each QR code is unique and links customers directly to your menu for that specific table.
                    </p>
                    <Button
                      variant="secondary"
                      icon="solar:table-bold"
                      onClick={() => window.location.href = "/dashboard/admin/tables"}
                    >
                      Go to Tables
                    </Button>
                  </div>
                </Card>
              </div>
            )}

            {/* Kitchen Settings */}
            {activeTab === "kitchen" && (
              <Card title="Kitchen Display Settings">
                <div className="space-y-4">
                  <Select
                    label="Auto-Refresh Interval"
                    options={[
                      { value: "3", label: "3 seconds" },
                      { value: "5", label: "5 seconds" },
                      { value: "10", label: "10 seconds" },
                      { value: "15", label: "15 seconds" },
                      { value: "30", label: "30 seconds" },
                    ]}
                    value={settings.kitchenDisplayAutoRefresh.toString()}
                    onChange={(e) =>
                      updateSetting("kitchenDisplayAutoRefresh", parseInt(e.target.value))
                    }
                    helperText="How often the kitchen display updates"
                  />

                  <div className="p-4 bg-gray-50 rounded-xl">
                    <h4 className="font-medium text-gray-900 mb-2">Kitchen Display URL</h4>
                    <p className="text-sm text-gray-500 mb-3">
                      Open this URL on your kitchen display screens:
                    </p>
                    {/* Kitchen display route lives at /kitchen-display/[tenantId]/[locationId]
                        (not /dashboard/kitchen). Falls back to a friendly
                        message while the default location is being loaded
                        rather than showing a broken URL. */}
                    {tenantId && defaultLocationId ? (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm break-all">
                          {typeof window !== "undefined"
                            ? `${window.location.origin}/kitchen-display/${tenantId}/${defaultLocationId}`
                            : `/kitchen-display/${tenantId}/${defaultLocationId}`}
                        </code>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="solar:copy-linear"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `${window.location.origin}/kitchen-display/${tenantId}/${defaultLocationId}`
                            );
                            toast.success("URL copied!");
                          }}
                        >
                          Copy
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic">
                        Loading location…
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Receipt Settings */}
            {activeTab === "receipts" && (
              <Card title="Receipt Customization">
                <div className="space-y-4">
                  <Input
                    label="Receipt Header"
                    placeholder="Text to show at the top of receipts..."
                    value={settings.receiptHeader}
                    onChange={(e) => updateSetting("receiptHeader", e.target.value)}
                    multiline
                    rows={3}
                    helperText="Appears at the top of every receipt"
                  />

                  <Input
                    label="Receipt Footer"
                    placeholder="Thank you for your visit!"
                    value={settings.receiptFooter}
                    onChange={(e) => updateSetting("receiptFooter", e.target.value)}
                    multiline
                    rows={3}
                    helperText="Appears at the bottom of every receipt"
                  />

                  {/* Preview */}
                  <div className="mt-6">
                    <h4 className="font-medium text-gray-900 mb-3">Preview</h4>
                    <div className="max-w-xs mx-auto p-4 bg-white border border-gray-200 rounded-lg font-mono text-xs">
                      <div className="text-center border-b border-dashed border-gray-300 pb-2 mb-2">
                        <p className="font-bold">{settings.businessName || "Your Business"}</p>
                        {settings.receiptHeader && (
                          <p className="text-gray-500 mt-1 whitespace-pre-line">
                            {settings.receiptHeader}
                          </p>
                        )}
                      </div>
                      <div className="py-2 border-b border-dashed border-gray-300">
                        <p className="text-gray-500">Order #001</p>
                        <p className="text-gray-500">
                          {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="py-2 border-b border-dashed border-gray-300">
                        <div className="flex justify-between">
                          <span>1x Sample Item</span>
                          <span>$10.00</span>
                        </div>
                      </div>
                      <div className="py-2">
                        <div className="flex justify-between">
                          <span>Subtotal</span>
                          <span>$10.00</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Tax ({settings.taxRate}%)</span>
                          <span>${(10 * settings.taxRate / 100).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-bold mt-1">
                          <span>Total</span>
                          <span>${(10 * (1 + settings.taxRate / 100)).toFixed(2)}</span>
                        </div>
                      </div>
                      {settings.receiptFooter && (
                        <div className="text-center border-t border-dashed border-gray-300 pt-2 mt-2">
                          <p className="text-gray-500 whitespace-pre-line">{settings.receiptFooter}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Logo uploader ───────────────────────────────────────────────────
// Uses the existing S3 presign flow (/uploads/presign). The uploaded URL
// isn't persisted until the merchant clicks Save Changes on the outer
// settings form — the input just stages the URL into the parent state.

interface LogoUploaderProps {
  tenantId: string | null;
  currentUrl: string;
  onChange: (url: string) => void;
}

function LogoUploader({ tenantId, currentUrl, onChange }: LogoUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    // Store as an inline base64 data URL — same pattern Product.imageUrl
    // uses. Skips the S3 flow (which needs public-read on the bucket to
    // serve back to the browser). 1 MB cap since bytes travel on every
    // page load; typical logos are <100 KB.
    if (file.size > 1 * 1024 * 1024) {
      toast.error("Logo must be under 1 MB (stored inline for portability)");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
      });
      onChange(dataUrl);
      toast.success("Logo loaded — click Save Changes to apply");
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Business Logo
      </label>
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt="Current logo"
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Icon icon="solar:shop-2-bold" className="w-8 h-8 text-gray-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || !tenantId}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Icon
                icon={uploading ? "solar:refresh-linear" : "solar:upload-linear"}
                className={`w-4 h-4 ${uploading ? "animate-spin" : ""}`}
              />
              {uploading ? "Uploading..." : currentUrl ? "Replace" : "Upload"}
            </button>
            {currentUrl && (
              <button
                type="button"
                onClick={() => onChange("")}
                disabled={uploading}
                className="px-3 py-1.5 rounded-lg text-sm text-red-600 hover:bg-red-50 font-medium inline-flex items-center gap-1"
              >
                <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            PNG, JPG, or WebP · under 1 MB · shows in the sidebar and on customer-facing pages
          </p>
        </div>
      </div>
    </div>
  );
}
