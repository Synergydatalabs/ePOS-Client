"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { format } from "date-fns";
import { billingEmailForHost } from "@/lib/partner-billing";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  status: string;
}

interface Subscription {
  id: string;
  status: string;
  trialEndsAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
}

interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  phone?: string;
  isDefault: boolean;
  // Phase E R3: needed to render the public booking URL card. Both must
  // be present for the URL to work; UI shows a "not published" hint
  // when they're missing.
  publicBookingSlug?: string | null;
  publicBookingEnabled?: boolean;
}

export default function SettingsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeTab, setActiveTab] = useState<"general" | "billing" | "locations">("general");

  // Form state
  const [businessName, setBusinessName] = useState("");
  const [taxRate, setTaxRate] = useState("13");
  const [taxName, setTaxName] = useState("HST");
  const [tipPresets, setTipPresets] = useState("15, 18, 20");
  const [receiptHeader, setReceiptHeader] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("");
  // Brand logo — surfaced in sidebar + partner-branded public pages.
  // Staged locally on upload, persisted on Save Changes below.
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  // Salon-only: controls whether the public next-appointment board
  // shows customer first names or just "Guest #0042" badges.
  const [appointmentDisplayShowName, setAppointmentDisplayShowName] = useState(false);
  // Phase E R2: reservation duration matrix — bucket key → minutes.
  // Kept as flat strings in state (edited via 4 fixed rows below) so
  // the form is trivial; assembled into JSON on save.
  const [duration12, setDuration12] = useState("60");
  const [duration34, setDuration34] = useState("90");
  const [duration56, setDuration56] = useState("120");
  const [duration7plus, setDuration7plus] = useState("150");
  const [turnBuffer, setTurnBuffer] = useState("15");
  // Phase E R4: cancellation window (minutes before booking) for
  // full-refund cutoff. Applies to both appointments and reservations.
  const [cancellationWindow, setCancellationWindow] = useState("30");
  // Phase E R6: appointment deposit — salon public booking only.
  const [requireDeposit, setRequireDeposit] = useState(false);
  const [depositType, setDepositType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [depositValue, setDepositValue] = useState("25"); // percent OR cents based on type
  // Batch close is 100% manual — no scheduler, no cron. Operator hits
  // "Close batch now" whenever they're done for the shift (any hour).
  const [closingBatchNow, setClosingBatchNow] = useState(false);

  // Location modal state
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [locationForm, setLocationForm] = useState({
    name: "",
    address: "",
    city: "",
    province: "",
    postalCode: "",
    phone: "",
    isDefault: false,
  });
  const [locationSaving, setLocationSaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const fetchSettings = useCallback(async () => {
    if (!tenantId) return;

    try {
      // Hydrate the form from the real /settings endpoint so the saved
      // tax/tip/receipt/business-name values come back on refresh.
      const [settingsRes, locationsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/settings`),
        fetch(`/api/tenants/${tenantId}/locations`),
      ]);

      const settingsData = await settingsRes.json();
      if (settingsData.success) {
        const t = settingsData.tenant;
        const s = settingsData.settings;
        if (t) {
          setTenant(t);
          setBusinessName(t.name || "");
        }
        if (s) {
          setTaxName(s.taxLabel || "HST");
          setTaxRate(s.taxRate != null ? String(s.taxRate) : "13");
          setTipPresets(
            Array.isArray(s.tipPresets) ? s.tipPresets.join(", ") : "15, 18, 20"
          );
          setReceiptHeader(s.receiptHeader || "");
          setReceiptFooter(s.receiptFooter || "");
          setAppointmentDisplayShowName(!!s.appointmentDisplayShowName);
          setBrandLogoUrl(s.brandLogoUrl || "");
          // Phase E R2: hydrate reservation duration matrix + turn buffer.
          const map = s.partySizeDurationMap || {};
          setDuration12(String(map["1-2"] ?? 60));
          setDuration34(String(map["3-4"] ?? 90));
          setDuration56(String(map["5-6"] ?? 120));
          setDuration7plus(String(map["7+"] ?? 150));
          setTurnBuffer(String(s.reservationTurnBufferMinutes ?? 15));
          setCancellationWindow(String(s.cancellationWindowMinutes ?? 30));
          setRequireDeposit(!!s.requireAppointmentDeposit);
          setDepositType(s.appointmentDepositType === "FIXED" ? "FIXED" : "PERCENT");
          setDepositValue(String(s.appointmentDepositValue ?? 25));
        }
      }

      const locationsData = await locationsRes.json();
      if (locationsData.success) {
        setLocations(locationsData.locations);
      }

      // Subscription is not yet wired to the DB. Report ACTIVE so the
      // trial banner doesn't show — the tap-app demo tenants are
      // permanent, not trials. When the real billing integration
      // lands, replace with a fetch.
      setSubscription({
        id: "sub_1",
        status: "ACTIVE",
      });
    } catch (error) {
      console.error("Failed to fetch settings:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);

    try {
      // Parse the comma-separated tip presets into a number array,
      // dropping anything non-numeric so a stray space/letter can't 400 us.
      const parsedTipPresets = tipPresets
        .split(",")
        .map((p) => parseFloat(p.trim()))
        .filter((n) => Number.isFinite(n));

      // Phase E R2: assemble reservation duration matrix. Clamp minutes
      // to sane bounds (15..480) so a fat-fingered zero can't break
      // downstream overbooking math.
      const clamp = (raw: string, fallback: number) => {
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(15, Math.min(480, n));
      };
      const partySizeDurationMap = {
        "1-2": clamp(duration12, 60),
        "3-4": clamp(duration34, 90),
        "5-6": clamp(duration56, 120),
        "7+": clamp(duration7plus, 150),
      };
      const reservationTurnBufferMinutes = Math.max(
        0,
        Math.min(120, parseInt(turnBuffer, 10) || 15)
      );
      // Phase E R4: cancellation window bounds — 0..1440 (24h).
      const cancellationWindowMinutes = Math.max(
        0,
        Math.min(1440, parseInt(cancellationWindow, 10) || 30)
      );

      // Phase E R6: deposit — PERCENT is 0..100; FIXED is cents. Client
      // shows dollars for the FIXED input; convert here.
      const depositRaw = parseFloat(depositValue) || 0;
      const appointmentDepositValue =
        depositType === "FIXED"
          ? Math.max(0, Math.round(depositRaw * 100))
          : Math.max(0, Math.min(100, Math.round(depositRaw)));

      const res = await fetch(`/api/tenants/${tenantId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: businessName.trim(),
          taxLabel: taxName.trim(),
          taxRate: parseFloat(taxRate) || 0,
          tipPresets: parsedTipPresets,
          receiptHeader,
          receiptFooter,
          appointmentDisplayShowName,
          brandLogoUrl: brandLogoUrl || null,
          partySizeDurationMap,
          reservationTurnBufferMinutes,
          cancellationWindowMinutes,
          requireAppointmentDeposit: requireDeposit,
          appointmentDepositType: depositType,
          appointmentDepositValue,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success("Settings saved");

        // The dashboard layout caches `partner_branding` in localStorage
        // and only refreshes it at login. Patch the cache in-place so
        // the sidebar picks up the new logo on next paint, and — if the
        // logo actually changed — trigger a reload so the sidebar re-
        // renders immediately instead of waiting for the next nav.
        try {
          const cached = localStorage.getItem("partner_branding");
          const parsed = cached ? JSON.parse(cached) : {};
          const nextLogo = brandLogoUrl || null;
          const changed = parsed.brandLogoUrl !== nextLogo;
          const merged = { ...parsed, brandLogoUrl: nextLogo, brandName: businessName.trim() || parsed.brandName };
          localStorage.setItem("partner_branding", JSON.stringify(merged));
          if (changed) {
            // Soft reload — cheaper than router.refresh() for full-page
            // state (sidebar reads localStorage on mount).
            window.location.reload();
            return;
          }
        } catch {
          /* localStorage unavailable — just skip the cache refresh */
        }

        await fetchSettings();
      } else {
        toast.error(data.error || "Failed to save settings");
      }
    } catch (error) {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const openLocationModal = (location?: Location) => {
    if (location) {
      setEditingLocation(location);
      setLocationForm({
        name: location.name,
        address: location.address || "",
        city: location.city || "",
        province: location.province || "",
        postalCode: location.postalCode || "",
        phone: location.phone || "",
        isDefault: location.isDefault,
      });
    } else {
      setEditingLocation(null);
      setLocationForm({
        name: "",
        address: "",
        city: "",
        province: "",
        postalCode: "",
        phone: "",
        isDefault: locations.length === 0,
      });
    }
    setShowLocationModal(true);
  };

  const handleSaveLocation = async () => {
    if (!locationForm.name.trim()) {
      toast.error("Location name is required");
      return;
    }

    setLocationSaving(true);

    try {
      const url = editingLocation
        ? `/api/tenants/${tenantId}/locations/${editingLocation.id}`
        : `/api/tenants/${tenantId}/locations`;

      const res = await fetch(url, {
        method: editingLocation ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(locationForm),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(editingLocation ? "Location updated" : "Location created");
        setShowLocationModal(false);
        fetchSettings();
      } else {
        toast.error(data.error || "Failed to save location");
      }
    } catch (error) {
      toast.error("Failed to save location");
    } finally {
      setLocationSaving(false);
    }
  };

  const handleDeleteLocation = async (location: Location) => {
    if (!confirm(`Delete "${location.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${location.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Location deleted");
        fetchSettings();
      } else {
        toast.error(data.error || "Failed to delete location");
      }
    } catch (error) {
      toast.error("Failed to delete location");
    }
  };

  const getSubscriptionStatus = () => {
    if (!subscription) return null;

    switch (subscription.status) {
      case "TRIAL":
        return {
          label: "Trial",
          color: "bg-amber-100 text-amber-700",
          icon: "solar:clock-circle-bold",
        };
      case "ACTIVE":
        return {
          label: "Active",
          color: "bg-green-100 text-green-700",
          icon: "solar:check-circle-bold",
        };
      case "PAST_DUE":
        return {
          label: "Past Due",
          color: "bg-red-100 text-red-700",
          icon: "solar:danger-triangle-bold",
        };
      case "CANCELLED":
        return {
          label: "Cancelled",
          color: "bg-gray-100 text-gray-700",
          icon: "solar:close-circle-bold",
        };
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="space-y-4">
            <div className="h-12 bg-gray-100 rounded-xl animate-pulse" />
            <div className="h-12 bg-gray-100 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const subscriptionStatus = getSubscriptionStatus();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your business settings</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        {[
          { key: "general", label: "General", icon: "solar:settings-bold" },
          { key: "billing", label: "Billing", icon: "solar:card-bold" },
          { key: "locations", label: "Locations", icon: "solar:buildings-bold" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-indigo-100 text-indigo-700"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <Icon icon={tab.icon} className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Settings */}
      {activeTab === "general" && (
        <div className="space-y-6">
          {/* Business Info */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Business Information</h2>
            <div className="space-y-4">
              {/* Logo — flows through to the admin sidebar + partner pages. */}
              <LogoUploader
                tenantId={tenantId}
                currentUrl={brandLogoUrl}
                onChange={setBrandLogoUrl}
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Business Name
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Currency
                  </label>
                  <select
                    value={tenant?.currency || "CAD"}
                    disabled
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 text-gray-700"
                  >
                    <option value="CAD">CAD - Canadian Dollar</option>
                    <option value="USD">USD - US Dollar</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Contact support to change</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Timezone
                  </label>
                  <select
                    value={tenant?.timezone || "America/Toronto"}
                    disabled
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 text-gray-700"
                  >
                    <option value="America/Toronto">America/Toronto</option>
                    <option value="America/Vancouver">America/Vancouver</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Tax Settings */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Tax Settings</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tax Name
                </label>
                <input
                  type="text"
                  value={taxName}
                  onChange={(e) => setTaxName(e.target.value)}
                  placeholder="HST, GST, VAT..."
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900 placeholder-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tax Rate (%)
                </label>
                <input
                  type="number"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  step="0.01"
                  min="0"
                  max="100"
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                />
              </div>
            </div>
          </div>

          {/* Tip Settings */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Tip Settings</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tip Presets (%)
              </label>
              <input
                type="text"
                value={tipPresets}
                onChange={(e) => setTipPresets(e.target.value)}
                placeholder="15, 18, 20"
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900 placeholder-gray-400"
              />
              <p className="text-xs text-gray-500 mt-1">
                Comma-separated percentages shown to customers
              </p>
            </div>
          </div>

          {/* Receipt Settings */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Receipt Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Receipt Header
                </label>
                <textarea
                  value={receiptHeader}
                  onChange={(e) => setReceiptHeader(e.target.value)}
                  placeholder="Your business address, phone, etc."
                  rows={2}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all resize-none text-gray-900 placeholder-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Receipt Footer
                </label>
                <textarea
                  value={receiptFooter}
                  onChange={(e) => setReceiptFooter(e.target.value)}
                  placeholder="Thank you message, return policy, etc."
                  rows={2}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all resize-none text-gray-900 placeholder-gray-400"
                />
              </div>
            </div>
          </div>

          {/* End-of-day batch close — 100% operator-driven. Hit the
              button when the shift is done. Late-night venues (bars,
              pizza-until-4am) close whenever they close. No cron, no
              scheduler, no "did the auto-close fire?" ambiguity. */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">End-of-day batch close</h2>
            <p className="text-sm text-gray-500 mb-4">
              Settles today's approved card transactions on your terminal and prints
              the settlement summary. Hit this at the end of every shift — bars and
              late-night venues close whenever the shift actually ends.
            </p>

            <button
              type="button"
              disabled={closingBatchNow || !tenantId}
              onClick={async () => {
                if (!tenantId) {
                  toast.error("No tenant selected — refresh the page and try again.");
                  return;
                }
                // Skip native confirm() — iPad WebKit throws "The string
                // did not match the expected pattern." from confirm() in
                // some contexts, which surfaces as a mystery toast. Rely
                // on the tenant already-closed guard + operator intent.
                setClosingBatchNow(true);
                try {
                  const res = await fetch(
                    `/api/tenants/${tenantId}/payments/uci/batch-close`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({}),
                    }
                  );
                  // Read the body as TEXT first so a non-JSON error page
                  // (Nginx 502, HTML 500) doesn't throw a cryptic JSON
                  // parse error. Only parse if it actually looks like JSON.
                  const bodyText = await res.text();
                  let data: any = null;
                  try {
                    data = bodyText ? JSON.parse(bodyText) : null;
                  } catch {
                    // Non-JSON body — surface the raw text.
                    toast.error(
                      `Batch close failed (${res.status}): ${bodyText.slice(0, 200) || "empty response"}`
                    );
                    return;
                  }
                  if (res.ok && data?.success) {
                    toast.success(
                      "Batch closed — terminal is printing the summary"
                    );
                  } else {
                    // Endpoint returned JSON but not success. Show its
                    // error message verbatim so ops can see the GP or
                    // terminal-level reason (e.g. "No UCI terminal
                    // found", "GP: BATCH_CLOSE failed: no txns").
                    toast.error(
                      data?.error ||
                        `Batch close failed (HTTP ${res.status})`
                    );
                  }
                } catch (e: any) {
                  // Network / fetch-level failure. On iPad Safari this
                  // is where the "string did not match the expected
                  // pattern" message comes from — usually a bad URL or
                  // dropped Wi-Fi. Surface both name and message so we
                  // can tell them apart.
                  const parts = [e?.name, e?.message]
                    .filter(Boolean)
                    .join(": ");
                  toast.error(parts || "Batch close failed (network)");
                  console.error("[batch-close] fetch error:", e);
                } finally {
                  setClosingBatchNow(false);
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              <Icon icon="solar:lock-keyhole-minimalistic-bold" className="w-4 h-4" />
              {closingBatchNow ? "Closing…" : "Close batch now"}
            </button>
            <p className="text-xs text-gray-500 mt-2">
              Runs on your default UCI terminal. To close a specific terminal, use
              Admin → Terminals.
            </p>
          </div>

          {/* Display Settings — salon only (next-appointment board privacy) */}
          {tenant?.businessType === "salon" && (
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Display Settings</h2>
              <p className="text-sm text-gray-500 mb-4">
                Controls the public Next Appointment board mounted in your waiting area.
              </p>
              <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={appointmentDisplayShowName}
                  onChange={(e) => setAppointmentDisplayShowName(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Show customer names on the appointment board</div>
                  <div className="text-sm text-gray-500 mt-1">
                    When off (default), the board shows <code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">Guest&nbsp;#0042</code> — a privacy-safe booking number.
                    Turn this on if you want to show the customer name (e.g. <code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">Sarah&nbsp;M.</code>) instead.
                  </div>
                </div>
              </label>
            </div>
          )}

          {/* Phase E R2: reservation duration matrix. Restaurant-only —
              salons book by fixed service duration, not party size. */}
          {tenant?.businessType === "restaurant" && (
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Reservation Duration
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                How long a table stays booked per party size. New
                reservations pick from this matrix. Prevents both taking
                too-short slots (rushed guests) and too-long ones
                (turning tables away needlessly).
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <MatrixCell
                  label="1–2 guests"
                  value={duration12}
                  onChange={setDuration12}
                />
                <MatrixCell
                  label="3–4 guests"
                  value={duration34}
                  onChange={setDuration34}
                />
                <MatrixCell
                  label="5–6 guests"
                  value={duration56}
                  onChange={setDuration56}
                />
                <MatrixCell
                  label="7+ guests"
                  value={duration7plus}
                  onChange={setDuration7plus}
                />
              </div>
              <div className="pt-4 border-t border-gray-100">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Turn buffer (minutes)
                </label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={turnBuffer}
                  onChange={(e) => setTurnBuffer(e.target.value)}
                  className="w-32 px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Cleanup time between one party leaving and the next
                  arriving. Added on both sides when checking for
                  overlaps.
                </p>
              </div>
            </div>
          )}

          {/* Phase E R4: cancellation window — applies to both
              appointment (salon) and reservation (restaurant) flows.
              Hidden for business types that don't do bookings. */}
          {(tenant?.businessType === "restaurant" ||
            tenant?.businessType === "salon") && (
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Cancellation Policy
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                How many minutes before a booking a customer can cancel
                and still get a full refund. Set to 0 to disable free
                cancellation entirely (rare — hurts conversion).
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Free-refund window (minutes)
              </label>
              <input
                type="number"
                min={0}
                max={1440}
                value={cancellationWindow}
                onChange={(e) => setCancellationWindow(e.target.value)}
                className="w-32 px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-gray-900"
              />
              <p className="text-xs text-gray-500 mt-1">
                Shown on the confirmation SMS ("Reply CANCEL up to N min
                before to cancel") so customers know the cutoff. Default 30.
              </p>
            </div>
          )}

          {/* Phase E R6: Salon deposit — only public bookings pay a
              deposit; POS-created appointments are pay-at-service (staff
              is right there). */}
          {tenant?.businessType === "salon" && (
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Booking Deposit
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Take a partial payment when a customer books online. Reduces
                no-shows and holds their slot. Applies only to public bookings.
              </p>
              <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireDeposit}
                  onChange={(e) => setRequireDeposit(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">
                    Require deposit on public booking
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    When on, the confirm step redirects the customer to a
                    hosted deposit checkout. Appointment is only marked as
                    booked after the deposit clears.
                  </div>
                </div>
              </label>
              {requireDeposit && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Deposit type
                    </label>
                    <select
                      value={depositType}
                      onChange={(e) =>
                        setDepositType(e.target.value as "PERCENT" | "FIXED")
                      }
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-gray-900"
                    >
                      <option value="PERCENT">Percent of booking</option>
                      <option value="FIXED">Fixed amount</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      {depositType === "PERCENT" ? "Percent (%)" : "Amount ($)"}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={depositType === "PERCENT" ? 100 : 100000}
                      step={depositType === "PERCENT" ? 1 : 0.01}
                      value={depositValue}
                      onChange={(e) => setDepositValue(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-gray-900"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {depositType === "PERCENT"
                        ? "0–100. Applied to the subtotal at booking time."
                        : "Fixed deposit charged regardless of booking size."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                  Saving...
                </>
              ) : (
                <>
                  <Icon icon="solar:diskette-bold" className="w-5 h-5" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Billing Tab */}
      {activeTab === "billing" && (
        <div className="space-y-6">
          {/* Subscription Status */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Subscription</h2>

            {subscription && subscriptionStatus && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${subscriptionStatus.color}`}
                  >
                    <Icon icon={subscriptionStatus.icon} className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {subscriptionStatus.label}
                    </p>
                    {subscription.status === "TRIAL" && subscription.trialEndsAt && (
                      <p className="text-sm text-gray-500">
                        Trial ends {format(new Date(subscription.trialEndsAt), "MMMM d, yyyy")}
                      </p>
                    )}
                  </div>
                </div>

                {subscription.status === "TRIAL" && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex items-start gap-3">
                      <Icon icon="solar:info-circle-bold" className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-amber-800">Free Trial</p>
                        <p className="text-sm text-amber-700 mt-1">
                          You're on a free 14-day trial. Contact us to continue using iTAP after your trial ends.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Contact for Billing — derived from the current hostname,
              not merchant-editable. Merchants on oreugo.ca get routed
              to info@oreugo.ca; merchants on itap.zashx.com get
              support@zashx.com; fallback to Zashx support otherwise.
              Partner mapping lives in @/lib/partner-billing. */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Billing Information</h2>
            <p className="text-gray-600 mb-4">
              We use a custom billing model. Contact our team to discuss pricing and
              payment options for your business.
            </p>

            {(() => {
              const billingEmail =
                typeof window !== "undefined"
                  ? billingEmailForHost(window.location.hostname)
                  : "support@zashx.com";
              return (
                <>
                  <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-gray-100">
                    <Icon
                      icon="solar:mailbox-bold"
                      className="w-4 h-4 text-gray-400 flex-shrink-0"
                    />
                    <span className="text-sm text-gray-700">
                      Emails go to <strong className="text-gray-900">{billingEmail}</strong>
                    </span>
                  </div>
                  <a
                    href={`mailto:${encodeURIComponent(billingEmail)}?subject=Billing%20Inquiry`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all"
                  >
                    <Icon icon="solar:letter-bold" className="w-5 h-5" />
                    Contact Billing
                  </a>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Locations Tab */}
      {activeTab === "locations" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Locations</h2>
              <button
                onClick={() => openLocationModal()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white tap-gradient hover:opacity-90 transition-colors"
              >
                <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
                Add Location
              </button>
            </div>

            {locations.length === 0 ? (
              <div className="text-center py-12">
                <Icon icon="solar:buildings-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No locations yet</h3>
                <p className="text-gray-500 mb-4">Add your first location to get started</p>
                <button
                  onClick={() => openLocationModal()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all"
                >
                  <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
                  Add Location
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {locations.map((location) => (
                  <div
                    key={location.id}
                    className="p-4 bg-gray-50 rounded-xl space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                          <Icon icon="solar:buildings-bold" className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-gray-900">{location.name}</p>
                            {location.isDefault && (
                              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full">
                                Default
                              </span>
                            )}
                          </div>
                          {(location.address || location.city) && (
                            <p className="text-sm text-gray-500">
                              {[location.address, location.city, location.province].filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openLocationModal(location)}
                          className="p-2 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        >
                          <Icon icon="solar:pen-2-linear" className="w-4 h-4" />
                        </button>
                        {!location.isDefault && locations.length > 1 && (
                          <button
                            onClick={() => handleDeleteLocation(location)}
                            className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Icon icon="solar:trash-bin-2-linear" className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <PublicBookingLinkRow
                      tenantSlug={tenant?.slug}
                      tenantPublicBookingEnabled={
                        (tenant as any)?.publicBookingEnabled !== false
                      }
                      location={location}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Location Modal */}
      {showLocationModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                {editingLocation ? "Edit Location" : "Add Location"}
              </h2>
              <button
                onClick={() => setShowLocationModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g., Main Store, Downtown Branch"
                  value={locationForm.name}
                  onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  placeholder="123 Main Street"
                  value={locationForm.address}
                  onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    placeholder="Toronto"
                    value={locationForm.city}
                    onChange={(e) => setLocationForm({ ...locationForm, city: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Province
                  </label>
                  <input
                    type="text"
                    placeholder="Ontario"
                    value={locationForm.province}
                    onChange={(e) => setLocationForm({ ...locationForm, province: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Postal Code
                  </label>
                  <input
                    type="text"
                    placeholder="M5V 1A1"
                    value={locationForm.postalCode}
                    onChange={(e) => setLocationForm({ ...locationForm, postalCode: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="(416) 555-0123"
                    value={locationForm.phone}
                    onChange={(e) => setLocationForm({ ...locationForm, phone: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={locationForm.isDefault}
                  onChange={(e) => setLocationForm({ ...locationForm, isDefault: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="isDefault" className="text-sm text-gray-700">
                  Set as default location
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowLocationModal(false)}
                  className="flex-1 py-2 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveLocation}
                  disabled={locationSaving || !locationForm.name.trim()}
                  className="flex-1 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {locationSaving ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                  ) : (
                    <>
                      <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
                      {editingLocation ? "Update" : "Create"}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Logo uploader ───────────────────────────────────────────────────
// Same as the /dashboard/admin/settings equivalent — duplicated here
// so the partner-domain dashboard stays self-contained.
//
// Uses the S3 presign flow. The uploaded URL is staged into parent
// state (setBrandLogoUrl) — only persisted when the merchant clicks
// Save Changes below.
interface LogoUploaderProps {
  tenantId: string | null;
  currentUrl: string;
  onChange: (url: string) => void;
}
function LogoUploader({ tenantId, currentUrl, onChange }: LogoUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    // Store as an inline base64 data URL — same pattern Product.imageUrl
    // uses. Skips the S3 upload flow entirely (which needs public-read
    // policy on the bucket to serve back to the browser). Trade-off:
    // every page load re-transfers the bytes, so we cap smaller than
    // the 5 MB the S3 flow allowed.
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
      // Stage the data URL. Parent's Save Changes persists it to the DB
      // (tenant_settings.brand_logo_url — Text, no length cap).
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
          {/* Render both the img AND the fallback icon; hide whichever
              shouldn't be visible. On img error swap them so a broken
              S3 URL doesn't leave an empty box. */}
          {currentUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt="Current logo"
              className="w-full h-full object-contain"
              onError={(e) => {
                const t = e.currentTarget;
                t.style.display = "none";
                const fallback = t.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = "flex";
              }}
            />
          )}
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ display: currentUrl ? "none" : "flex" }}
          >
            <Icon icon="solar:shop-2-bold" className="w-8 h-8 text-gray-300" />
          </div>
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

// Phase E R3: public booking link card per location. Shows the URL
// the merchant pastes into their own site's "Book Now" button. Uses
// window.location.origin so partner domains (e.g. oreugo.ca) get the
// right host automatically — same tenant hosted on a partner shows
// the partner URL.
function PublicBookingLinkRow({
  tenantSlug,
  tenantPublicBookingEnabled,
  location,
}: {
  tenantSlug?: string;
  tenantPublicBookingEnabled?: boolean;
  location: {
    publicBookingSlug?: string | null;
    publicBookingEnabled?: boolean;
  };
}) {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  // ALL of these must hold for the public /book URL to resolve.
  // Any one being false is a 404 — we tell the merchant exactly which.
  const canBuildUrl =
    tenantSlug &&
    tenantPublicBookingEnabled !== false &&
    location.publicBookingSlug &&
    location.publicBookingEnabled;

  if (!canBuildUrl) {
    return (
      <div className="p-3 rounded-lg border border-dashed border-gray-300 bg-white">
        <div className="flex items-start gap-2">
          <Icon
            icon="solar:link-broken-linear"
            className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5"
          />
          <div className="flex-1">
            <p className="text-xs font-medium text-gray-700">
              Public booking not published
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {!tenantSlug
                ? "Tenant is missing a slug."
                : tenantPublicBookingEnabled === false
                  ? "Public booking is disabled at the tenant level. Ask support to run: UPDATE tenants SET public_booking_enabled = true WHERE slug = '" +
                    tenantSlug +
                    "';"
                  : !location.publicBookingSlug
                    ? "Missing booking slug — edit the location to add one."
                    : "Public booking is disabled for this location."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const url = `${origin}/book/${tenantSlug}/${location.publicBookingSlug}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed — select the URL and copy manually.");
    }
  };

  return (
    <div className="p-3 rounded-lg bg-white border border-gray-200">
      <div className="flex items-center gap-2 mb-1">
        <Icon icon="solar:link-linear" className="w-4 h-4 text-indigo-600" />
        <p className="text-xs font-medium text-gray-700">
          Public booking link
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm font-mono bg-gray-50 border border-gray-200 text-gray-700"
        />
        <button
          onClick={copy}
          className="px-3 py-2 rounded-md text-sm font-medium text-white tap-gradient hover:opacity-90"
          title="Copy to clipboard"
        >
          Copy
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="p-2 rounded-md text-gray-500 hover:text-indigo-600 hover:bg-indigo-50"
          title="Open in new tab"
        >
          <Icon icon="solar:arrow-right-up-linear" className="w-4 h-4" />
        </a>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Paste this on your website's "Book Now" button.
      </p>
    </div>
  );
}

// Phase E R2: one cell in the reservation duration matrix. Compact so
// four fit on a single row on desktop.
function MatrixCell({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={15}
          max={480}
          step={15}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-gray-900"
        />
        <span className="text-xs text-gray-500">min</span>
      </div>
    </div>
  );
}
