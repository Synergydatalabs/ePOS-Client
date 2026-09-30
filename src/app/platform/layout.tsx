"use client";

// /platform/* — thin admin shell for platform staff.
//
// Auth model: client renders once, then the first API call to
// /api/platform/* is what actually gates access. If the API returns 403,
// the pages surface that to the user. Belt-and-braces: this layout also
// pings a "who am I" endpoint on mount so an unauthorized user sees a
// clear "not a platform admin" screen instead of every child page
// showing individual auth errors.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@iconify/react";

const NAV_ITEMS = [
  {
    href: "/platform/gateway-applications",
    label: "Gateway Applications",
    icon: "solar:card-transfer-bold",
  },
];

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [authState, setAuthState] = useState<"loading" | "ok" | "denied">("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    // Ping the list endpoint just to check auth — the response body is
    // discarded here, the list page fetches it again on mount. Cheap +
    // avoids adding a dedicated "whoami" endpoint.
    fetch("/api/platform/gateway-applications")
      .then((r) => {
        if (r.ok) {
          setAuthState("ok");
        } else {
          return r.json().then((data) => {
            setErrorMessage(data.error || "Access denied");
            setAuthState("denied");
          });
        }
      })
      .catch(() => {
        setErrorMessage("Failed to check access");
        setAuthState("denied");
      });
  }, []);

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (authState === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
            <Icon icon="solar:shield-cross-bold" className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Platform admin only</h1>
          <p className="text-gray-500 text-sm mb-4">{errorMessage}</p>
          <p className="text-gray-400 text-xs">
            If this is a mistake, ask ops to add your email to{" "}
            <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">
              PLATFORM_ADMIN_EMAILS
            </code>{" "}
            in the environment config.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Slim top bar — platform is a small area, no need for a full sidebar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/platform/gateway-applications" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center">
                <Icon icon="solar:shield-user-bold" className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-gray-900">Platform Admin</span>
            </Link>
            <nav className="hidden sm:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "bg-slate-100 text-slate-900"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Icon icon={item.icon} className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
