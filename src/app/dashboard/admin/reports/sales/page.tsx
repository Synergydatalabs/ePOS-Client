"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Select, Card, Badge } from "@/components/ui";

interface SalesReport {
  summary: {
    totalSales: number;
    totalOrders: number;
    averageOrderValue: number;
    totalTax: number;
    totalTips: number;
    totalRefunds: number;
    netSales: number;
  };
  byOrderType: {
    orderType: string;
    count: number;
    total: number;
  }[];
  byPaymentMethod: {
    method: string;
    count: number;
    total: number;
  }[];
  topProducts: {
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
  }[];
  hourlyBreakdown?: {
    hour: number;
    orders: number;
    revenue: number;
  }[];
}

export default function SalesReportPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");

  // Filters
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "year">("today");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    const storedLocation = localStorage.getItem("tap_active_location");
    if (storedTenant) setTenantId(storedTenant);
    if (storedLocation) setLocationId(storedLocation);
  }, []);

  const loadReport = useCallback(async () => {
    if (!tenantId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (locationId) params.set("locationId", locationId);

      // Calculate dates based on range
      const now = new Date();
      let start = new Date();
      let end = new Date();

      switch (dateRange) {
        case "today":
          start.setHours(0, 0, 0, 0);
          break;
        case "week":
          start.setDate(now.getDate() - 7);
          break;
        case "month":
          start.setMonth(now.getMonth() - 1);
          break;
        case "year":
          start.setFullYear(now.getFullYear() - 1);
          break;
      }

      params.set("startDate", start.toISOString());
      params.set("endDate", end.toISOString());

      const [reportRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/reports/sales?${params}`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);

      const [reportData, settingsData] = await Promise.all([
        reportRes.json(),
        settingsRes.json(),
      ]);

      if (reportData.success) setReport(reportData.report);
      if (settingsData.success) setCurrency(settingsData.tenant?.currency || "CAD");
    } catch (error) {
      toast.error("Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId, dateRange]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-CA").format(num);
  };

  const getOrderTypeLabel = (type: string) => {
    switch (type) {
      case "DINE_IN":
        return "Dine In";
      case "TAKEAWAY":
        return "Takeaway";
      case "DELIVERY":
        return "Delivery";
      default:
        return type;
    }
  };

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case "CASH":
        return "Cash";
      case "CARD":
        return "Card";
      case "ONLINE":
        return "Online";
      default:
        return method;
    }
  };

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Please select a business first</p>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Sales Report"
        subtitle="View your sales performance"
        actions={
          <Button
            variant="secondary"
            icon="solar:download-linear"
            onClick={() => toast.info("Export coming soon")}
          >
            Export
          </Button>
        }
      />

      <div className="p-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex gap-2">
            {(["today", "week", "month", "year"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-4 py-2 rounded-xl font-medium transition-all ${
                  dateRange === range
                    ? "bg-teal-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {range.charAt(0).toUpperCase() + range.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <div className="animate-pulse">
                    <div className="h-8 bg-gray-200 rounded w-1/2 mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ) : !report ? (
          <Card className="text-center py-12">
            <Icon icon="solar:chart-2-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No data available</h3>
            <p className="text-gray-500">No sales data for the selected period</p>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
                    <Icon icon="solar:dollar-bold" className="w-6 h-6 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatPrice(report.summary.totalSales)}
                    </p>
                    <p className="text-sm text-gray-500">Total Sales</p>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                    <Icon icon="solar:bag-2-bold" className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatNumber(report.summary.totalOrders)}
                    </p>
                    <p className="text-sm text-gray-500">Orders</p>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                    <Icon icon="solar:chart-bold" className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatPrice(report.summary.averageOrderValue)}
                    </p>
                    <p className="text-sm text-gray-500">Avg. Order</p>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                    <Icon icon="solar:wallet-bold" className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">
                      {formatPrice(report.summary.netSales)}
                    </p>
                    <p className="text-sm text-gray-500">Net Sales</p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Additional Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Tax Collected</span>
                  <span className="font-semibold">{formatPrice(report.summary.totalTax)}</span>
                </div>
              </Card>
              <Card>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Tips</span>
                  <span className="font-semibold">{formatPrice(report.summary.totalTips)}</span>
                </div>
              </Card>
              <Card>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Refunds</span>
                  <span className="font-semibold text-red-600">
                    -{formatPrice(report.summary.totalRefunds)}
                  </span>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By Order Type */}
              <Card title="Sales by Order Type">
                {report.byOrderType.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No data</p>
                ) : (
                  <div className="space-y-3">
                    {report.byOrderType.map((item) => (
                      <div
                        key={item.orderType}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <Icon
                            icon={
                              item.orderType === "DINE_IN"
                                ? "solar:buildings-2-bold"
                                : item.orderType === "TAKEAWAY"
                                ? "solar:bag-4-bold"
                                : "solar:delivery-bold"
                            }
                            className="w-5 h-5 text-gray-500"
                          />
                          <span className="font-medium">{getOrderTypeLabel(item.orderType)}</span>
                          <Badge variant="gray" size="sm">
                            {item.count} orders
                          </Badge>
                        </div>
                        <span className="font-semibold text-gray-900">
                          {formatPrice(item.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* By Payment Method */}
              <Card title="Sales by Payment Method">
                {report.byPaymentMethod.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No data</p>
                ) : (
                  <div className="space-y-3">
                    {report.byPaymentMethod.map((item) => (
                      <div
                        key={item.method}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <Icon
                            icon={
                              item.method === "CASH"
                                ? "solar:wallet-bold"
                                : item.method === "CARD"
                                ? "solar:card-bold"
                                : "solar:smartphone-bold"
                            }
                            className="w-5 h-5 text-gray-500"
                          />
                          <span className="font-medium">{getPaymentMethodLabel(item.method)}</span>
                          <Badge variant="gray" size="sm">
                            {item.count} payments
                          </Badge>
                        </div>
                        <span className="font-semibold text-gray-900">
                          {formatPrice(item.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Top Products */}
            <Card title="Top Selling Products">
              {report.topProducts.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Product</th>
                        <th className="text-right">Quantity</th>
                        <th className="text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.topProducts.slice(0, 10).map((product, index) => (
                        <tr key={product.productId}>
                          <td>
                            <span
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                index === 0
                                  ? "bg-amber-100 text-amber-700"
                                  : index === 1
                                  ? "bg-gray-200 text-gray-700"
                                  : index === 2
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {index + 1}
                            </span>
                          </td>
                          <td className="font-medium text-gray-900">{product.productName}</td>
                          <td className="text-right">{formatNumber(product.quantity)}</td>
                          <td className="text-right font-semibold text-teal-600">
                            {formatPrice(product.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Hourly Breakdown */}
            {report.hourlyBreakdown && report.hourlyBreakdown.length > 0 && (
              <Card title="Hourly Sales">
                <div className="h-48 flex items-end gap-1">
                  {report.hourlyBreakdown.map((hour) => {
                    const maxRevenue = Math.max(...report.hourlyBreakdown!.map((h) => h.revenue));
                    const height = maxRevenue > 0 ? (hour.revenue / maxRevenue) * 100 : 0;
                    return (
                      <div
                        key={hour.hour}
                        className="flex-1 flex flex-col items-center gap-1"
                        title={`${hour.hour}:00 - ${formatPrice(hour.revenue)} (${hour.orders} orders)`}
                      >
                        <div
                          className="w-full bg-teal-500 rounded-t transition-all hover:bg-teal-600"
                          style={{ height: `${height}%`, minHeight: hour.revenue > 0 ? "4px" : "0" }}
                        />
                        <span className="text-xs text-gray-400">{hour.hour}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
