"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { LocationProvider } from "@/contexts/LocationContext";
import LocationPicker from "@/components/admin/LocationPicker";
import UserProfileDrawer from "@/components/shared/UserProfileDrawer";
import SupportChatButton from "@/components/support/SupportChatButton";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  businessType?: string;
}

/**
 * Routes that should render without the default p-4/lg:p-8 padding from
 * the dashboard shell. Canvas-based editors (floor plan, virtual tour, live
 * floor view) span edge-to-edge and handle their own internal padding.
 */
const FULL_WIDTH_ROUTES = [
  "/dashboard/admin/floor-plan",
  "/dashboard/admin/virtual-tour",
  "/dashboard/pos/floor-view",
];

function isFullWidthRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return FULL_WIDTH_ROUTES.some((r) => pathname.startsWith(r));
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [activeTenant, setActiveTenant] = useState<Tenant | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showTenantSwitcher, setShowTenantSwitcher] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"cognito" | "partner" | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [assignedLocationIds, setAssignedLocationIds] = useState<string[]>([]);
  const [partnerBranding, setPartnerBranding] = useState<{
    brandName?: string;
    brandLogoUrl?: string;
    brandPrimaryColor?: string;
  } | null>(() => {
    // Restore from localStorage on mount to prevent flash
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("partner_branding");
      if (cached) try { return JSON.parse(cached); } catch { /* ignore */ }
    }
    return null;
  });

  // Set title from cached branding on mount
  useEffect(() => {
    if (partnerBranding?.brandName) {
      document.title = `${partnerBranding.brandName} | Admin Portal`;
    }
  }, []);

  // Check for partner session if NextAuth is not authenticated
  useEffect(() => {
    if (status === "authenticated") {
      setAuthMode("cognito");
    } else if (status === "unauthenticated") {
      // Try partner session before redirecting
      fetch("/api/partner/auth/session")
        .then((res) => res.json())
        .then((data) => {
          if (data.authenticated) {
            setAuthMode("partner");
            const tenant = data.tenant;
            if (tenant) {
              setActiveTenant({ id: tenant.id, name: tenant.name, slug: tenant.slug, businessType: tenant.businessType || "restaurant" });
              setTenants([{ id: tenant.id, name: tenant.name, slug: tenant.slug, businessType: tenant.businessType || "restaurant" }]);
              localStorage.setItem("tap_active_tenant", tenant.id);
            }
            // Partner auth = owner-level access to all locations
            setUserRole("OWNER");
            setAssignedLocationIds([]);
            if (data.branding) {
              setPartnerBranding(data.branding);
              localStorage.setItem("partner_branding", JSON.stringify(data.branding));
              document.title = `${data.branding.brandName || tenant?.name || "Dashboard"} | Admin Portal`;
            }
          } else {
            // Phase I #4 (2026-09-12): a PENDING_APPROVAL tenant's
            // session cookie is still valid but they can't enter the
            // dashboard yet. Server hands back a `redirect` hint to the
            // verification wizard — honor it instead of bouncing them
            // to /signin (which would feel like the login was broken).
            if (data.redirect) {
              window.location.href = data.redirect;
            } else {
              router.push("/signin");
            }
          }
        })
        .catch(() => {
          router.push("/signin");
        });
    }
  }, [status, router]);

  useEffect(() => {
    async function fetchTenants() {
      try {
        const response = await fetch("/api/me");
        const data = await response.json();

        if (data.success && data.memberships?.length > 0) {
          const tenantList = data.memberships.map((m: any) => ({
            id: m.tenant.id,
            name: m.tenant.name,
            slug: m.tenant.slug,
            businessType: m.tenant.businessType || "restaurant",
          }));
          setTenants(tenantList);

          // Set active tenant from localStorage or first tenant
          const storedTenantId = localStorage.getItem("tap_active_tenant");
          const stored = tenantList.find((t: Tenant) => t.id === storedTenantId);
          const selectedTenant = stored || tenantList[0];
          setActiveTenant(selectedTenant);

          // Track user's role + assigned locations for the selected tenant
          const matchingMembership = data.memberships.find((m: any) => m.tenant.id === selectedTenant.id);
          if (matchingMembership) {
            setUserRole(matchingMembership.role || null);
            setAssignedLocationIds(matchingMembership.locationIds || []);
          }

          // Always save to localStorage to ensure it's set on initial load
          localStorage.setItem("tap_active_tenant", selectedTenant.id);
        } else {
          router.push("/activate");
        }
      } catch (error) {
        console.error("Failed to fetch tenants:", error);
      }
    }

    if (authMode === "cognito") {
      fetchTenants();
    }
  }, [authMode, router]);

  const switchTenant = (tenant: Tenant) => {
    setActiveTenant(tenant);
    localStorage.setItem("tap_active_tenant", tenant.id);
    setShowTenantSwitcher(false);
    router.refresh();
  };

  // Hostname-aware sign-out (Phase 7a) — extracted so the profile drawer
  // and the old inline button both fire the same logic. Cognito vs partner
  // branches unchanged from before.
  const handleSignOut = () => {
    const origin = window.location.origin;
    if (authMode === "partner") {
      fetch("/api/partner/auth/logout", { method: "POST" }).then(() => {
        localStorage.removeItem("partner_tenant_id");
        localStorage.removeItem("partner_tenant_slug");
        localStorage.removeItem("tap_active_tenant");
        localStorage.removeItem("partner_branding");
        window.location.href = `${origin}/`;
      });
    } else {
      signOut({ callbackUrl: `${origin}/signin` });
    }
  };

  const isSalon = activeTenant?.businessType === "salon";
  const isRetail = activeTenant?.businessType === "retail";
  const isCab = activeTenant?.businessType === "cab";

  // Role → capability. Kept in sync with the dashboard page's
  // MANAGER_ROLES set. Owner-level partner-auth resolves to "OWNER"
  // (see the effect above) and gets manager privileges here.
  const managerRoles = new Set([
    "TENANT_OWNER",
    "OWNER",
    "POS_ADMIN",
    "POS_MANAGER",
  ]);
  const isManager = userRole ? managerRoles.has(userRole) : false;
  const isKitchenOnly = userRole === "KITCHEN_STAFF";

  // Build the nav from a single source-of-truth list, then filter by
  // role. Each entry declares which roles can see it — additive, so
  // higher roles never miss an item lower roles have. If userRole isn't
  // loaded yet (initial paint), we optimistically show manager-level
  // items to avoid a flash; the strict server-side guards on each API
  // route are the actual security boundary.
  interface NavEntry {
    href: string;
    icon: string;
    label: string;
    managerOnly?: boolean;   // hidden from staff / kitchen
    kitchenAllowed?: boolean; // shown to kitchen-only roles (default: hide)
    // Opens in a new browser tab (target=_blank). Used for surfaces meant
    // to live on a second monitor — Customer Display, etc. — so the
    // operator's main POS tab isn't disturbed.
    newTab?: boolean;
  }

  const allNavItems: NavEntry[] = isCab
    ? [
        { href: "/dashboard", icon: "solar:home-2-bold", label: "Dashboard" },
        { href: "/dashboard/admin/dispatch", icon: "solar:radar-2-bold", label: "Dispatch" },
        { href: "/dashboard/admin/trips", icon: "solar:route-bold", label: "Trips" },
        { href: "/dashboard/admin/drivers", icon: "solar:user-id-bold", label: "Drivers", managerOnly: true },
        { href: "/dashboard/admin", icon: "solar:widget-bold", label: "Admin", managerOnly: true },
        { href: "/dashboard/settings", icon: "solar:settings-bold", label: "Settings", managerOnly: true },
      ]
    : isSalon
      ? [
          { href: "/dashboard", icon: "solar:home-2-bold", label: "Dashboard" },
          { href: "/dashboard/pos", icon: "solar:cash-out-bold", label: "Checkout" },
          { href: "/dashboard/invoices", icon: "solar:document-text-bold", label: "Invoices", managerOnly: true },
          { href: "/dashboard/appointments", icon: "solar:calendar-bold", label: "Appointments" },
          { href: "/dashboard/staff", icon: "solar:users-group-rounded-bold", label: "Staff", managerOnly: true },
          { href: "/dashboard/admin", icon: "solar:widget-bold", label: "Admin", managerOnly: true },
          { href: "/dashboard/settings", icon: "solar:settings-bold", label: "Settings", managerOnly: true },
        ]
      : isRetail
        ? [
            { href: "/dashboard", icon: "solar:home-2-bold", label: "Dashboard" },
            { href: "/dashboard/pos", icon: "solar:cart-large-2-bold", label: "Register" },
            { href: "/dashboard/invoices", icon: "solar:document-text-bold", label: "Invoices", managerOnly: true },
            { href: "/dashboard/staff", icon: "solar:users-group-rounded-bold", label: "Staff", managerOnly: true },
            { href: "/dashboard/admin", icon: "solar:widget-bold", label: "Admin", managerOnly: true },
            { href: "/dashboard/settings", icon: "solar:settings-bold", label: "Settings", managerOnly: true },
          ]
        : [
            { href: "/dashboard", icon: "solar:home-2-bold", label: "Dashboard" },
            { href: "/dashboard/pos", icon: "solar:cash-out-bold", label: "POS" },
            { href: "/dashboard/invoices", icon: "solar:document-text-bold", label: "Invoices", managerOnly: true },
            { href: "/dashboard/kitchen", icon: "solar:chef-hat-bold", label: "Kitchen Display", kitchenAllowed: true },
            { href: "/dashboard/display", icon: "solar:monitor-bold", label: "Customer Display", newTab: true },
            { href: "/dashboard/staff", icon: "solar:users-group-rounded-bold", label: "Staff", managerOnly: true },
            { href: "/dashboard/admin", icon: "solar:widget-bold", label: "Admin", managerOnly: true },
            { href: "/dashboard/settings", icon: "solar:settings-bold", label: "Settings", managerOnly: true },
          ];

  const navItems = allNavItems.filter((item) => {
    // Kitchen role sees Dashboard + anything explicitly kitchenAllowed.
    // Nothing else — no POS access, no invoices.
    if (isKitchenOnly) {
      return item.href === "/dashboard" || item.kitchenAllowed;
    }
    // Non-manager, non-kitchen (= POS_STAFF): hide managerOnly entries.
    if (!isManager && item.managerOnly) return false;
    return true;
  });

  // Client-side route guard — if a staff/kitchen user lands on a
  // manager-only path (bookmark, typed URL, back button after role
  // change), bounce them to the dashboard rather than let them see
  // an admin page that just happens to render "loading…". Only fires
  // once userRole is loaded so we don't bounce mid-hydration.
  //
  // This is a UX safety net, NOT the security boundary. Every sensitive
  // API endpoint should validate role server-side via validateRequest.
  useEffect(() => {
    if (!userRole || !pathname) return;
    if (isManager) return;
    const managerOnlyHrefs = allNavItems
      .filter((n) => n.managerOnly)
      .map((n) => n.href);
    const onManagerPath = managerOnlyHrefs.some((h) => pathname.startsWith(h));
    if (onManagerPath) {
      router.replace("/dashboard");
    }
  }, [userRole, pathname, isManager, router]);

  if (status === "loading" || (!activeTenant && !authMode)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <Icon icon="solar:hamburger-menu-linear" className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-2">
            {/* PHASE 7a (2026-05-18): removed hardcoded "Oreugo" fallback.
                If partner has neither logo nor brandName, show the active
                tenant's name; if even that's missing, show a generic word
                that doesn't lock us to one partner. */}
            {partnerBranding?.brandLogoUrl ? (
              <img src={partnerBranding.brandLogoUrl} alt={partnerBranding.brandName || "Logo"} className="h-8 object-contain" />
            ) : (
              <span className="font-bold text-gray-900">
                {partnerBranding?.brandName || activeTenant?.name || "Dashboard"}
              </span>
            )}
          </div>

          <button
            onClick={() => setShowTenantSwitcher(!showTenantSwitcher)}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <Icon icon="solar:buildings-bold" className="w-6 h-6 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 z-50 transform transition-transform lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Dedicated logo header — when the merchant has uploaded a brand
              logo, give it a proper centered slot at the top of the sidebar
              instead of squeezing it into a 32px icon next to the switcher.
              Matches the admin sidebar's treatment. No slot at all when
              there's no logo (avoids empty whitespace). */}
          {partnerBranding?.brandLogoUrl && (
            <div className="p-4 border-b border-gray-200 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={partnerBranding.brandLogoUrl}
                alt={partnerBranding.brandName || activeTenant?.name || "Logo"}
                className="h-14 max-w-full object-contain"
                onError={(e) => {
                  // Broken data URL → hide the img so the alt text doesn't
                  // sit in the gap. The tenant switcher below still shows
                  // the tenant name, so the user isn't stranded.
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          )}

          {/* Tenant Switcher — with a dedicated logo slot above, this tile
              goes back to the generic buildings icon so we're not showing
              the same logo twice on the sidebar. */}
          <div className="p-4 border-b border-gray-200">
            <button
              onClick={() => setShowTenantSwitcher(!showTenantSwitcher)}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Icon icon="solar:buildings-bold" className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-gray-900 text-sm truncate max-w-[120px]">
                    {activeTenant.name}
                  </p>
                  <p className="text-xs text-gray-500">Current business</p>
                </div>
              </div>
              <Icon
                icon="solar:alt-arrow-down-linear"
                className={`w-4 h-4 text-gray-400 transition-transform ${
                  showTenantSwitcher ? "rotate-180" : ""
                }`}
              />
            </button>

            {/* Tenant Dropdown */}
            {showTenantSwitcher && tenants.length > 1 && (
              <div className="mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                {tenants.map((tenant) => (
                  <button
                    key={tenant.id}
                    onClick={() => switchTenant(tenant)}
                    className={`w-full flex items-center gap-3 p-3 hover:bg-gray-50 ${
                      tenant.id === activeTenant.id ? "bg-indigo-50" : ""
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                        tenant.id === activeTenant.id
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      <Icon icon="solar:buildings-bold" className="w-3 h-3" />
                    </div>
                    <span
                      className={`text-sm ${
                        tenant.id === activeTenant.id
                          ? "font-medium text-indigo-700"
                          : "text-gray-700"
                      }`}
                    >
                      {tenant.name}
                    </span>
                    {tenant.id === activeTenant.id && (
                      <Icon icon="solar:check-circle-bold" className="w-4 h-4 text-indigo-600 ml-auto" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map((item) => {
              // newTab items (Customer Display) never match `pathname`
              // because they open in a separate tab — always render as
              // inactive so the sidebar isn't misleadingly highlighted.
              const isActive = !item.newTab && pathname === item.href;
              const commonClass = `flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-600 hover:bg-gray-50"
              }`;
              const inner = (
                <>
                  <Icon icon={item.icon} className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                  {item.newTab && (
                    <Icon
                      icon="solar:arrow-right-up-linear"
                      className="w-3.5 h-3.5 text-gray-400 ml-auto"
                    />
                  )}
                </>
              );

              // Second-monitor surfaces open in a new tab so the
              // operator's main POS view stays put — otherwise they'd
              // have to browser-back after every peek at the display.
              if (item.newTab) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setSidebarOpen(false)}
                    className={commonClass}
                  >
                    {inner}
                  </a>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={commonClass}
                >
                  {inner}
                </Link>
              );
            })}
          </nav>

          {/* User section — collapsed into a single click-to-open profile
              tile. Drawer handles name edit, password change, and sign-out
              (the sign-out logic is unchanged, just moved into the callback). */}
          <div className="p-3 border-t border-gray-200">
            <button
              onClick={() => setProfileOpen(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                <Icon icon="solar:user-bold" className="w-5 h-5 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm truncate">
                  {session?.user?.name || activeTenant?.name || "User"}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {session?.user?.email || ""}
                </p>
              </div>
              <Icon icon="solar:alt-arrow-right-linear" className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 pt-16 lg:pt-0 min-h-screen">
        <LocationProvider
          tenantId={activeTenant?.id || null}
          userRole={userRole}
          assignedLocationIds={assignedLocationIds}
        >
          {/* Top header bar with location picker — hide on cab/salon where it's not used */}
          {activeTenant?.businessType !== "cab" && (
            <div className="sticky top-0 lg:top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 lg:px-8 py-3 flex items-center justify-end gap-3">
              <LocationPicker />
            </div>
          )}
          {/* Full-width canvas-based tools opt out of horizontal padding so
              they span edge-to-edge inside <main>, but keep light vertical
              padding for visual breathing room. Add new full-width routes
              to FULL_WIDTH_ROUTES below. */}
          <div
            className={
              isFullWidthRoute(pathname)
                ? "py-2 lg:py-4" // edge-to-edge horizontally, minimal vertical
                : "p-4 lg:p-8"
            }
          >
            {children}
          </div>
        </LocationProvider>
      </main>

      {/* Shared user-profile drawer — opens on user tile click */}
      <UserProfileDrawer
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSignOut={handleSignOut}
      />

      {/* Phase 3b — support chat. Fixed-position floating button; hides
          itself silently until a support session resolves, so unauth'd
          initial paints stay clean. */}
      <SupportChatButton />
    </div>
  );
}
