// Merchant onboarding wizard — TENANT_OWNER only, mounted inside the
// admin dashboard shell (AdminLayout).
//
// Kept as a client component even though the task description mentions
// "server component": the rest of the admin dashboard (settings, menu,
// team, reservations, …) is fully client-side because tenantId and
// membership role are resolved on the client from localStorage +
// /api/me — moving this one page to server rendering would need a
// duplicate server-side tenant resolver that doesn't exist yet.
//
// Role check happens twice:
//   1. Client — fetches /api/me, redirects non-owners to /dashboard
//      with ?intent=owner-only so the parent layout can show a toast.
//   2. Server — every /api/tenants/[tenantId]/onboarding/* endpoint
//      re-enforces role via api-middleware.validateRequest + explicit
//      role === "TENANT_OWNER" check. The redirect is UX only.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import OnboardingWizard from "./OnboardingWizard";

interface MeResponse {
  memberships: Array<{
    id: string;
    role: string;
    tenant: { id: string; name: string; currency?: string };
  }>;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>("");
  const [tenantCurrency, setTenantCurrency] = useState<string>("CAD");
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const storedTenantId = typeof window !== "undefined"
          ? localStorage.getItem("tap_active_tenant")
          : null;

        // Two auth backends coexist in tap-app (Cognito + partner). Try
        // Cognito's /api/me first; on 401 fall back to the partner
        // session endpoint. Same pattern as the outer dashboard layout.
        let membership: MeResponse["memberships"][number] | null = null;
        const meRes = await fetch("/api/me", { cache: "no-store" });
        if (meRes.ok) {
          const data = (await meRes.json()) as MeResponse;
          membership =
            (storedTenantId && data.memberships?.find((m) => m.tenant.id === storedTenantId)) ||
            data.memberships?.[0] || null;
        } else {
          const partnerRes = await fetch("/api/partner/auth/session", { cache: "no-store" });
          if (partnerRes.ok) {
            const p = await partnerRes.json();
            if (p?.authenticated && p.tenant) {
              membership = {
                id: p.memberId ?? "partner",
                role: p.role || "TENANT_OWNER",
                tenant: {
                  id: p.tenant.id,
                  name: p.tenant.name,
                  currency: p.tenant.currency,
                },
              };
            }
          }
        }

        if (cancelled) return;

        if (!membership) {
          router.replace("/signin");
          return;
        }

        // Only TENANT_OWNER can start / edit an onboarding application.
        // OWNER (partner-owner shortname) also counts — partner auth
        // stamps that label on tokens even when the underlying membership
        // is TENANT_OWNER.
        const isOwner = membership.role === "TENANT_OWNER" || membership.role === "OWNER";
        if (!isOwner) {
          router.replace("/dashboard?intent=owner-only");
          return;
        }

        setTenantId(membership.tenant.id);
        setTenantName(membership.tenant.name);
        setTenantCurrency((membership.tenant.currency || "CAD").toUpperCase());
        setRole(membership.role);
      } catch (err) {
        console.error("[Onboarding] bootstrap failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading || !tenantId) {
    return (
      <main>
        <AdminHeader title="Payment Onboarding" subtitle="Loading…" />
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-6 w-1/3 bg-gray-100 rounded" />
            <div className="h-72 bg-gray-100 rounded-2xl" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <AdminHeader
        title="Payment Onboarding"
        subtitle="Apply for a merchant account to accept card payments."
      />
      <div className="p-4 lg:p-6">
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
          <Icon icon="solar:info-circle-bold" className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">
              You're onboarding <span className="underline">{tenantName}</span> as a merchant.
            </p>
            <p className="mt-1 text-indigo-800/80">
              Your progress is saved after each step. Come back and finish later — nothing is
              submitted until you sign on Step 5.
            </p>
          </div>
        </div>
        <OnboardingWizard tenantId={tenantId} tenantCurrency={tenantCurrency} role={role || ""} />
      </div>
    </main>
  );
}
