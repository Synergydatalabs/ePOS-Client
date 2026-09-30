"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  currency: string;
}

export default function PartnerDashboardPage() {
  const router = useRouter();
  const routes = usePartnerRoutes();
  const { branding: partnerBranding, displayName: brandDisplayName } = usePartnerBranding();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const pc = partnerBranding.brandPrimaryColor;

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const res = await fetch("/api/partner/auth/session");
      const data = await res.json();

      if (!data.authenticated) {
        router.replace(routes.login);
        return;
      }

      setUser(data.user);
      setTenant(data.tenant);
      // Set tenant in localStorage so POS and admin pages can access it
      if (data.tenant?.id) {
        localStorage.setItem("tap_active_tenant", data.tenant.id);
      }
    } catch {
      router.replace(routes.login);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/partner/auth/logout", { method: "POST" });
    localStorage.removeItem("partner_tenant_id");
    localStorage.removeItem("partner_tenant_slug");
    router.replace(routes.login);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-t-transparent mx-auto mb-3" style={{ borderColor: pc, borderTopColor: 'transparent' }} />
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
    : user?.email?.split("@")[0] || "User";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {partnerBranding.brandLogoUrl ? (
                <img src={partnerBranding.brandLogoUrl} alt={brandDisplayName} className="h-10" />
              ) : (
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: pc }}>
                  <span className="text-sm font-bold text-white">{brandDisplayName.charAt(0)}</span>
                </div>
              )}
              <div>
                <h1 className="text-sm font-bold text-gray-900">
                  {brandDisplayName || tenant?.name || "Dashboard"}
                </h1>
                <p className="text-xs text-gray-500">{tenant?.slug}</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600 hidden sm:block">{displayName}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${pc}1A`, color: pc }}>
                {user?.role?.replace("_", " ")}
              </span>
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-red-500 transition-colors"
                title="Logout"
              >
                <Icon icon="solar:logout-2-outline" className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome */}
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl p-8 mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">
            Welcome, {user?.firstName || "there"}!
          </h2>
          <p className="text-gray-400">
            Your POS system is ready. Use the links below to get started.
          </p>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              title: "POS Counter",
              description: "Open the point of sale terminal",
              icon: "solar:monitor-smartphone-bold-duotone",
              href: "/pos",
              color: "primary",
            },
            {
              title: "Admin Portal",
              description: "Manage menu, staff, and settings",
              icon: "solar:settings-bold-duotone",
              href: "/dashboard/admin",
              color: "bg-purple-50 text-purple-600",
            },
            {
              title: "Kitchen Display",
              description: "View and manage kitchen orders",
              icon: "solar:chef-hat-bold-duotone",
              href: "/dashboard/kitchen",
              color: "bg-amber-50 text-amber-600",
            },
            {
              title: "Order History",
              description: "View past orders and transactions",
              icon: "solar:clipboard-list-bold-duotone",
              href: "/pos/history",
              color: "bg-green-50 text-green-600",
            },
            {
              title: "Reports",
              description: "Sales and inventory reports",
              icon: "solar:chart-bold-duotone",
              href: "/pos/reports",
              color: "bg-blue-50 text-blue-600",
            },
            {
              title: "Table Management",
              description: "Manage dine-in tables and QR codes",
              icon: "solar:armchair-bold-duotone",
              href: "/pos/tables",
              color: "bg-rose-50 text-rose-600",
            },
          ].map((link) => (
            <Link
              key={link.title}
              href={link.href}
              className="bg-white rounded-xl p-6 border border-gray-100 hover:shadow-md hover:border-gray-200 transition-all group"
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${link.color === "primary" ? "" : link.color}`}
                style={link.color === "primary" ? { backgroundColor: `${pc}1A`, color: pc } : undefined}
              >
                <Icon icon={link.icon} className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-gray-900 transition-colors" style={{ ["--hover-color" as string]: pc }}>
                {link.title}
              </h3>
              <p className="text-sm text-gray-500 mt-1">{link.description}</p>
            </Link>
          ))}
        </div>

        {/* Tenant Info */}
        <div className="mt-8 bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Business Info</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Business</p>
              <p className="font-medium text-gray-900">{tenant?.name}</p>
            </div>
            <div>
              <p className="text-gray-500">Tenant ID</p>
              <p className="font-mono text-xs text-gray-600">{tenant?.id}</p>
            </div>
            <div>
              <p className="text-gray-500">Currency</p>
              <p className="font-medium text-gray-900">{tenant?.currency}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
