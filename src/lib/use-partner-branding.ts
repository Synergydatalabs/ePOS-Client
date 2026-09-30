"use client";

// Dynamic branding hook — fetches brand config from API based on current hostname.
// All partner pages use this instead of hardcoded logos/colors.
// The branding API resolves the tenant from the hostname (via tenant_resolver.ts).

import { useState, useEffect } from "react";

export interface PartnerBranding {
  tenantName: string;
  brandName: string | null;
  brandLogoUrl: string | null;
  brandFaviconUrl: string | null;
  brandPrimaryColor: string;
  brandAccentColor: string;
  brandBackgroundColor: string;
  poweredByVisible: boolean;
}

// Neutral loading-state defaults — deliberately generic so a first-paint
// flash on ANY partner domain (Oreugo, iTap, future tenants) stays
// visually inert until the /api/partner/branding round-trip fills in the
// real per-host brand. Do NOT put iTap-specific colors here — that would
// cause a purple flash on Oreugo pages before their dark-green loads.
// Per-host defaults happen on the SERVER in the branding API route.
const DEFAULT_BRANDING: PartnerBranding = {
  tenantName: "POS",
  brandName: null,
  brandLogoUrl: null,
  brandFaviconUrl: null,
  brandPrimaryColor: "#4F46E5",
  brandAccentColor: "#6366F1",
  brandBackgroundColor: "#F9FAFB",
  poweredByVisible: true,
};

// Cache branding in memory so we don't re-fetch on every page navigation
let cachedBranding: PartnerBranding | null = null;
let cachedHost: string | null = null;

export function usePartnerBranding() {
  const [branding, setBranding] = useState<PartnerBranding>(cachedBranding || DEFAULT_BRANDING);
  const [loading, setLoading] = useState(!cachedBranding);

  useEffect(() => {
    const currentHost = window.location.hostname;

    // Use cache if same host
    if (cachedBranding && cachedHost === currentHost) {
      setBranding(cachedBranding);
      setLoading(false);
      return;
    }

    async function fetchBranding() {
      try {
        const res = await fetch("/api/partner/branding");
        const data = await res.json();
        if (data.success && data.branding) {
          const b: PartnerBranding = {
            tenantName: data.branding.tenantName || DEFAULT_BRANDING.tenantName,
            brandName: data.branding.brandName,
            brandLogoUrl: data.branding.brandLogoUrl,
            brandFaviconUrl: data.branding.brandFaviconUrl,
            brandPrimaryColor: data.branding.brandPrimaryColor || DEFAULT_BRANDING.brandPrimaryColor,
            brandAccentColor: data.branding.brandAccentColor || DEFAULT_BRANDING.brandAccentColor,
            brandBackgroundColor: data.branding.brandBackgroundColor || DEFAULT_BRANDING.brandBackgroundColor,
            poweredByVisible: data.branding.poweredByVisible ?? true,
          };
          cachedBranding = b;
          cachedHost = currentHost;
          setBranding(b);
        }
      } catch {
        // Use defaults on error
      } finally {
        setLoading(false);
      }
    }

    fetchBranding();
  }, []);

  // Helper: display name (brandName or tenantName)
  const displayName = branding.brandName || branding.tenantName;

  // Helper: CSS custom properties for dynamic theming
  const cssVars = {
    "--brand-primary": branding.brandPrimaryColor,
    "--brand-accent": branding.brandAccentColor,
    "--brand-bg": branding.brandBackgroundColor,
  } as React.CSSProperties;

  return { branding, loading, displayName, cssVars };
}
