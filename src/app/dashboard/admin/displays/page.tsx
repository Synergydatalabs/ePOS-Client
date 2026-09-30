"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Card, Button, Badge } from "@/components/ui";

interface Location {
  id: string;
  name: string;
  address?: string;
}

type DisplayKind = "kitchen" | "customer" | "appointment";

interface DisplayCard {
  kind: DisplayKind;
  title: string;
  description: string;
  icon: string;
  gradient: string;
  path: (tenantId: string, locationId: string) => string;
  needsAuth: boolean;
  // Limit each display to the business types it makes sense for. Salon
  // doesn't need a kitchen board; restaurant doesn't need an appointment
  // board.
  showForBusinessTypes: string[];
}

const DISPLAY_TYPES: DisplayCard[] = [
  {
    kind: "kitchen",
    title: "Kitchen Display",
    description: "Ticket-style board for cooks. Use on kitchen iPad or wall-mounted TV. No login required — just open the URL.",
    icon: "solar:chef-hat-bold",
    gradient: "from-orange-500 to-red-500",
    path: (t, l) => `/kitchen-display/${t}/${l}`,
    needsAuth: false,
    showForBusinessTypes: ["restaurant"],
  },
  {
    kind: "customer",
    title: "Order Status Board",
    description: "Customer-facing board mounted above the counter. Shows 'Now Preparing' and 'Ready for Pickup' order numbers. No login needed — plug a monitor in and forget about it.",
    icon: "solar:bag-check-bold",
    gradient: "from-indigo-500 to-purple-500",
    path: (t, l) => `/order-status/${t}/${l}`,
    needsAuth: false,
    showForBusinessTypes: ["restaurant", "retail"],
  },
  {
    kind: "appointment",
    title: "Next Appointment Board",
    description: "Big-screen board for the salon waiting area. Shows who's being served now and who's next today. Privacy mode by default (booking numbers only) — flip the toggle in Settings to show first names instead.",
    icon: "solar:calendar-bold",
    gradient: "from-pink-500 to-purple-600",
    path: (t, l) => `/appointment-display/${t}/${l}`,
    needsAuth: false,
    showForBusinessTypes: ["salon"],
  },
];

