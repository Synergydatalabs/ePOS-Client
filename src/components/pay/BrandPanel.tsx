"use client";

// Desktop-only right-side panel for the customer payment page.
//
// On iTap: shows iTap product branding.
// On white-label partner domains (Oreugo etc.): shows the partner's own
// logo + business name, with the Global Payments partner mark — partners
// are GP-certified and want that attribution; we don't promote iTap on
// their checkout.
//
// Hidden under `lg` so the mobile flow stays as-is (most QR scans happen
// on a phone).

import { Icon } from "@iconify/react";

interface BrandPanelProps {
  isPartner: boolean;
  tenantName?: string | null;
  tenantLogoUrl?: string | null;
}

export default function BrandPanel({
  isPartner,
  tenantName,
  tenantLogoUrl,
}: BrandPanelProps) {
  return (
    <aside className="hidden lg:flex relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-700 to-indigo-900 text-white p-10 flex-col justify-between min-h-[640px] shadow-xl shadow-indigo-200/40">
      {/* Decorative orbs */}
      <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 bg-white/10 rounded-full blur-2xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 w-80 h-80 bg-fuchsia-400/20 rounded-full blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 right-10 w-32 h-32 bg-cyan-300/20 rounded-full blur-2xl" />

      {/* Top — brand mark */}
      <div className="relative">
        {isPartner ? (
          <>
            {tenantLogoUrl ? (
              <div className="inline-flex items-center gap-3 mb-6">
                <img
                  src={tenantLogoUrl}
                  alt={tenantName || "Business logo"}
                  className="w-14 h-14 rounded-2xl bg-white p-2 object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
                {tenantName && (
                  <span className="text-2xl font-bold tracking-tight">
                    {tenantName}
                  </span>
                )}
              </div>
            ) : (
              tenantName && (
                <h2 className="text-3xl font-bold tracking-tight mb-6">
                  {tenantName}
                </h2>
              )
            )}
            <p className="text-indigo-100/90 text-lg leading-relaxed max-w-sm">
              Easy. Secure. Smart restaurant payments.
            </p>
          </>
        ) : (
          <>
            <div className="inline-flex items-center gap-3 mb-6">
              <img
                src="/images/logo/itap-wordmark.png"
                alt="iTap"
                className="h-12 w-auto"
              />
            </div>
            <p className="text-indigo-100/90 text-lg leading-relaxed max-w-sm">
              Easy. Secure. Smart restaurant payments.
            </p>
          </>
        )}
      </div>

      {/* Middle — feature/trust strip */}
      <div className="relative space-y-3 my-8">
        {[
          { icon: "solar:shield-check-bold", text: "Bank-grade 256-bit encryption" },
          { icon: "solar:card-search-bold", text: "PCI DSS compliant" },
          { icon: "solar:tag-price-bold", text: "Zero hidden fees" },
          { icon: "solar:clock-circle-bold", text: "Settled in seconds" },
        ].map((f) => (
          <div key={f.text} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
              <Icon icon={f.icon} className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm text-white/90 font-medium">{f.text}</span>
          </div>
        ))}
      </div>

      {/* Footer — attribution */}
      <div className="relative">
        <div className="pt-6 border-t border-white/15">
          {isPartner ? (
            <div className="flex items-center gap-2 text-white/80 text-xs">
              <Icon icon="solar:verified-check-bold" className="w-4 h-4 text-emerald-300" />
              <span>
                Powered by{" "}
                <span className="font-semibold text-white">Global Payments</span>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-white/80 text-xs">
              <Icon icon="solar:verified-check-bold" className="w-4 h-4 text-emerald-300" />
              <span>
                Powered by{" "}
                <span className="font-semibold text-white">iTap</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
