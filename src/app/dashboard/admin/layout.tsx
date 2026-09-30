"use client";

import { useState, useEffect } from "react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { usePartnerBranding } from "@/lib/use-partner-branding";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [tenantName, setTenantName] = useState<string | undefined>();
  const [businessType, setBusinessType] = useState<string | undefined>();
  const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // PHASE 2c (2026-08): drive the "Payment Onboarding" sidebar entry — role
  // gates visibility, status renders the chip. Both are best-effort; a
  // failure to load either just hides the entry / chip rather than crashing
  // the whole admin shell.
  const [userRole, setUserRole] = useState<string | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<string | null>(null);

  // PHASE 7a (2026-05-18): pull partner branding so the admin chrome (sidebar,
  // header, accent buttons) uses the partner's logo + primary color instead of
  // the hardcoded indigo. The hook auto-resolves by hostname.
  const { branding, displayName, cssVars } = usePartnerBranding();

  useEffect(() => {
    // Load tenant info
    const loadTenant = async () => {
      const tenantId = localStorage.getItem("tap_active_tenant");
      if (!tenantId) return;

      try {
        const res = await fetch(`/api/tenants/${tenantId}/settings`);
        const data = await res.json();
        if (data.success && data.tenant) {
          setTenantName(data.tenant.name);
          setBusinessType(data.tenant.businessType || "restaurant");
          // The MERCHANT'S own uploaded logo (tenant_settings.brand_logo_url)
          // wins over the hostname-resolved partner brand. Same reasoning as
          // tenantName: a shop admin on Andy's Pizza should see Andy's logo,
          // not the whitelabel partner's (Oreugo).
          setTenantLogoUrl(data.tenant.settings?.brandLogoUrl ?? null);
        }
      } catch (error) {
        console.error("Failed to load tenant:", error);
      }
    };

    // PHASE 2c: resolve the current user's role for this tenant so the
    // sidebar can hide TENANT_OWNER-only entries. Same two-provider dance
    // as the outer dashboard shell — Cognito first, partner fallback.
    const loadRole = async () => {
      try {
        const tenantId = localStorage.getItem("tap_active_tenant");
        if (!tenantId) return;

        const meRes = await fetch("/api/me", { cache: "no-store" });
        if (meRes.ok) {
          const data = await meRes.json();
          const m = (data.memberships || []).find(
            (x: { tenant: { id: string } }) => x.tenant.id === tenantId
          );
          if (m?.role) {
            setUserRole(m.role);
            return;
          }
        }
        const partnerRes = await fetch("/api/partner/auth/session", { cache: "no-store" });
        if (partnerRes.ok) {
          const p = await partnerRes.json();
          if (p?.authenticated) setUserRole(p.role || "OWNER");
        }
      } catch (error) {
        console.error("Failed to load role:", error);
      }
    };

    // PHASE 2c: fetch the current merchant onboarding application (if any)
    // to render the chip on the sidebar link. Silent fail is fine — no chip
    // is a valid state ("never started").
    const loadOnboarding = async () => {
      try {
        const tenantId = localStorage.getItem("tap_active_tenant");
        if (!tenantId) return;
        const res = await fetch(
          `/api/tenants/${tenantId}/onboarding/application`,
          { cache: "no-store" }
        );
        if (!res.ok) return; // 403 for non-owners is expected + fine
        const data = await res.json();
        if (data?.application?.status) setOnboardingStatus(data.application.status);
      } catch {
        // silent — chip stays hidden
      }
    };

    loadTenant();
    loadRole();
    loadOnboarding();
  }, []);

  return (
    // PHASE 7a: cssVars injects `--brand-primary` / `--brand-accent` /
    // `--brand-bg` at this scope. The admin sidebar + header + any descendant
    // that reads `var(--brand-primary, #4f46e5)` will pick these up. The
    // fallback (#4f46e5 = indigo-600) keeps the iTap look on the standard
    // domain where no partner branding resolves.
    <div className="min-h-screen bg-gray-50 flex font-poppins" style={cssVars}>
      <AdminSidebar
        // The MERCHANT'S name wins in the admin portal — a shop admin
        // logged into Andy's Pizza on oreugo.ca should see "Andy's Pizza"
        // in the sidebar, not the whitelabel partner ("Oreugo"). Only
        // fall back to the partner brand name if the tenant name hasn't
        // loaded yet, so there's no flash of the wrong label.
        tenantName={tenantName || displayName}
        // Same precedence as tenantName: the merchant's own uploaded logo
        // wins; the hostname-resolved partner logo is only a fallback for
        // the flash before the tenant settings load (and for tenants that
        // never uploaded a logo of their own).
        tenantLogoUrl={tenantLogoUrl || branding.brandLogoUrl}
        businessType={businessType}
        userRole={userRole}
        onboardingStatus={onboardingStatus}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      {/*
        NOTE: AdminSidebar uses `.admin-sidebar` CSS class which is
        `fixed left-0 top-0 w-64`. The OUTER `src/app/dashboard/layout.tsx`
        already applies `lg:ml-64` to its <main> to offset for the (overlapping)
        sidebar — so we must NOT add another `ml-64` here, or content shifts
        right by 512px and a 256px empty gap appears between the sidebar
        and the page.

        If the sidebar is collapsed (w-20), the outer layout still reserves
        256px → so the page shifts left visually only on collapse. We use a
        negative margin on collapse to claw back the freed 176px.
      */}
      <main
        className={`flex-1 transition-all duration-300 ${
          sidebarCollapsed ? "lg:-ml-44" : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
}
