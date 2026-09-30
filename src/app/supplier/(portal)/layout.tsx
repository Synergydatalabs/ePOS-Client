"use client";

// Supplier portal layout — wraps every page under /supplier/(portal)/*.
// The (portal) route group means /supplier/accept/[token] is NOT wrapped
// by this layout (it uses the root layout), which keeps the invite accept
// page as a clean full-page form without sidebar chrome.
//
// Auth model: we use the partner-auth cookie (same one merchants use). On
// mount we hit /api/partner/auth/session — if it returns a supplier tenant
// we render the portal; if it returns a merchant tenant we bounce them to
// /dashboard; if it returns nothing we bounce to /login.

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import UserProfileDrawer from "@/components/shared/UserProfileDrawer";
import SupportChatButton from "@/components/support/SupportChatButton";

interface SupplierSession {
  tenantId: string;
  tenantName: string;
  displayName: string | null;
  brandLogoUrl: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  userEmail: string;
  onboardingStatus: string | null;
}

const NAV_ITEMS = [
  { href: "/supplier", label: "Dashboard", icon: "solar:home-2-bold", exact: true },
  { href: "/supplier/products", label: "Products", icon: "solar:box-bold" },
  // Phase F #2 (2026-08-27): supplier-issued invoices — pick from catalog,
  // email a payment link + QR to any external customer.
  { href: "/supplier/invoices", label: "Invoices", icon: "solar:bill-list-bold" },
  // Phase I #1 (2026-09-08): reusable payment-link templates. Supplier
  // creates once per product/campaign, gets a short URL to share on
  // partner sites; each click generates a fresh invoice.
  { href: "/supplier/payment-links", label: "Payment Links", icon: "solar:link-circle-bold" },
  // Phase G #1 (2026-08-30): recurring supplier subscriptions.
  { href: "/supplier/subscriptions", label: "Subscriptions", icon: "solar:refresh-circle-bold" },
  { href: "/supplier/orders", label: "Purchase Orders", icon: "solar:clipboard-list-bold" },
  // Phase F #3 (2026-08-27): T&C management + acceptance log — chargeback
  // defence for the invoicing flow.
  { href: "/supplier/terms", label: "Terms & Conditions", icon: "solar:shield-check-bold" },
  // Phase F #6h (2026-08-28): searchable ledger of every customer T&C
  // acceptance captured on the pay page. Each row → downloadable
  // certificate (name/IP/geo/timestamp/full T&C body/SHA-256 hash).
  { href: "/supplier/legal-records", label: "Legal Records", icon: "solar:file-check-bold" },
  // Phase F #6c (2026-08-27): Marketplace + My Purchases were briefly
  // exposed here for suppliers to double as buyers; user pulled them
  // back out — supplier portal is seller-only. The public /marketplace
  // route still exists for anyone signed in as a buyer/general tenant.
  { href: "/supplier/customers", label: "Customers", icon: "solar:shop-bold" },
  // Phase C (2026-07-30): payment gateway onboarding + status
  { href: "/supplier/payments", label: "Payments", icon: "solar:card-transfer-bold" },
  { href: "/supplier/statements", label: "Statements", icon: "solar:document-text-bold" },
  { href: "/supplier/warehouses", label: "Warehouses", icon: "solar:home-add-bold" },
  { href: "/supplier/settings", label: "Settings", icon: "solar:settings-bold" },
];

export default function SupplierPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SupplierSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/partner/auth/session");
        const data = await res.json();
        if (!data.authenticated) {
          // Phase I #4 (2026-09-12): follow the server's redirect hint
          // for PENDING_APPROVAL supplier tenants so they land on the
          // verification wizard instead of the login screen.
          if (data.redirect) {
            window.location.href = data.redirect;
            return;
          }
          router.replace("/login");
          return;
        }
        // Guard: only supplier tenants may enter this portal. Merchants
        // land on their own dashboard even if they somehow navigate here.
        if (data.tenant?.businessType !== "supplier") {
          router.replace("/dashboard");
          return;
        }

        // Get the SupplierProfile so we can show onboarding hints. Cheap
        // extra call, fires once on layout mount, cached implicitly by
        // React until the next tenant switch.
        let onboardingStatus: string | null = null;
        try {
          const profileRes = await fetch("/api/supplier/me");
          if (profileRes.ok) {
            const profileData = await profileRes.json();
            onboardingStatus = profileData.profile?.onboardingStatus || null;
          }
        } catch {
          // Non-fatal — dashboard can still render, funnel tile just won't show.
        }

        setSession({
          tenantId: data.tenant.id,
          tenantName: data.tenant.name,
          displayName: data.branding?.brandName || null,
          brandLogoUrl: data.branding?.brandLogoUrl || null,
          userFirstName: data.user?.firstName || null,
          userLastName: data.user?.lastName || null,
          userEmail: data.user?.email || "",
          onboardingStatus,
        });

        document.title = `${data.tenant.name} — Supplier Portal`;
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  const signOut = async () => {
    try {
      await fetch("/api/partner/auth/logout", { method: "POST" });
      localStorage.removeItem("partner_tenant_id");
      localStorage.removeItem("partner_tenant_slug");
      localStorage.removeItem("tap_active_tenant");
      localStorage.removeItem("partner_branding");
      window.location.href = `${window.location.origin}/login`;
    } catch {
      toast.error("Sign out failed");
    }
  };

  const isActive = (item: (typeof NAV_ITEMS)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    // Already redirected in useEffect; return null so nothing flashes.
    return null;
  }

  const displayName = session.tenantName;
  const userInitials =
    (session.userFirstName?.[0] || "") + (session.userLastName?.[0] || "") || "S";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <Icon icon="solar:hamburger-menu-linear" className="w-6 h-6" />
        </button>
        <span className="font-bold text-gray-900 truncate">{displayName}</span>
        <div className="w-9" />
      </div>

      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 z-50 transform transition-transform lg:translate-x-0 flex flex-col ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {session.brandLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.brandLogoUrl}
                alt={displayName}
                className="w-10 h-10 rounded-xl object-contain bg-white"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                <Icon icon="solar:box-bold" className="w-5 h-5 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-bold text-gray-900 truncate">{displayName}</p>
              <p className="text-xs text-gray-500">Supplier Portal</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Icon icon={item.icon} className="w-5 h-5 flex-shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User footer — click opens the profile drawer (name edit, change
             password, sign out). Replaces the standalone sign-out button. */}
        <div className="p-3 border-t border-gray-200">
          <button
            onClick={() => setProfileOpen(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors text-left"
          >
            <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold text-sm flex-shrink-0">
              {userInitials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm text-gray-900 truncate">
                {[session.userFirstName, session.userLastName].filter(Boolean).join(" ") ||
                  session.userEmail}
              </p>
              <p className="text-xs text-gray-500 truncate">{session.userEmail}</p>
            </div>
            <Icon icon="solar:alt-arrow-right-linear" className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen">{children}</main>

      {/* Profile drawer — shared across all shells. Sign-out runs the
           supplier-specific logout (same path as the old button). */}
      <UserProfileDrawer
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSignOut={signOut}
      />

      {/* Phase 3b — support chat floating button. */}
      <SupportChatButton />
    </div>
  );
}
