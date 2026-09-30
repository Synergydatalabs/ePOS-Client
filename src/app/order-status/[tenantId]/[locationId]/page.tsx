"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { Icon } from "@iconify/react";

interface OrderRow {
  id: string;
  orderNumber: string;
  displayNumber: number;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  status: string;
  customerName?: string | null;
  createdAt: string;
}

export default function OrderStatusBoard({
  params,
}: {
  params: Promise<{ tenantId: string; locationId: string }>;
}) {
  const { tenantId, locationId } = use(params);
  const [preparing, setPreparing] = useState<OrderRow[]>([]);
  const [ready, setReady] = useState<OrderRow[]>([]);
  const [locationName, setLocationName] = useState<string>("");
  const [brandName, setBrandName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState<string>("");
  const [fullscreen, setFullscreen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevReadyIds = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      audioRef.current = new Audio("/sounds/order-ready.mp3");
      audioRef.current.addEventListener("error", () => {});
    } catch {}
  }, []);

  // Clock
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", hour12: true }));
    tick();
    const id = setInterval(tick, 1000 * 30);
    return () => clearInterval(id);
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/order-status/${tenantId}/${locationId}`);
      const data = await res.json();
      if (data.success) {
        setLocationName(data.location?.name || "");
        setBrandName(data.location?.brandName || "");

        // Detect newly-ready orders → play chime
        const newReadyIds = new Set<string>(data.ready.map((o: OrderRow) => o.id));
        const freshlyReady = [...newReadyIds].some((id) => !prevReadyIds.current.has(id));
        if (freshlyReady && prevReadyIds.current.size > 0 && soundEnabled && audioRef.current) {
          audioRef.current.play().catch(() => {});
        }
        prevReadyIds.current = newReadyIds;

        setPreparing(data.preparing || []);
        setReady(data.ready || []);
      }
    } catch (err) {
      console.error("Failed to fetch orders:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId, soundEnabled]);

  useEffect(() => {
    fetchOrders();
    const id = setInterval(fetchOrders, 5000);
    return () => clearInterval(id);
  }, [fetchOrders]);

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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white flex flex-col">
      {/* Top bar */}
      <header className="px-8 py-4 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
            <Icon icon="solar:cup-hot-bold" className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{brandName || "Order Status"}</h1>
            <p className="text-sm text-white/60">{locationName}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums">{clock}</p>
            <p className="text-xs text-white/60">{new Date().toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" })}</p>
          </div>

          {/* Controls (hidden in fullscreen) */}
          <div className="flex items-center gap-1.5 ml-4">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition ${soundEnabled ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-white/40"}`}
            >
              <Icon icon={soundEnabled ? "solar:volume-loud-bold" : "solar:volume-cross-bold"} className="w-4 h-4" />
            </button>
            <button onClick={toggleFullscreen} className="p-2 rounded-lg bg-white/5 text-white/70 hover:bg-white/10">
              <Icon icon={fullscreen ? "solar:quit-full-screen-linear" : "solar:full-screen-linear"} className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 p-8">
        {/* PREPARING */}
        <section className="flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
            <h2 className="text-3xl font-bold uppercase tracking-wider text-amber-400">Now Preparing</h2>
            <span className="ml-auto text-xl font-bold text-white/40">{preparing.length}</span>
          </div>

          <div className="flex-1 bg-white/5 backdrop-blur border border-white/10 rounded-3xl p-6 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Icon icon="solar:refresh-bold" className="w-10 h-10 animate-spin text-white/30" />
              </div>
            ) : preparing.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/30">
                <Icon icon="solar:chef-hat-minimalistic-linear" className="w-20 h-20 mb-3" />
                <p className="text-lg">No orders being prepared</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {preparing.map((order) => (
                  <div
                    key={order.id}
                    className="aspect-square flex flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20"
                  >
                    <p className="text-5xl md:text-6xl font-black text-amber-300 tabular-nums">
                      #{order.displayNumber}
                    </p>
                    {order.customerName && (
                      <p className="text-xs text-white/60 mt-2 truncate max-w-full px-2">
                        {order.customerName}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* READY */}
        <section className="flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-3xl font-bold uppercase tracking-wider text-emerald-400">Ready for Pickup</h2>
            <span className="ml-auto text-xl font-bold text-white/40">{ready.length}</span>
          </div>

          <div className="flex-1 bg-emerald-500/5 backdrop-blur border border-emerald-500/20 rounded-3xl p-6 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Icon icon="solar:refresh-bold" className="w-10 h-10 animate-spin text-white/30" />
              </div>
            ) : ready.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/30">
                <Icon icon="solar:bag-check-linear" className="w-20 h-20 mb-3" />
                <p className="text-lg">No orders ready yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {ready.map((order) => (
                  <div
                    key={order.id}
                    className="aspect-square flex flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/30 to-green-500/30 border-2 border-emerald-400 shadow-lg shadow-emerald-500/20 animate-pulse-slow"
                  >
                    <p className="text-5xl md:text-6xl font-black text-emerald-300 tabular-nums drop-shadow-lg">
                      #{order.displayNumber}
                    </p>
                    {order.customerName && (
                      <p className="text-xs text-white/80 mt-2 truncate max-w-full px-2">
                        {order.customerName}
                      </p>
                    )}
                    <div className="mt-2 px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-200 text-[10px] font-bold uppercase tracking-wider">
                      Ready
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="px-8 py-3 flex items-center justify-between text-xs text-white/40 border-t border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live · Updates every 5 seconds
        </div>
        <div>Please listen for your number to be called</div>
      </footer>

      <style jsx>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.95; transform: scale(1.02); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 2.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
