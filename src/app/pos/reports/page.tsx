"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
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
}

interface DailySummary {
  totalOrders: number;
  totalRevenue: number;
  averageOrder: number;
  topProducts: { name: string; quantity: number; revenue: number }[];
  paymentMethods: { method: string; count: number; total: number }[];
}

export default function POSReportsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");
  const [summary, setSummary] = useState<DailySummary | null>(null);

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

      // Check if user has permission to view reports
      if (!["TENANT_OWNER", "POS_ADMIN", "POS_MANAGER"].includes(data.user.role)) {
        toast.error("You don't have permission to view reports");
        router.replace("/pos");
        return;
      }

      setUser(data.user);
      setTenant(data.tenant);
      setTenantId(data.tenant.id);
      setCurrency(data.tenant.currency || "CAD");
      localStorage.setItem("tap_active_tenant", data.tenant.id);
      setAuthChecked(true);
    } catch (error) {
      console.error("Session check failed:", error);
      router.replace("/pos/login");
    }
  };

  const loadSummary = useCallback(async () => {
    if (!tenantId) return;

    setLoading(true);
    try {
      const locationId = localStorage.getItem("tap_active_location");

      // Get today's date range
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
      const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

      let url = `/api/tenants/${tenantId}/orders?startDate=${startOfDay}&endDate=${endOfDay}`;
      if (locationId) url += `&locationId=${locationId}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.success) {
        const orders = data.orders || [];

        // Calculate summary
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);
        const averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        // For now, use placeholder data for top products and payment methods
        // In production, you'd have a proper analytics API
        setSummary({
          totalOrders,
          totalRevenue,
          averageOrder,
          topProducts: [],
          paymentMethods: [],
        });
      }
    } catch (error) {
      console.error("Failed to load summary:", error);
      toast.error("Failed to load report data");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (authChecked && tenantId) {
      loadSummary();
    }
  }, [authChecked, tenantId, loadSummary]);

  const handleLogout = async () => {
    try {
      await fetch("/api/pos/auth/logout", { method: "POST" });
      router.replace("/pos/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const userName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : user?.email.split('@')[0] || 'Staff';

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/pos" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
              <Icon icon="solar:arrow-left-linear" className="w-5 h-5" />
            </Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Icon icon="solar:chart-bold" className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">Today's Report</h1>
              <p className="text-sm text-gray-500">{new Date().toLocaleDateString()}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:block">{userName}</span>
            <button
              onClick={loadSummary}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            >
              <Icon icon="solar:refresh-linear" className="w-5 h-5" />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-red-500"
            >
              <Icon icon="solar:logout-2-outline" className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl p-6 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
                  <div className="h-8 bg-gray-200 rounded w-2/3" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                    <Icon icon="solar:bag-check-bold" className="w-5 h-5 text-indigo-600" />
                  </div>
                  <span className="text-gray-600">Total Orders</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{summary?.totalOrders || 0}</p>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <Icon icon="solar:wallet-money-bold" className="w-5 h-5 text-green-600" />
                  </div>
                  <span className="text-gray-600">Total Revenue</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{formatPrice(summary?.totalRevenue || 0)}</p>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Icon icon="solar:chart-2-bold" className="w-5 h-5 text-amber-600" />
                  </div>
                  <span className="text-gray-600">Average Order</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{formatPrice(summary?.averageOrder || 0)}</p>
              </div>
            </div>

            {/* Info Notice */}
            {summary?.totalOrders === 0 && (
              <div className="bg-white rounded-xl p-6 text-center">
                <Icon icon="solar:chart-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-600 mb-2">No orders today yet</h3>
                <p className="text-gray-400">Sales data will appear here as orders come in</p>
              </div>
            )}

            {/* Quick Stats */}
            {summary && summary.totalOrders > 0 && (
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">Orders per hour</p>
                    <p className="text-xl font-bold text-gray-900">
                      {((summary.totalOrders / Math.max(new Date().getHours(), 1))).toFixed(1)}
                    </p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">Revenue per hour</p>
                    <p className="text-xl font-bold text-gray-900">
                      {formatPrice(summary.totalRevenue / Math.max(new Date().getHours(), 1))}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
