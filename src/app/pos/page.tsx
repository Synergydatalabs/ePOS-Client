"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";

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
  businessType?: string;
}

export default function POSPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const response = await fetch("/api/pos/auth/session");
      const data = await response.json();

      if (!data.authenticated) {
        router.replace("/pos/login");
        return;
      }

      if (data.mustChangePassword) {
        router.replace("/pos/login?changePassword=true");
        return;
      }

      setUser(data.user);
      setTenant(data.tenant);

      // Store tenant ID for other pages to use
      if (data.tenant?.id) {
        localStorage.setItem("tap_active_tenant", data.tenant.id);
      }
    } catch (error) {
      console.error("Session check failed:", error);
      router.replace("/pos/login");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/pos/auth/logout", { method: "POST" });
      router.replace("/pos/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading POS...</p>
        </div>
      </div>
    );
  }

  if (!user || !tenant) {
    return null;
  }

  const userName = user.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : user.email.split('@')[0];

  const isManager = ['TENANT_OWNER', 'POS_ADMIN', 'POS_MANAGER'].includes(user.role);
  const isKitchenOnly = user.role === 'KITCHEN_STAFF';
  const isSalon = tenant.businessType === 'salon';

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top Bar */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Icon icon="solar:shop-2-bold" className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">{tenant.name}</h1>
              <p className="text-xs text-gray-500">Point of Sale</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{userName}</p>
              <p className="text-xs text-gray-500 capitalize">{user.role.replace(/_/g, ' ').toLowerCase()}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-red-500 transition-colors"
              title="Logout"
            >
              <Icon icon="solar:logout-2-outline" className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        <div className="max-w-6xl mx-auto">
          {/* Welcome Card */}
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white mb-6">
            <h2 className="text-2xl font-bold mb-2">Welcome back, {userName}!</h2>
            <p className="text-indigo-100">Ready to take orders at {tenant.name}</p>
          </div>

          {/* Quick Actions Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {!isKitchenOnly && (
              <>
                <QuickActionLink
                  href="/pos/orders"
                  icon="solar:bag-4-bold"
                  label={isSalon ? "New Booking" : "New Order"}
                  description={isSalon ? "Book an appointment" : "Start taking orders"}
                  color="indigo"
                />
                <QuickActionLink
                  href="/pos/history"
                  icon="solar:clipboard-list-bold"
                  label={isSalon ? "Bookings" : "Orders"}
                  description={isSalon ? "View all bookings" : "View all orders"}
                  color="green"
                />
                {!isSalon && (
                  <QuickActionLink
                    href="/pos/tables"
                    icon="solar:widget-4-bold"
                    label="Tables"
                    description="Table management"
                    color="amber"
                  />
                )}
              </>
            )}
            {!isSalon && (
              <QuickActionLink
                href="/pos/kitchen"
                icon="solar:chef-hat-bold"
                label="Kitchen"
                description="Kitchen display"
                color="red"
              />
            )}
            {isManager && (
              <QuickActionLink
                href="/pos/reports"
                icon="solar:chart-bold"
                label="Reports"
                description="Sales reports"
                color="purple"
              />
            )}
          </div>

          {/* Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatusCard
              icon="solar:bag-check-bold"
              label={isSalon ? "Today's Appointments" : "Today's Orders"}
              value="--"
              subtext={isSalon ? "View in Bookings" : "View in Orders"}
              color="indigo"
            />
            <StatusCard
              icon="solar:wallet-money-bold"
              label="Today's Revenue"
              value={`${tenant.currency} --`}
              subtext="View in Reports"
              color="green"
            />
            {isSalon ? (
              <StatusCard
                icon="solar:calendar-bold"
                label="Upcoming"
                value="--"
                subtext="View Schedule"
                color="amber"
              />
            ) : (
              <StatusCard
                icon="solar:users-group-rounded-bold"
                label="Active Tables"
                value="--"
                subtext="View in Tables"
                color="amber"
              />
            )}
          </div>

          {/* Role-based Info */}
          {isKitchenOnly && (
            <div className="mt-6 p-4 bg-amber-50 rounded-xl border border-amber-200">
              <div className="flex items-start gap-3">
                <Icon icon="solar:chef-hat-bold" className="w-6 h-6 text-amber-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-amber-800">Kitchen Staff Access</h3>
                  <p className="text-amber-700 text-sm mt-1">
                    You have access to the Kitchen Display. Click the Kitchen button above to view incoming orders.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function QuickActionLink({
  href,
  icon,
  label,
  description,
  color,
}: {
  href: string;
  icon: string;
  label: string;
  description: string;
  color: string;
}) {
  const colors: Record<string, string> = {
    indigo: "from-indigo-500 to-indigo-600",
    green: "from-green-500 to-green-600",
    amber: "from-amber-500 to-amber-600",
    purple: "from-purple-500 to-purple-600",
    red: "from-red-500 to-red-600",
    blue: "from-blue-500 to-blue-600",
    teal: "from-teal-500 to-teal-600",
    orange: "from-orange-500 to-orange-600",
  };

  return (
    <Link
      href={href}
      className="bg-white rounded-xl p-4 text-left shadow-sm border border-gray-100 hover:shadow-md hover:border-gray-200 transition-all block"
    >
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colors[color]} flex items-center justify-center mb-3`}>
        <Icon icon={icon} className="w-6 h-6 text-white" />
      </div>
      <h3 className="font-semibold text-gray-900">{label}</h3>
      <p className="text-xs text-gray-500 mt-0.5">{description}</p>
    </Link>
  );
}

function StatusCard({
  icon,
  label,
  value,
  subtext,
  color,
}: {
  icon: string;
  label: string;
  value: string;
  subtext: string;
  color: string;
}) {
  const iconColors: Record<string, string> = {
    indigo: "text-indigo-600 bg-indigo-100",
    green: "text-green-600 bg-green-100",
    amber: "text-amber-600 bg-amber-100",
  };

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg ${iconColors[color]} flex items-center justify-center`}>
          <Icon icon={icon} className="w-5 h-5" />
        </div>
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{subtext}</p>
    </div>
  );
}
