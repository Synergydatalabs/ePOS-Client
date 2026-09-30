"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import Link from "next/link";

interface Table {
  id: string;
  tableNumber: number;
  name: string;
  capacity: number;
  status: "AVAILABLE" | "OCCUPIED" | "RESERVED" | "MAINTENANCE";
  currentOrder?: {
    id: string;
    displayNumber: number;
    total: number;
  };
}

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

export default function POSTablesPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [currency, setCurrency] = useState("CAD");

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
      setTenantId(data.tenant.id);
      setCurrency(data.tenant.currency || "CAD");
      localStorage.setItem("tap_active_tenant", data.tenant.id);

      const storedLocation = localStorage.getItem("tap_active_location");
      if (storedLocation) {
        setLocationId(storedLocation);
      }

      setAuthChecked(true);
    } catch (error) {
      console.error("Session check failed:", error);
      router.replace("/pos/login");
    }
  };

  const loadTables = useCallback(async () => {
    if (!tenantId || !locationId) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables`);
      const data = await res.json();

      if (data.success) {
        setTables(data.tables);
      }
    } catch (error) {
      console.error("Failed to load tables:", error);
      toast.error("Failed to load tables");
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId]);

  // Get first location if not set
  useEffect(() => {
    const getLocation = async () => {
      if (!tenantId || locationId) return;

      try {
        const res = await fetch(`/api/tenants/${tenantId}/locations`);
        const data = await res.json();
        if (data.success && data.locations?.length > 0) {
          setLocationId(data.locations[0].id);
          localStorage.setItem("tap_active_location", data.locations[0].id);
        }
      } catch (error) {
        console.error("Failed to get locations:", error);
      }
    };

    if (authChecked) {
      getLocation();
    }
  }, [authChecked, tenantId, locationId]);

  useEffect(() => {
    if (authChecked && tenantId && locationId) {
      loadTables();
    }
  }, [authChecked, tenantId, locationId, loadTables]);

  const handleLogout = async () => {
    try {
      await fetch("/api/pos/auth/logout", { method: "POST" });
      router.replace("/pos/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleUpdateStatus = async (tableId: string, status: string) => {
    if (!tenantId || !locationId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables/${tableId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success("Table status updated");
        loadTables();
      } else {
        toast.error(data.error || "Failed to update table");
      }
    } catch (error) {
      toast.error("Failed to update table");
    }
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "AVAILABLE":
        return "bg-green-500";
      case "OCCUPIED":
        return "bg-red-500";
      case "RESERVED":
        return "bg-amber-500";
      case "MAINTENANCE":
        return "bg-gray-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case "AVAILABLE":
        return "bg-green-50 border-green-200";
      case "OCCUPIED":
        return "bg-red-50 border-red-200";
      case "RESERVED":
        return "bg-amber-50 border-amber-200";
      case "MAINTENANCE":
        return "bg-gray-50 border-gray-200";
      default:
        return "bg-gray-50 border-gray-200";
    }
  };

  const filteredTables = tables.filter((table) => {
    if (filter === "all") return true;
    return table.status === filter;
  });

  const statusCounts = {
    all: tables.length,
    AVAILABLE: tables.filter((t) => t.status === "AVAILABLE").length,
    OCCUPIED: tables.filter((t) => t.status === "OCCUPIED").length,
    RESERVED: tables.filter((t) => t.status === "RESERVED").length,
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
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Icon icon="solar:widget-4-bold" className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">Tables</h1>
              <p className="text-sm text-gray-500">{tables.length} tables</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:block">{userName}</span>
            <button
              onClick={loadTables}
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

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 mt-3 overflow-x-auto">
          {[
            { value: "all", label: "All", count: statusCounts.all },
            { value: "AVAILABLE", label: "Available", count: statusCounts.AVAILABLE },
            { value: "OCCUPIED", label: "Occupied", count: statusCounts.OCCUPIED },
            { value: "RESERVED", label: "Reserved", count: statusCounts.RESERVED },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all flex items-center gap-2 ${
                filter === tab.value
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                filter === tab.value ? "bg-white/20" : "bg-gray-200"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </header>

      {/* Tables Grid */}
      <div className="p-4">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 animate-pulse aspect-square">
                <div className="h-8 bg-gray-200 rounded mb-2" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredTables.length === 0 ? (
          <div className="text-center py-20">
            <Icon icon="solar:widget-4-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">No tables found</h3>
            <p className="text-gray-400">
              {filter !== "all" ? "Try a different filter" : "No tables configured"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredTables.map((table) => (
              <div
                key={table.id}
                className={`rounded-xl p-4 border-2 transition-all ${getStatusBgColor(table.status)}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${getStatusColor(table.status)}`} />
                      <span className="text-2xl font-bold text-gray-900">{table.tableNumber}</span>
                    </div>
                    <p className="text-sm text-gray-500">{table.name}</p>
                  </div>
                  <div className="flex items-center gap-1 text-gray-400">
                    <Icon icon="solar:users-group-rounded-linear" className="w-4 h-4" />
                    <span className="text-sm">{table.capacity}</span>
                  </div>
                </div>

                {table.currentOrder && (
                  <div className="mb-3 p-2 bg-white rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Order #{table.currentOrder.displayNumber}</span>
                      <span className="font-semibold text-gray-900">
                        {formatPrice(table.currentOrder.total)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  {table.status === "AVAILABLE" && (
                    <button
                      onClick={() => handleUpdateStatus(table.id, "OCCUPIED")}
                      className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                    >
                      Seat
                    </button>
                  )}
                  {table.status === "OCCUPIED" && (
                    <button
                      onClick={() => handleUpdateStatus(table.id, "AVAILABLE")}
                      className="flex-1 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                  {table.status === "RESERVED" && (
                    <>
                      <button
                        onClick={() => handleUpdateStatus(table.id, "OCCUPIED")}
                        className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
                      >
                        Seat
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(table.id, "AVAILABLE")}
                        className="py-2 px-3 rounded-lg bg-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-300 transition-colors"
                      >
                        <Icon icon="solar:close-circle-linear" className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
