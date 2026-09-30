// Hook to determine correct URL prefix for partner pages.
// On partner domains (oreugo.ca): /login, /signup, /dashboard (clean URLs)
// On standard domain (localhost, zashx.com): /partner/login, /partner/signup, etc.

"use client";

import { useMemo } from "react";

const PARTNER_DOMAINS = [
  "oreugo.ca",
  "www.oreugo.ca",
];

export function usePartnerRoutes() {
  const isPartnerDomain = useMemo(() => {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname.toLowerCase();
    return PARTNER_DOMAINS.includes(host);
  }, []);

  const prefix = isPartnerDomain ? "" : "/partner";

  return {
    isPartnerDomain,
    home: isPartnerDomain ? "/" : "/partner",
    login: `${prefix}/login`,
    signup: `${prefix}/signup`,
    resetPassword: `${prefix}/reset-password`,
    dashboard: `${prefix}/dashboard`,
  };
}
