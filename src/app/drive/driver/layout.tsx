"use client";

import { useState, useEffect, createContext, useContext } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Icon } from "@iconify/react";

interface DriverSession {
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    role: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    currency: string;
  };
}

interface DriverContextType {
  session: DriverSession | null;
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
}

const DriverContext = createContext<DriverContextType>({
  session: null,
  isOnline: false,
  setIsOnline: () => {},
});

export function useDriverSession() {
  return useContext(DriverContext);
}

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<DriverSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isOnline, setIsOnline] = useState(false);

  const isLoginPage = pathname === "/drive/driver/login";

  useEffect(() => {
    if (isLoginPage) {
      setAuthChecked(true);
      return;
    }

    const checkSession = async () => {
      try {
        const res = await fetch("/api/drive/auth/session");
        const data = await res.json();

        if (!data.authenticated) {
          router.replace("/drive/driver/login");
          return;
        }

        setSession({
          user: data.user,
          tenant: data.tenant,
        });

        // Restore online status from localStorage
        const storedOnline = localStorage.getItem("driver_online");
        if (storedOnline === "true") {
          setIsOnline(true);
        }

        setAuthChecked(true);
      } catch (error) {
        console.error("Session check failed:", error);
        router.replace("/drive/driver/login");
      }
    };

    checkSession();
  }, [router, isLoginPage]);

  // If login page, just render children
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Loading state
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  const driverName = session?.user.firstName
    ? `${session.user.firstName}${session.user.lastName ? ` ${session.user.lastName}` : ""}`
    : session?.user.email?.split("@")[0] || "Driver";

  const navItems = [
    { path: "/drive/driver", icon: "solar:home-2-bold", label: "Home" },
    { path: "/drive/driver/trip", icon: "solar:route-bold", label: "Trip" },
    { path: "/drive/driver/trips", icon: "solar:clock-circle-bold", label: "History" },
    { path: "/drive/driver/earnings", icon: "solar:wallet-bold", label: "Earnings" },
    { path: "/drive/driver/profile", icon: "solar:user-circle-bold", label: "Profile" },
  ];

  const isActive = (path: string) => {
    if (path === "/drive/driver") return pathname === "/drive/driver";
    return pathname.startsWith(path);
  };

  return (
    <DriverContext.Provider value={{ session, isOnline, setIsOnline }}>
      <div className="h-screen flex flex-col bg-gray-950">
        {/* Header */}
        <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between flex-shrink-0 safe-area-top">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Icon icon="solar:wheel-bold" className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="font-semibold text-white text-sm">{driverName}</h1>
              <p className="text-xs text-gray-500">{session?.tenant.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              isOnline
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-gray-800 text-gray-500 border border-gray-700"
            }`}>
              <div className={`w-2 h-2 rounded-full ${isOnline ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
              {isOnline ? "Online" : "Offline"}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        {/* Bottom Navigation */}
        <nav className="bg-gray-900 border-t border-gray-800 flex-shrink-0 safe-area-bottom">
          <div className="flex items-center justify-around py-2">
            {navItems.map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[56px] ${
                    active
                      ? "text-emerald-400"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <Icon icon={item.icon} className="w-6 h-6" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </DriverContext.Provider>
  );
}
