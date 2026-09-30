"use client";

// Salon next-appointment board — mount on a TV in the waiting area.
// Shows who's being served now + who's coming next today, with a privacy
// toggle controlled by the salon (booking # only vs first name + initial).
// Auto-refreshes every 15 seconds.

import { useState, useEffect, useCallback, useRef, use } from "react";
import { Icon } from "@iconify/react";

interface Appointment {
  id: string;
  displayNumber: number;
  orderNumber: string;
  status: string;
  customerName: string | null;
  appointmentTime: string | null;
  appointmentDate: string | null;
  service: string | null;
}

export default function NextAppointmentBoard({
  params,
}: {
  params: Promise<{ tenantId: string; locationId: string }>;
}) {
  const { tenantId, locationId } = use(params);

  const [current, setCurrent] = useState<Appointment | null>(null);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [locationName, setLocationName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [privacy, setPrivacy] = useState<{ showName: boolean }>({ showName: false });
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const prevCurrentIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    try {
      audioRef.current = new Audio("/sounds/order-ready.mp3");
      audioRef.current.addEventListener("error", () => {});
    } catch {}
  }, []);

  // Clock — minute-resolution is enough for a salon board.
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-CA", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const fetchAppointments = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/public/appointment-display/${tenantId}/${locationId}`
      );
      const data = await res.json();
      if (data.success) {
        setLocationName(data.location?.name || "");
        setBrandName(data.location?.brandName || "");
        setPrivacy(data.privacy || { showName: false });

        // "Current" = the first appointment whose status indicates the
        // customer is already being served (PREPARING) or ready to be
        // collected (READY/SERVED). Everything else is upcoming.
        const inProgress = data.appointments.find((a: Appointment) =>
          ["PREPARING", "READY", "SERVED"].includes(a.status)
        );
        const others = data.appointments.filter(
          (a: Appointment) => a.id !== inProgress?.id
        );

        // Soft chime when the "current" appointment changes — signals that
        // staff has called the next guest forward.
        const newId = inProgress?.id ?? null;
        if (
          newId &&
          newId !== prevCurrentIdRef.current &&
          prevCurrentIdRef.current !== null &&
          audioRef.current
        ) {
          audioRef.current.play().catch(() => {});
        }
        prevCurrentIdRef.current = newId;

        setCurrent(inProgress ?? null);
        setUpcoming(others.slice(0, 8));
      }
    } catch (err) {
      console.error("Failed to fetch appointments:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId]);

  useEffect(() => {
    fetchAppointments();
    const id = setInterval(fetchAppointments, 15_000);
    return () => clearInterval(id);
  }, [fetchAppointments]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  // How to render a guest "name" given the privacy setting.
  // showName=false  -> "Guest" + booking number
  // showName=true   -> full name as the salon entered it
  const guestLabel = (appt: Appointment) => {
    if (privacy.showName && appt.customerName) return appt.customerName;
    return `Guest #${String(appt.displayNumber).padStart(4, "0")}`;
  };

  const formatTime = (t: string | null) => {
    if (!t) return "—";
    // appointmentTime is "HH:MM" 24h; convert to 12h for the board.
    const [h, m] = t.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return t;
    const period = h >= 12 ? "PM" : "AM";
    const hr12 = ((h + 11) % 12) + 1;
    return `${hr12}:${String(m).padStart(2, "0")} ${period}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-purple-900 text-white flex flex-col">
      {/* Header */}
      <header className="px-8 py-5 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center">
            <Icon icon="solar:scissors-bold" className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">{brandName || "Salon"}</h1>
            <p className="text-sm text-white/60">{locationName}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums">{clock}</p>
            <p className="text-xs text-white/60">
              {new Date().toLocaleDateString("en-CA", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
          <button
            onClick={toggleFullscreen}
            className="p-2 ml-4 rounded-lg bg-white/5 text-white/70 hover:bg-white/10"
            aria-label="Toggle fullscreen"
          >
            <Icon
              icon={
                fullscreen
                  ? "solar:quit-full-screen-linear"
                  : "solar:full-screen-linear"
              }
              className="w-5 h-5"
            />
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-6 p-8">
        {/* Current — bigger card on the left */}
        <section className="lg:col-span-2 flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-2xl font-bold uppercase tracking-wider text-emerald-300">
              Now serving
            </h2>
          </div>

          <div className="flex-1 bg-white/5 backdrop-blur border border-white/10 rounded-3xl p-8 flex flex-col items-center justify-center text-center">
            {loading ? (
              <Icon
                icon="solar:refresh-bold"
                className="w-12 h-12 animate-spin text-white/30"
              />
            ) : current ? (
              <>
                <p className="text-white/50 text-base uppercase tracking-wider mb-3">
                  Guest
                </p>
                <p className="text-6xl lg:text-7xl font-extrabold leading-tight">
                  {guestLabel(current)}
                </p>
                {current.service && (
                  <p className="text-white/60 text-xl mt-4">
                    {current.service}
                  </p>
                )}
                {current.appointmentTime && (
                  <p className="mt-6 text-white/50 text-sm">
                    Slot · {formatTime(current.appointmentTime)}
                  </p>
                )}
              </>
            ) : (
              <>
                <Icon
                  icon="solar:coffee-bold"
                  className="w-20 h-20 text-white/20 mb-4"
                />
                <p className="text-white/40 text-xl">No one being served</p>
                <p className="text-white/30 text-sm mt-2">
                  Next guest will appear here
                </p>
              </>
            )}
          </div>
        </section>

        {/* Upcoming list */}
        <section className="lg:col-span-3 flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <h2 className="text-2xl font-bold uppercase tracking-wider text-amber-300">
              Up next today
            </h2>
            <span className="ml-auto text-xl font-bold text-white/40">
              {upcoming.length}
            </span>
          </div>

          <div className="flex-1 bg-white/5 backdrop-blur border border-white/10 rounded-3xl p-6 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Icon
                  icon="solar:refresh-bold"
                  className="w-10 h-10 animate-spin text-white/30"
                />
              </div>
            ) : upcoming.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/30">
                <Icon icon="solar:calendar-bold" className="w-16 h-16 mb-3" />
                <p className="text-lg">No upcoming appointments</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {upcoming.map((appt, idx) => (
                  <li
                    key={appt.id}
                    className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 text-white font-bold">
                        {idx + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-2xl font-bold truncate">
                          {guestLabel(appt)}
                        </p>
                        {appt.service && (
                          <p className="text-sm text-white/50 truncate">
                            {appt.service}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right ml-4 flex-shrink-0">
                      <p className="text-xl font-semibold text-white/90">
                        {formatTime(appt.appointmentTime)}
                      </p>
                      <p className="text-xs uppercase tracking-wider text-white/40">
                        {appt.status === "CONFIRMED"
                          ? "Confirmed"
                          : appt.status === "NEW"
                          ? "Booked"
                          : appt.status}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="px-8 py-3 border-t border-white/10 flex items-center justify-between text-xs text-white/40">
        <span>● Live · refreshes every 15 sec</span>
        <span>
          {privacy.showName
            ? "Showing customer names"
            : "Privacy mode: booking numbers only"}
        </span>
      </footer>
    </div>
  );
}
