"use client";

// ============================================================================
// /dashboard/admin/integrations
// Hub page listing all third-party integrations a tenant can connect.
// Phase 5d: WhatsApp Business. Future: Google Business, Stripe, Mailchimp.
// ============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";

interface WhatsAppStatus {
  connected: boolean;
  source: "tenant" | "shared" | "none";
  displayName: string | null;
  phoneNumberId: string | null;
  connectionType: string | null;
  usingSharedSender: boolean;
}

export default function IntegrationsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTenantId(localStorage.getItem("tap_active_tenant"));
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/tenants/${tenantId}/integrations/whatsapp`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setWaStatus(data.whatsapp);
      })
      .catch((err) => console.error("Failed to load WhatsApp status:", err))
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (!tenantId || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Integrations" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Integrations"
        subtitle="Connect WhatsApp, SMS, and other channels to talk to your guests"
      />

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* WhatsApp Business card */}
          <IntegrationCard
            icon="logos:whatsapp-icon"
            title="WhatsApp Business"
            description="Send waitlist + reservation messages from your own WhatsApp number. Guests reply 1 to confirm, 9 to cancel — all auto-handled."
            href="/dashboard/admin/integrations/whatsapp"
            status={
              waStatus?.connected
                ? waStatus.source === "tenant"
                  ? { label: "Connected", tone: "green", detail: waStatus.displayName || waStatus.phoneNumberId || "" }
                  : { label: "Using shared sender", tone: "amber", detail: "Connect your own to use your business name on outgoing messages." }
                : { label: "Not connected", tone: "gray", detail: "" }
            }
          />

          {/* SMS — self-serve: shared ZASHX SNS sender (default) or BYO Twilio */}
          <IntegrationCard
            icon="solar:chat-line-bold"
            iconColor="#3b82f6"
            title="SMS"
            description="Fallback channel for waitlist pings and reservation reminders when guests aren't on WhatsApp. Use the shared sender or bring your own Twilio number."
            href="/dashboard/admin/integrations/sms"
            status={{ label: "Set up", tone: "green", detail: "Pick shared (no setup) or bring your own Twilio" }}
          />

          {/* Google Business Profile — OAuth-connected, sync hours/photos/reservation link, pull reviews */}
          <IntegrationCard
            icon="solar:gallery-wide-bold"
            iconColor="#a855f7"
            title="Google Business Profile"
            description="Connect your Google listing to sync hours, address, and photos automatically, and pull customer reviews into your dashboard."
            href="/dashboard/admin/integrations/google-business"
            status={{ label: "Set up", tone: "green", detail: "Sign in with the Google account that owns your listing" }}
          />

          <IntegrationCard
            icon="solar:card-bold"
            iconColor="#10b981"
            title="Card on file (Global Payments)"
            description="Save a card when a customer books a reservation so you can automatically charge a deposit or a no-show fee if they don't show up. Uses the same Global Payments terminal you already process in-person sales on — no separate signup needed."
            href="/dashboard/admin/terminals"
            status={{ label: "Active", tone: "green", detail: "Linked to your terminal — manage from Payments → Terminals" }}
          />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------

function IntegrationCard({
  icon,
  iconColor,
  title,
  description,
  href,
  status,
  disabled,
}: {
  icon: string;
  iconColor?: string;
  title: string;
  description: string;
  href: string | null;
  status: { label: string; tone: "green" | "amber" | "gray"; detail?: string };
  disabled?: boolean;
}) {
  const toneClasses = {
    green: "bg-green-50 text-green-700 border-green-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    gray: "bg-gray-100 text-gray-600 border-gray-200",
  }[status.tone];

  const inner = (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-5 transition-all ${
        href && !disabled ? "hover:border-indigo-300 hover:shadow-md cursor-pointer" : ""
      } ${disabled ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center">
          <Icon icon={icon} className="w-7 h-7" style={iconColor ? { color: iconColor } : {}} />
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${toneClasses}`}>
          {status.label}
        </span>
      </div>
      <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
      {status.detail && (
        <p className="text-xs text-gray-500 mt-3 italic">{status.detail}</p>
      )}
      {href && !disabled && (
        <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-indigo-600">
          <span>Configure</span>
          <Icon icon="solar:arrow-right-bold" className="w-4 h-4" />
        </div>
      )}
    </div>
  );

  if (href && !disabled) {
    return <Link href={href}>{inner}</Link>;
  }
  return inner;
}
