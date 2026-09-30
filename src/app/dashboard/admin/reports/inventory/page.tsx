"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Select, Card, Badge } from "@/components/ui";

interface InventoryReport {
  summary: {
    totalItems: number;
    totalValue: number;
    lowStockItems: number;
    outOfStockItems: number;
  };
  stockAlerts: {
    ingredientId: string;
    ingredientName: string;
    currentStock: number;
    threshold: number;
    unit: string;
    status: "low" | "out";
  }[];
  recentMovements: {
    id: string;
    ingredientName: string;
    type: string;
    quantity: number;
    unit: string;
    createdAt: string;
    notes?: string;
  }[];
  topUsed: {
    ingredientId: string;
    ingredientName: string;
    totalUsed: number;
    unit: string;
  }[];
}

export default function InventoryReportPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");

  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    const storedLocation = localStorage.getItem("tap_active_location");
    if (storedTenant) setTenantId(storedTenant);
    if (storedLocation) setLocationId(storedLocation);
  }, []);

  const loadReport = useCallback(async () => {
    if (!tenantId || !locationId) return;

    setLoading(true);
    try {
      const [reportRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/reports/inventory?locationId=${locationId}`),
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
  }, [tenantId, locationId]);

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

  const getMovementTypeLabel = (type: string) => {
    switch (type) {
      case "PURCHASE":
        return { label: "Purchase", color: "success", icon: "solar:cart-bold" };
      case "SALE":
        return { label: "Sale", color: "info", icon: "solar:bag-2-bold" };
      case "ADJUSTMENT":
        return { label: "Adjustment", color: "warning", icon: "solar:pen-bold" };
      case "WASTE":
        return { label: "Waste", color: "danger", icon: "solar:trash-bin-trash-bold" };
      case "TRANSFER_IN":
        return { label: "Transfer In", color: "success", icon: "solar:download-bold" };
      case "TRANSFER_OUT":
        return { label: "Transfer Out", color: "warning", icon: "solar:upload-bold" };
      case "RETURN":
        return { label: "Return", color: "gray", icon: "solar:undo-left-bold" };
      default:
        return { label: type, color: "gray", icon: "solar:question-circle-bold" };
    }
  };

  if (!tenantId || !locationId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Please select a location first</p>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Inventory Report"
        subtitle="Track stock levels and movements"
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
            <Icon icon="solar:box-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No inventory data</h3>
            <p className="text-gray-500">Add ingredients to start tracking inventory</p>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
                    <Icon icon="solar:box-bold" className="w-6 h-6 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatNumber(report.summary.totalItems)}
                    </p>
                    <p className="text-sm text-gray-500">Total Items</p>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                    <Icon icon="solar:dollar-bold" className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatPrice(report.summary.totalValue)}
                    </p>
                    <p className="text-sm text-gray-500">Total Value</p>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                    <Icon icon="solar:danger-triangle-bold" className="w-6 h-6 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-amber-600">
                      {formatNumber(report.summary.lowStockItems)}
                    </p>
                    <p className="text-sm text-gray-500">Low Stock</p>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
                    <Icon icon="solar:close-circle-bold" className="w-6 h-6 text-red-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">
                      {formatNumber(report.summary.outOfStockItems)}
                    </p>
                    <p className="text-sm text-gray-500">Out of Stock</p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Stock Alerts */}
            {report.stockAlerts.length > 0 && (
              <Card
                title="Stock Alerts"
                subtitle="Items that need attention"
                actions={
                  <Badge variant="danger">{report.stockAlerts.length} alerts</Badge>
                }
              >
                <div className="space-y-3">
                  {report.stockAlerts.map((alert) => (
                    <div
                      key={alert.ingredientId}
                      className={`flex items-center justify-between p-3 rounded-xl ${
                        alert.status === "out" ? "bg-red-50" : "bg-amber-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon
                          icon={
                            alert.status === "out"
                              ? "solar:close-circle-bold"
                              : "solar:danger-triangle-bold"
                          }
                          className={`w-5 h-5 ${
                            alert.status === "out" ? "text-red-500" : "text-amber-500"
                          }`}
                        />
                        <div>
                          <p className="font-medium text-gray-900">{alert.ingredientName}</p>
                          <p className="text-sm text-gray-500">
                            Threshold: {alert.threshold} {alert.unit}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={`font-bold ${
                            alert.status === "out" ? "text-red-600" : "text-amber-600"
                          }`}
                        >
                          {alert.currentStock} {alert.unit}
                        </p>
                        <Badge variant={alert.status === "out" ? "danger" : "warning"} size="sm">
                          {alert.status === "out" ? "Out of Stock" : "Low Stock"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Movements */}
              <Card title="Recent Stock Movements">
                {report.recentMovements.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No recent movements</p>
                ) : (
                  <div className="space-y-3">
                    {report.recentMovements.slice(0, 10).map((movement) => {
                      const typeInfo = getMovementTypeLabel(movement.type);
                      return (
                        <div
                          key={movement.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-xl"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                typeInfo.color === "success"
                                  ? "bg-green-100"
                                  : typeInfo.color === "danger"
                                  ? "bg-red-100"
                                  : typeInfo.color === "warning"
                                  ? "bg-amber-100"
                                  : typeInfo.color === "info"
                                  ? "bg-blue-100"
                                  : "bg-gray-100"
                              }`}
                            >
                              <Icon
                                icon={typeInfo.icon}
                                className={`w-4 h-4 ${
                                  typeInfo.color === "success"
                                    ? "text-green-600"
                                    : typeInfo.color === "danger"
                                    ? "text-red-600"
                                    : typeInfo.color === "warning"
                                    ? "text-amber-600"
                                    : typeInfo.color === "info"
                                    ? "text-blue-600"
                                    : "text-gray-600"
                                }`}
                              />
                            </div>
                            <div>
                              <p className="font-medium text-gray-900 text-sm">
                                {movement.ingredientName}
                              </p>
                              <p className="text-xs text-gray-500">
                                {typeInfo.label} • {new Date(movement.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`font-semibold ${
                              movement.type === "PURCHASE" || movement.type === "TRANSFER_IN"
                                ? "text-green-600"
                                : movement.type === "SALE" ||
                                  movement.type === "WASTE" ||
                                  movement.type === "TRANSFER_OUT"
                                ? "text-red-600"
                                : "text-gray-600"
                            }`}
                          >
                            {movement.type === "PURCHASE" || movement.type === "TRANSFER_IN"
                              ? "+"
                              : movement.type === "SALE" ||
                                movement.type === "WASTE" ||
                                movement.type === "TRANSFER_OUT"
                              ? "-"
                              : ""}
                            {movement.quantity} {movement.unit}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Top Used */}
              <Card title="Most Used Ingredients" subtitle="Based on recent sales">
                {report.topUsed.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No usage data</p>
                ) : (
                  <div className="space-y-3">
                    {report.topUsed.slice(0, 10).map((item, index) => (
                      <div
                        key={item.ingredientId}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
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
                          <span className="font-medium text-gray-900">{item.ingredientName}</span>
                        </div>
                        <span className="font-semibold text-gray-600">
                          {formatNumber(item.totalUsed)} {item.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