export default function DisplaysPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string>("");
  const [loading, setLoading] = useState(true);
  // Drives which display cards we surface — salon doesn't get Kitchen,
  // restaurant doesn't get the Appointment board, etc.
  const [businessType, setBusinessType] = useState<string>("restaurant");

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    const storedLoc = localStorage.getItem("tap_active_location");
    if (stored) setTenantId(stored);
    if (storedLoc) setSelectedLocationId(storedLoc);
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const loadLocations = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [locRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/locations`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);
      const data = await locRes.json();
      if (data.success) {
        setLocations(data.locations);
        if (!selectedLocationId && data.locations.length > 0) {
          setSelectedLocationId(data.locations[0].id);
        }
      }
      const settingsData = await settingsRes.json();
      if (settingsData.success && settingsData.tenant?.businessType) {
        setBusinessType(settingsData.tenant.businessType);
      }
    } catch {
      toast.error("Failed to load locations");
    } finally {
      setLoading(false);
    }
  }, [tenantId, selectedLocationId]);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const selectedLocation = locations.find((l) => l.id === selectedLocationId);

  const buildUrl = (path: string) => `${origin}${path}`;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied!`);
    } catch {
      toast.error("Failed to copy");
    }
  };

  if (!tenantId) {
    return (
      <div className="p-12 text-center">
        <p className="text-gray-500">Please select a business first</p>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Displays"
        subtitle="Set up kitchen & customer screens for iPads, tablets, and TVs"
      />

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Location selector */}
        {locations.length > 1 && (
          <Card>
            <div className="flex items-center gap-3 flex-wrap">
              <Icon icon="solar:map-point-bold" className="w-5 h-5 text-indigo-600" />
              <span className="font-medium text-gray-900">Choose location:</span>
              <div className="flex gap-2 flex-wrap">
                {locations.map((loc) => (
                  <button
                    key={loc.id}
                    onClick={() => setSelectedLocationId(loc.id)}
                    className={`px-4 py-2 rounded-xl font-medium text-sm transition-all ${
                      selectedLocationId === loc.id
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {loc.name}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Setup instructions */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 border border-indigo-100">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
              <Icon icon="solar:lightbulb-bold" className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">How to set up a display</h3>
              <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                <li>Open Safari / Chrome on the iPad or TV</li>
                <li>Scan the QR code below <strong>or</strong> type the URL</li>
                <li>On iPad: <strong>Share → Add to Home Screen</strong> (behaves like a native app)</li>
                <li>Tap the fullscreen button once loaded</li>
                <li>Mount the device — you're done!</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Display cards */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <div className="animate-pulse space-y-4">
                  <div className="h-8 bg-gray-200 rounded w-1/2" />
                  <div className="h-4 bg-gray-200 rounded w-full" />
                  <div className="h-48 bg-gray-200 rounded" />
                </div>
              </Card>
            ))}
          </div>
        ) : !selectedLocation ? (
          <Card className="text-center py-12">
            <Icon icon="solar:map-point-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Please select a location above to see its displays</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {DISPLAY_TYPES.filter((d) =>
              d.showForBusinessTypes.includes(businessType)
            ).map((display) => {
              const url = buildUrl(display.path(tenantId, selectedLocation.id));
              return (
                <Card key={display.kind} padding="none" className="overflow-hidden">
                  {/* Header */}
                  <div className={`bg-gradient-to-br ${display.gradient} p-5 text-white`}>
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                        <Icon icon={display.icon} className="w-6 h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-lg">{display.title}</h3>
                          {display.needsAuth ? (
                            <Badge variant="warning" size="sm">Login required</Badge>
                          ) : (
                            <Badge variant="success" size="sm">No login needed</Badge>
                          )}
                        </div>
                        <p className="text-sm text-white/90 mt-1">{display.description}</p>
                      </div>
                    </div>
                  </div>

                  {/* QR + URL */}
                  <div className="p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
                      {/* QR code */}
                      <div className="flex-shrink-0 p-3 bg-white rounded-2xl border-2 border-gray-100">
                        <QRCodeSVG value={url} size={160} level="M" />
                      </div>

                      {/* URL + Actions */}
                      <div className="flex-1 w-full space-y-3 min-w-0">
                        <div>
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Display URL
                          </label>
                          <div className="mt-1 flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200">
                            <Icon icon="solar:link-bold" className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <code className="text-xs text-gray-700 truncate flex-1">{url}</code>
                          </div>
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={() => copyToClipboard(url, "URL")}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white font-medium text-sm hover:bg-gray-800 transition-colors"
                          >
                            <Icon icon="solar:copy-bold" className="w-4 h-4" />
                            Copy URL
                          </button>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700 transition-colors"
                          >
                            <Icon icon="solar:arrow-right-up-bold" className="w-4 h-4" />
                            Open
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Tips */}
                    <div className="pt-3 border-t border-gray-100 space-y-2 text-xs text-gray-600">
                      {display.kind === "kitchen" ? (
                        <>
                          <div className="flex items-start gap-2">
                            <Icon icon="solar:tablet-bold" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span><strong>iPad setup:</strong> Open in Safari → Share → Add to Home Screen → launch from home screen for fullscreen app feel</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Icon icon="solar:monitor-bold" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span><strong>Smart TV / Fire TV Stick:</strong> Open the URL in the TV browser, press F11 for fullscreen. Cheap digital signage: Raspberry Pi 4 + Chromium in kiosk mode.</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Icon icon="solar:volume-loud-bold" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span><strong>Sound bell:</strong> Tap the audio icon once in the header to allow autoplay (browser requirement)</span>
                          </div>
                        </>
                      ) : display.kind === "appointment" ? (
                        <>
                          <div className="flex items-start gap-2">
                            <Icon icon="solar:monitor-bold" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span><strong>Mount in the waiting area:</strong> Any HDMI display + Raspberry Pi / Fire TV Stick / cheap mini-PC works. Open the URL full-screen and leave it running all day.</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Icon icon="solar:eye-closed-bold" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span><strong>Privacy by default:</strong> Guests see <code>Guest #0042</code> instead of their name. Flip the "Show customer names on display" toggle in Settings if you'd prefer to show first names.</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Icon icon="solar:refresh-bold" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span><strong>Live updates:</strong> Refreshes every 15 seconds. The "Now serving" panel auto-updates as your staff marks each appointment in progress.</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-start gap-2">
                            <Icon icon="solar:monitor-bold" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span><strong>Mount above the counter:</strong> Plug any HDMI monitor / TV into a Raspberry Pi, Fire TV Stick, or cheap Chromebox. Open the URL full-screen and leave it running.</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Icon icon="solar:users-group-rounded-bold" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span><strong>Customer-friendly:</strong> Auto-refreshes every 5 seconds. Orders show in the "Now Preparing" column, move to "Ready for Pickup" (highlighted green, pulsing) when done.</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Icon icon="solar:volume-loud-bold" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            <span><strong>Optional chime</strong> plays when a new order becomes ready — tap the volume icon once on first load to enable.</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Advanced: IDs */}
        {selectedLocation && (
          <Card>
            <details className="group">
              <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
                <Icon icon="solar:code-bold" className="w-4 h-4" />
                Advanced: raw IDs for custom integrations
                <Icon icon="solar:alt-arrow-down-bold" className="w-4 h-4 ml-auto transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-500 w-24">TENANT ID</span>
                  <code className="flex-1 text-xs text-gray-700 bg-gray-50 px-3 py-2 rounded-lg truncate">{tenantId}</code>
                  <button
                    onClick={() => copyToClipboard(tenantId, "Tenant ID")}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                  >
                    <Icon icon="solar:copy-bold" className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-500 w-24">LOCATION ID</span>
                  <code className="flex-1 text-xs text-gray-700 bg-gray-50 px-3 py-2 rounded-lg truncate">{selectedLocation.id}</code>
                  <button
                    onClick={() => copyToClipboard(selectedLocation.id, "Location ID")}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                  >
                    <Icon icon="solar:copy-bold" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </details>
          </Card>
        )}
      </div>
    </div>
  );
}
