"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { Icon } from "@iconify/react";

interface QueueItem {
  queueId: string;
  productName: string;
  variantName?: string;
  quantity: number;
  modifiers?: { name: string; price: number }[];
  specialInstructions?: string;
  allergenNotes?: { allergen: string; isAllergy: boolean; note: string }[];
  status: string;
  station?: { id: string; name: string };
}

interface KitchenOrder {
  orderId: string;
  orderNumber: string;
  displayNumber: number;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  table?: { tableNumber: number; name: string };
  customerName?: string;
  items: QueueItem[];
  hasAllergyAlert: boolean;
  createdAt: string;
  waitMinutes: number;
}

interface Station {
  id: string;
  name: string;
  color?: string;
  activeCount: number;
}

// Alternating banner colors, cycling through like the sample image
const TICKET_COLORS = [
  { banner: "bg-orange-400", text: "text-orange-950" },
  { banner: "bg-red-400",    text: "text-red-950" },
  { banner: "bg-sky-400",    text: "text-sky-950" },
  { banner: "bg-green-400",  text: "text-green-950" },
  { banner: "bg-purple-400", text: "text-purple-950" },
  { banner: "bg-amber-400",  text: "text-amber-950" },
];

function getTicketColor(displayNumber: number) {
  return TICKET_COLORS[displayNumber % TICKET_COLORS.length];
}

