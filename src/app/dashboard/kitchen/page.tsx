"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
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

export default function KitchenDisplayPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load tenant and location
  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    const storedLocation = localStorage.getItem("tap_active_location");
    if (storedTenant) setTenantId(storedTenant);
    if (storedLocation) setLocationId(storedLocation);
  }, []);

  // Initialize audio
  useEffect(() => {
    try {
      const audio = new Audio("/sounds/kitchen-bell.mp3");
      audio.addEventListener("error", () => {
        // Silently fail if audio file doesn't exist
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
        // Check for new orders
        const prevOrderIds = orders.map((o) => o.orderId);
        const newOrders = data.orders.filter(
          (o: KitchenOrder) => !prevOrderIds.includes(o.orderId)
        );

        // Play sound for new orders
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

  // Poll for updates
  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000); // Every 5 seconds
    return () => clearInterval(interval);
  }, [fetchQueue]);

  // Handle bump order
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

  // Handle item status updates
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

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  // Calculate grid columns based on order count
  const getGridCols = () => {
    const count = orders.length;
    if (count <= 2) return "grid-cols-1 sm:grid-cols-2";
    if (count <= 4) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4";
    if (count <= 6) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3";
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
  };

  if (!tenantId || !locationId) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Icon icon="solar:chef-hat-bold" className="w-20 h-20 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">Please select a location first</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl tap-gradient flex items-center justify-center">
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
          <div className="flex-1 max-w-2xl">
            <StationFilter
              stations={stations}
              selectedStation={selectedStation}
              onSelectStation={setSelectedStation}
              totalOrders={orders.length}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Sound Toggle */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2.5 rounded-xl transition-colors ${
                soundEnabled
                  ? "bg-teal-100 text-teal-600"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              <Icon
                icon={soundEnabled ? "solar:volume-loud-bold" : "solar:volume-cross-bold"}
                className="w-5 h-5"
              />
            </button>

            {/* Refresh */}
            <button
              onClick={fetchQueue}
              className="p-2.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <Icon icon="solar:refresh-linear" className="w-5 h-5" />
            </button>

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              className="p-2.5 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <Icon
                icon={fullscreen ? "solar:quit-full-screen-linear" : "solar:full-screen-linear"}
                className="w-5 h-5"
              />
            </button>
          </div>
        </div>
      </div>

      {/* Orders Grid */}
      <div className="p-4">
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
          <span className="text-gray-400">
            Last updated: {new Date().toLocaleTimeString()}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="badge badge-info">
            <Icon icon="solar:clock-circle-bold" className="w-4 h-4 mr-1" />
            {orders.length} pending
          </span>
          {orders.some((o) => o.hasAllergyAlert) && (
            <span className="badge badge-danger">
              <Icon icon="solar:danger-triangle-bold" className="w-4 h-4 mr-1" />
              Allergy Alert
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
