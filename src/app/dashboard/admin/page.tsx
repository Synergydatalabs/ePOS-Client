"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { StatCard } from "@/components/ui/Card";
import { OrderStatusBadge } from "@/components/ui/Badge";
import SalesByChannelChart from "@/components/admin/SalesByChannelChart";
import PeakTradingHeatmap from "@/components/admin/PeakTradingHeatmap";

interface ChannelRow {
  type: string;
  revenue: number;
  count: number;
}

interface TopSellingRow {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
}

interface DashboardData {
  today: {
    orders: number;
    revenue: number;
    profit: number;
    aov: number;
    active: number;
  };
  changes: {
    orders: number;
    revenue: number;
    profit: number;
    aov: number;
  };
  revenueTrend: Array<{ date: string; revenue: number; label: string }>;
  channels: ChannelRow[];
  heatmap: number[][];
  heatmapDays: string[];
  topSelling: TopSellingRow[];
  lowStockCount: number;
}

interface RecentOrder {
  id: string;
  orderNumber: string;
  displayNumber: number;
  orderType: string;
  status: string;
  total: number;
  createdAt: string;
  customerName?: string;
}

export default function AdminDashboard() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");
  const [businessType, setBusinessType] = useState("restaurant");

  const isSalon = businessType === "salon";
  const isCab = businessType === "cab";

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!tenantId) return;

    try {
      // 3 parallel fetches — the new /reports/dashboard endpoint now covers
      // stats + channels + heatmap + top-selling + low-stock in one call,
      // so we only need it plus recent orders and tenant settings.
      const [dashRes, ordersRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/reports/dashboard`),
        fetch(`/api/tenants/${tenantId}/orders?limit=10`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);

      const [dashData, ordersData, settingsData] = await Promise.all([
        dashRes.json(),
        ordersRes.json(),
        settingsRes.json(),
      ]);

      if (dashData.success) {
        setDash({
          today: dashData.today,
          changes: dashData.changes,
          revenueTrend: dashData.revenueTrend || [],
          channels: dashData.channels || [],
          heatmap: dashData.heatmap || [],
          heatmapDays: dashData.heatmapDays || [],
          topSelling: dashData.topSelling || [],
          lowStockCount: dashData.lowStockCount || 0,
        });
      }

      if (ordersData.success) {
        setRecentOrders(ordersData.orders.slice(0, 5));
      }

      if (settingsData.success) {
        setCurrency(settingsData.tenant?.currency || "CAD");
        if (settingsData.tenant?.businessType) {
          setBusinessType(settingsData.tenant.businessType);
        }
      }
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadDashboard();
    // Refresh every minute
    const interval = setInterval(loadDashboard, 60000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString("en-CA", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Icon icon="solar:shop-2-bold" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Please select a business first</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Dashboard"
        subtitle={`Welcome back! Here's what's happening today.`}
        actions={
          isCab ? (
            <Link href="/dashboard/admin/dispatch" className="btn btn-primary btn-md">
              <Icon icon="solar:radar-2-bold" className="w-5 h-5 mr-2" />
              Open Dispatch
            </Link>
          ) : (
            <Link href="/dashboard/pos" className="btn btn-primary btn-md">
              <Icon icon={isSalon ? "solar:calendar-bold" : "solar:cart-large-2-bold"} className="w-5 h-5 mr-2" />
              {isSalon ? "Open Checkout" : "Open POS"}
            </Link>
          )
        }
      />

      <div className="p-6 space-y-6">
        {/* KPI grid — 5 tiles with day-over-day % change indicators */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard
            title={isCab ? "Today's Trips" : isSalon ? "Today's Appointments" : "Today's Orders"}
            value={loading ? "-" : dash?.today.orders ?? 0}
            change={
              loading || !dash || dash.changes.orders === 0
                ? undefined
                : {
                    value: dash.changes.orders,
                    type: dash.changes.orders >= 0 ? "increase" : "decrease",
                  }
            }
            icon={isCab ? "solar:route-bold" : isSalon ? "solar:calendar-bold" : "solar:clipboard-list-bold"}
            iconColor="text-blue-600"
          />
          <StatCard
            title="Today's Revenue"
            value={loading ? "-" : formatPrice(dash?.today.revenue ?? 0)}
            change={
              loading || !dash || dash.changes.revenue === 0
                ? undefined
                : {
                    value: dash.changes.revenue,
                    type: dash.changes.revenue >= 0 ? "increase" : "decrease",
                  }
            }
            icon="solar:wallet-money-bold"
            iconColor="text-green-600"
          />
          <StatCard
            title="Avg. Order Value"
            value={loading ? "-" : formatPrice(dash?.today.aov ?? 0)}
            change={
              loading || !dash || dash.changes.aov === 0
                ? undefined
                : {
                    value: dash.changes.aov,
                    type: dash.changes.aov >= 0 ? "increase" : "decrease",
                  }
            }
            icon="solar:cart-3-bold"
            iconColor="text-indigo-600"
          />
          <StatCard
            title={isCab ? "Online Drivers" : "Today's Profit"}
            value={loading ? "-" : isCab ? 0 : formatPrice(dash?.today.profit ?? 0)}
            change={
              loading || !dash || isCab || dash.changes.profit === 0
                ? undefined
                : {
                    value: dash.changes.profit,
                    type: dash.changes.profit >= 0 ? "increase" : "decrease",
                  }
            }
            icon={isCab ? "solar:user-id-bold" : "solar:chart-bold"}
            iconColor="text-teal-600"
          />
          <StatCard
            title={isCab ? "Active Trips" : isSalon ? "Active Bookings" : "Active Orders"}
            value={loading ? "-" : dash?.today.active ?? 0}
            icon={isCab ? "solar:radar-2-bold" : isSalon ? "solar:calendar-check-bold" : "solar:delivery-bold"}
            iconColor="text-amber-600"
          />
        </div>

        {/* Analytics — Sales by Channel donut + 30-day peak-trading heatmap.
            Cab tenants don't have order channels so we hide these. */}
        {!isCab && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Sales by Channel
                  </h3>
                  <p className="text-sm text-gray-500">
                    Last 30 days — where your revenue comes from
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                  <Icon icon="solar:pie-chart-2-bold" className="w-5 h-5" />
                </div>
              </div>
              {loading ? (
                <div className="h-52 animate-pulse bg-gray-50 rounded-xl" />
              ) : (
                <SalesByChannelChart
                  channels={dash?.channels || []}
                  currency={currency}
                />
              )}
            </div>

            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Peak Trading Times
                  </h3>
                  <p className="text-sm text-gray-500">
                    30-day order density — darker = busier
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                  <Icon icon="solar:calendar-mark-bold" className="w-5 h-5" />
                </div>
              </div>
              {loading ? (
                <div className="h-52 animate-pulse bg-gray-50 rounded-xl" />
              ) : (
                <PeakTradingHeatmap
                  heatmap={dash?.heatmap || []}
                  days={dash?.heatmapDays}
                />
              )}
            </div>
          </div>
        )}

        {/* Top selling products — restaurant/retail/salon only */}
        {!isCab && dash?.topSelling && dash.topSelling.length > 0 && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Top Selling {isSalon ? "Services" : "Products"}
                </h3>
                <p className="text-sm text-gray-500">Last 30 days</p>
              </div>
              <Link
                href={
                  isSalon
                    ? "/dashboard/admin/menu/products"
                    : "/dashboard/admin/reports/sales"
                }
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                View All
              </Link>
            </div>
            <div className="space-y-2">
              {dash.topSelling.map((p, i) => {
                const maxRev = dash.topSelling[0]?.revenue || 1;
                const pct = Math.round((p.revenue / maxRev) * 100);
                return (
                  <div key={p.productId} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-400 w-5 flex-shrink-0">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {p.name}
                        </p>
                        <p className="text-sm font-semibold text-gray-900">
                          {formatPrice(p.revenue)}
                        </p>
                      </div>
                      <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {p.quantity} sold
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Actions & Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick Actions */}
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-3">
              {isCab ? (
                <>
                  <Link
                    href="/dashboard/admin/dispatch"
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-teal-50 hover:bg-teal-100 transition-colors"
                  >
                    <Icon icon="solar:radar-2-bold" className="w-8 h-8 text-teal-600" />
                    <span className="text-sm font-medium text-teal-700">Dispatch</span>
                  </Link>
                  <Link
                    href="/dashboard/admin/trips"
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-amber-50 hover:bg-amber-100 transition-colors"
                  >
                    <Icon icon="solar:route-bold" className="w-8 h-8 text-amber-600" />
                    <span className="text-sm font-medium text-amber-700">Trips</span>
                  </Link>
                  <Link
                    href="/dashboard/admin/drivers"
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors"
                  >
                    <Icon icon="solar:user-id-bold" className="w-8 h-8 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700">Drivers</span>
                  </Link>
                  <Link
                    href="/dashboard/admin/vehicles"
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-purple-50 hover:bg-purple-100 transition-colors"
                  >
                    <Icon icon="solar:car-bold" className="w-8 h-8 text-purple-600" />
                    <span className="text-sm font-medium text-purple-700">Vehicles</span>
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/dashboard/pos"
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-teal-50 hover:bg-teal-100 transition-colors"
                  >
                    <Icon icon={isSalon ? "solar:calendar-add-bold" : "solar:cart-large-2-bold"} className="w-8 h-8 text-teal-600" />
                    <span className="text-sm font-medium text-teal-700">{isSalon ? "New Booking" : "New Order"}</span>
                  </Link>
                  {isSalon ? (
                    <Link
                      href="/dashboard/appointments"
                      className="flex flex-col items-center gap-2 p-4 rounded-xl bg-amber-50 hover:bg-amber-100 transition-colors"
                    >
                      <Icon icon="solar:calendar-bold" className="w-8 h-8 text-amber-600" />
                      <span className="text-sm font-medium text-amber-700">Appointments</span>
                    </Link>
                  ) : (
                    <Link
                      href="/dashboard/kitchen"
                      className="flex flex-col items-center gap-2 p-4 rounded-xl bg-amber-50 hover:bg-amber-100 transition-colors"
                    >
                      <Icon icon="solar:chef-hat-bold" className="w-8 h-8 text-amber-600" />
                      <span className="text-sm font-medium text-amber-700">Kitchen</span>
                    </Link>
                  )}
                  <Link
                    href="/dashboard/admin/menu/products"
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors"
                  >
                    <Icon icon={isSalon ? "solar:scissors-bold" : "solar:box-bold"} className="w-8 h-8 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700">{isSalon ? "Services" : "Products"}</span>
                  </Link>
                  <Link
                    href="/dashboard/admin/reports/sales"
                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-purple-50 hover:bg-purple-100 transition-colors"
                  >
                    <Icon icon="solar:chart-2-bold" className="w-8 h-8 text-purple-600" />
                    <span className="text-sm font-medium text-purple-700">Reports</span>
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Alerts */}
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Alerts</h3>
            <div className="space-y-3">
              {!isCab && dash?.lowStockCount ? (
                <Link
                  href="/dashboard/admin/inventory/stock"
                  className="flex items-center gap-3 p-3 rounded-xl bg-red-50 hover:bg-red-100 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                    <Icon icon="solar:box-minimalistic-bold" className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <p className="font-medium text-red-700">Low Stock Alert</p>
                    <p className="text-sm text-red-600">
                      {dash.lowStockCount} item{dash.lowStockCount > 1 ? "s" : ""} running low
                    </p>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-green-50">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-green-700">All Good!</p>
                    <p className="text-sm text-green-600">No alerts at the moment</p>
                  </div>
                </div>
              )}

              {dash?.today.active ? (
                <Link
                  href={isCab ? "/dashboard/admin/trips" : "/dashboard/admin/orders"}
                  className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 hover:bg-amber-100 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                    <Icon icon="solar:clock-circle-bold" className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-amber-700">{isCab ? "Active Trips" : "Active Orders"}</p>
                    <p className="text-sm text-amber-600">
                      {dash.today.active} {isCab ? "trip" : "order"}{dash.today.active > 1 ? "s" : ""} in progress
                    </p>
                  </div>
                </Link>
              ) : null}
            </div>
          </div>

          {/* Recent Orders / Trips */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{isCab ? "Recent Trips" : "Recent Orders"}</h3>
              <Link
                href={isCab ? "/dashboard/admin/trips" : "/dashboard/admin/orders"}
                className="text-sm font-medium text-teal-600 hover:text-teal-700"
              >
                View All
              </Link>
            </div>
            <div className="space-y-3">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-10 h-10 rounded-lg bg-gray-200" />
                    <div className="flex-1">
                      <div className="h-4 bg-gray-200 rounded w-2/3 mb-1" />
                      <div className="h-3 bg-gray-200 rounded w-1/2" />
                    </div>
                  </div>
                ))
              ) : recentOrders.length === 0 ? (
                <p className="text-center text-gray-500 py-4">{isCab ? "No trips yet" : "No orders yet"}</p>
              ) : (
                recentOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/dashboard/admin/orders/${order.id}`}
                    className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                      <span className="font-bold text-gray-600">#{order.displayNumber}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {order.customerName || order.orderNumber}
                        </span>
                        <OrderStatusBadge status={order.status} />
                      </div>
                      <p className="text-sm text-gray-500">
                        {formatTime(order.createdAt)} • {formatPrice(order.total)}
                      </p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
