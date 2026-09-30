"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import Link from "next/link";
import KitchenOrderCard from "@/components/kitchen/KitchenOrderCard";
import StationFilter from "@/components/kitchen/StationFilter";

interface KitchenOrder {
  orderId: string;
  orderNumber: string;
  displayNumber: number;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  table?: { tableNumber: number; name: string };
  customerName?: string;
  items: any[];
  hasAllergyAlert: boolean;
  createdAt: Date;
  waitMinutes: number;
  oldestItemTime: Date;
}

interface Station {
  id: string;
  name: string;
  activeCount: number;
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

export default function POSKitchenPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Check POS session on mount
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

  // Initialize audio
  useEffect(() => {
    try {
      const audio = new Audio("/sounds/kitchen-bell.mp3");
      audio.addEventListener("error", () => {
        console.log("Kitchen bell audio not available");
      });
      audioRef.current = audio;
    } catch {
      // Audio not supported
    }
  }, []);

  // Fetch kitchen queue
  const fetchQueue = useCallback(async () => {
    if (!tenantId || !locationId) return;

    try {
      const url = new URL(`/api/tenants/${tenantId}/kitchen/queue`, window.location.origin);
      url.searchParams.set("locationId", locationId);
      if (selectedStation) url.searchParams.set("stationId", selectedStation);

      const res = await fetch(url.toString());
      const data = await res.json();

      if (data.success) {
        const prevOrderIds = orders.map((o) => o.orderId);
        const newOrders = data.orders.filter(
          (o: KitchenOrder) => !prevOrderIds.includes(o.orderId)
        );

        if (newOrders.length > 0 && soundEnabled && audioRef.current) {
          audioRef.current.play().catch(() => {});
        }

        setOrders(data.orders);
        setStations(data.stationSummary || []);
      }
    } catch (error) {
      console.error("Failed to fetch kitchen queue:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId, selectedStation, orders, soundEnabled]);

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

  // Poll for updates
  useEffect(() => {
    if (!authChecked || !locationId) return;

    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, [authChecked, locationId, fetchQueue]);

  const handleBump = async (orderId: string) => {
    if (!tenantId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/kitchen/bump`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(`Order #${data.orderNumber} bumped`);
        fetchQueue();
      }
    } catch (error) {
      toast.error("Failed to bump order");
    }
  };

  const handleItemStart = async (queueId: string) => {
    if (!tenantId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/kitchen/queue/${queueId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });

      if ((await res.json()).success) {
        fetchQueue();
      }
    } catch (error) {
      toast.error("Failed to update item");
    }
  };

  const handleItemReady = async (queueId: string) => {
    if (!tenantId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/kitchen/queue/${queueId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "READY" }),
      });

      if ((await res.json()).success) {
        fetchQueue();
      }
    } catch (error) {
      toast.error("Failed to update item");
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
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

  const getGridCols = () => {
    const count = orders.length;
    if (count <= 2) return "grid-cols-1 sm:grid-cols-2";
    if (count <= 4) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4";
    if (count <= 6) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3";
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading Kitchen Display...</p>
        </div>
      </div>
    );
  }

  if (!locationId) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Icon icon="solar:chef-hat-bold" className="w-20 h-20 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">Loading location...</p>
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
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <Link href="/pos" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
              <Icon icon="solar:arrow-left-linear" className="w-5 h-5" />
            </Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Icon icon="solar:chef-hat-bold" className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Kitchen Display</h1>
              <p className="text-sm text-gray-500">
                {orders.length} active order{orders.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {/* Station Filter */}
          <div className="flex-1 max-w-2xl hidden md:block">
            <StationFilter
              stations={stations}
              selectedStation={selectedStation}
              onSelectStation={setSelectedStation}
              totalOrders={orders.length}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 hidden sm:block">{userName}</span>

            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2.5 rounded-xl transition-colors ${
                soundEnabled
                  ? "bg-indigo-100 text-indigo-600"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              <Icon
                icon={soundEnabled ? "solar:volume-loud-bold" : "solar:volume-cross-bold"}
                className="w-5 h-5"
              />
            </button>

            <button
              onClick={fetchQueue}
              className="p-2.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <Icon icon="solar:refresh-linear" className="w-5 h-5" />
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-2.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <Icon
                icon={fullscreen ? "solar:quit-full-screen-linear" : "solar:full-screen-linear"}
                className="w-5 h-5"
              />
            </button>

            <button
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-500 transition-colors"
            >
              <Icon icon="solar:logout-2-outline" className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mobile Station Filter */}
        <div className="md:hidden mt-3">
          <StationFilter
            stations={stations}
            selectedStation={selectedStation}
            onSelectStation={setSelectedStation}
            totalOrders={orders.length}
          />
        </div>
      </div>

      {/* Orders Grid */}
      <div className="p-4 pb-16">
        {loading ? (
          <div className={`grid ${getGridCols()} gap-4`}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded mb-4" />
                <div className="space-y-3">
                  <div className="h-16 bg-gray-200 rounded" />
                  <div className="h-16 bg-gray-200 rounded" />
                </div>
                <div className="h-12 bg-gray-200 rounded mt-4" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="h-[60vh] flex flex-col items-center justify-center text-gray-400">
            <div className="w-32 h-32 rounded-full bg-gray-200 flex items-center justify-center mb-6">
              <Icon icon="solar:chef-hat-minimalistic-linear" className="w-16 h-16" />
            </div>
            <h2 className="text-2xl font-bold text-gray-600 mb-2">All Caught Up!</h2>
            <p className="text-gray-400">No pending orders at the moment</p>
          </div>
        ) : (
          <div className={`grid ${getGridCols()} gap-4 auto-rows-min`}>
            {orders.map((order) => (
              <KitchenOrderCard
                key={order.orderId}
                orderId={order.orderId}
                orderNumber={order.orderNumber}
                displayNumber={order.displayNumber}
                orderType={order.orderType}
                table={order.table}
                customerName={order.customerName}
                items={order.items}
                hasAllergyAlert={order.hasAllergyAlert}
                createdAt={order.createdAt}
                waitMinutes={order.waitMinutes}
                onBump={() => handleBump(order.orderId)}
                onItemStart={handleItemStart}
                onItemReady={handleItemReady}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white px-4 py-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Connected
          </span>
          <span className="text-gray-400 hidden sm:block">
            Last updated: {new Date().toLocaleTimeString()}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="px-2 py-1 rounded-lg bg-indigo-600 text-white text-xs font-medium">
            <Icon icon="solar:clock-circle-bold" className="w-4 h-4 mr-1 inline" />
            {orders.length} pending
          </span>
          {orders.some((o) => o.hasAllergyAlert) && (
            <span className="px-2 py-1 rounded-lg bg-red-600 text-white text-xs font-medium">
              <Icon icon="solar:danger-triangle-bold" className="w-4 h-4 mr-1 inline" />
              Allergy Alert
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