function TicketCard({
  order,
  index,
  onMarkItemReady,
  onBumpOrder,
}: {
  order: KitchenOrder;
  index: number;
  onMarkItemReady: (queueId: string) => void;
  onBumpOrder: (orderId: string) => void;
}) {
  const color = getTicketColor(order.displayNumber);
  const typeLabel =
    order.orderType === "DINE_IN"
      ? order.table
        ? `TABLE NO. ${order.table.tableNumber}`
        : "DINE IN"
      : order.orderType === "TAKEAWAY"
      ? "TAKE OUT"
      : "DELIVERY";

  const totalItems = order.items.length;
  const doneItems = order.items.filter((i) => i.status === "READY" || i.status === "SERVED").length;
  const allDone = doneItems === totalItems;

  const isUrgent = order.waitMinutes >= 15;

  return (
    <div className={`bg-white rounded-xl overflow-hidden shadow-lg flex flex-col ${isUrgent ? "ring-4 ring-red-500 animate-pulse" : ""}`}>
      {/* Top banner */}
      <div className={`${color.banner} ${color.text} px-4 py-2.5 flex items-center justify-between`}>
        <div>
          <div className="text-xs font-bold opacity-80">#{order.displayNumber}</div>
          <div className="text-[10px] opacity-70">
            {new Date(order.createdAt).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </div>
        </div>
        <div className="font-bold text-sm tracking-wide">{typeLabel}</div>
        <div className="text-right">
          <div className="text-xs font-bold">{doneItems}/{totalItems}</div>
          <div className={`text-[10px] font-bold ${order.waitMinutes >= 15 ? "text-red-900" : "opacity-70"}`}>
            {order.waitMinutes}m
          </div>
        </div>
      </div>

      {/* Allergy warning */}
      {order.hasAllergyAlert && (
        <div className="bg-red-600 text-white px-4 py-2 flex items-center gap-2">
          <Icon icon="solar:danger-triangle-bold" className="w-5 h-5" />
          <span className="text-sm font-bold uppercase">ALLERGY ALERT</span>
        </div>
      )}

      {/* Customer name */}
      {order.customerName && (
        <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-700 truncate">
          {order.customerName}
        </div>
      )}

      {/* Items */}
      <div className="flex-1 p-3 space-y-2 min-h-[200px]">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Items</div>
        {order.items.map((item) => {
          const isReady = item.status === "READY" || item.status === "SERVED";
          const allergyItem = item.allergenNotes?.some((a) => a.isAllergy);
          return (
            <button
              key={item.queueId}
              onClick={() => !isReady && onMarkItemReady(item.queueId)}
              disabled={isReady}
              className={`w-full text-left p-2 rounded-lg transition-all ${
                isReady
                  ? "bg-gray-100 opacity-50 cursor-default"
                  : "bg-white hover:bg-yellow-50 border border-gray-200 active:scale-[0.98]"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className={`font-bold text-gray-900 text-sm ${isReady ? "line-through" : ""}`}>
                  {item.quantity} × {item.productName}
                </span>
                {item.variantName && (
                  <span className="text-xs text-gray-500 mt-0.5">({item.variantName})</span>
                )}
              </div>
              {item.modifiers && item.modifiers.length > 0 && (
                <div className="ml-4 mt-0.5 text-xs text-gray-600">
                  {item.modifiers.map((m, i) => (
                    <div key={i}>+ {m.name}</div>
                  ))}
                </div>
              )}
              {item.specialInstructions && (
                <div className="ml-4 mt-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">
                  NOTE: {item.specialInstructions}
                </div>
              )}
              {allergyItem && (
                <div className="ml-4 mt-1 text-xs text-red-700 bg-red-50 px-2 py-1 rounded flex items-center gap-1">
                  <Icon icon="solar:danger-triangle-bold" className="w-3.5 h-3.5" />
                  ALLERGY: {item.allergenNotes?.filter((a) => a.isAllergy).map((a) => a.allergen).join(", ")}
                </div>
              )}
              {item.station && (
                <div className="ml-4 mt-1 text-[10px] text-gray-400 uppercase">
                  {item.station.name}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer: Done button */}
      <button
        onClick={() => onBumpOrder(order.orderId)}
        className={`w-full py-3 font-bold text-sm tracking-wider transition-colors ${
          allDone
            ? "bg-green-500 hover:bg-green-600 text-white"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        <Icon icon="solar:check-circle-bold" className="w-5 h-5 inline mr-2" />
        {allDone ? "BUMP ORDER" : "MARK ALL DONE"}
      </button>
    </div>
  );
}

export default function KitchenDisplayScreen({
  params,
}: {
  params: Promise<{ tenantId: string; locationId: string }>;
}) {
  const { tenantId, locationId } = use(params);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [locationName, setLocationName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      audioRef.current = new Audio("/sounds/kitchen-bell.mp3");
      audioRef.current.addEventListener("error", () => {});
    } catch {}
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const url = new URL(`/api/public/kitchen/${tenantId}/${locationId}/queue`, window.location.origin);
      if (selectedStation) url.searchParams.set("stationId", selectedStation);

      const res = await fetch(url.toString());
      const data = await res.json();

      if (data.success) {
        setLocationName(data.location?.name || "");
        // Play sound on new order
        const newIds = new Set<string>(data.orders.map((o: KitchenOrder) => o.orderId));
        const hasNew = [...newIds].some((id) => !prevOrderIdsRef.current.has(id));
        if (hasNew && prevOrderIdsRef.current.size > 0 && soundEnabled && audioRef.current) {
          audioRef.current.play().catch(() => {});
        }
        prevOrderIdsRef.current = newIds;

        setOrders(data.orders);
        setStations(data.stationSummary || []);
      }
    } catch (err) {
      console.error("Failed to fetch queue:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId, selectedStation, soundEnabled]);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const handleMarkItemReady = async (queueId: string) => {
    try {
      await fetch(`/api/public/kitchen/${tenantId}/${locationId}/bump`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueId, status: "READY" }),
      });
      fetchQueue();
    } catch {}
  };

  const handleBumpOrder = async (orderId: string) => {
    try {
      await fetch(`/api/public/kitchen/${tenantId}/${locationId}/bump`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      fetchQueue();
    } catch {}
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

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header bar */}
      <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-red-400 to-orange-500 flex items-center justify-center">
            <Icon icon="solar:chef-hat-bold" className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight">Kitchen Display</div>
            <div className="text-xs text-slate-300">{locationName}</div>
          </div>
        </div>

        {/* Station filter */}
        {stations.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => setSelectedStation(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                !selectedStation ? "bg-white text-slate-800" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              All ({orders.length})
            </button>
            {stations.map((st) => (
              <button
                key={st.id}
                onClick={() => setSelectedStation(st.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 ${
                  selectedStation === st.id
                    ? "bg-white text-slate-800"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {st.name} {st.activeCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px]">{st.activeCount}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <div className="px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-bold flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </div>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg ${soundEnabled ? "bg-teal-500 text-white" : "bg-slate-700 text-slate-400"}`}
          >
            <Icon icon={soundEnabled ? "solar:volume-loud-bold" : "solar:volume-cross-bold"} className="w-4 h-4" />
          </button>
          <button onClick={fetchQueue} className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600">
            <Icon icon="solar:refresh-bold" className="w-4 h-4" />
          </button>
          <button onClick={toggleFullscreen} className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600">
            <Icon icon={fullscreen ? "solar:quit-full-screen-linear" : "solar:full-screen-linear"} className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tickets grid */}
      <div className="flex-1 p-3 overflow-auto">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl h-80 animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-20">
            <div className="w-28 h-28 rounded-full bg-slate-200 flex items-center justify-center mb-6">
              <Icon icon="solar:chef-hat-minimalistic-bold" className="w-14 h-14 text-slate-400" />
            </div>
            <h2 className="text-3xl font-bold text-slate-600 mb-2">All Caught Up!</h2>
            <p className="text-slate-400">No pending orders at the moment</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {orders.map((order, i) => (
              <TicketCard
                key={order.orderId}
                order={order}
                index={i}
                onMarkItemReady={handleMarkItemReady}
                onBumpOrder={handleBumpOrder}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="bg-slate-900 text-slate-400 px-4 py-1.5 flex items-center justify-between text-[11px]">
        <span>{orders.length} active orders · {stations.reduce((s, st) => s + st.activeCount, 0)} items in queue</span>
        <span>{new Date().toLocaleTimeString("en-CA")}</span>
      </div>
    </div>
  );
}
