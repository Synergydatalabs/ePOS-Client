"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { toast } from "sonner";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";

export default function PartnerLoginPage() {
  const router = useRouter();
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const pc = branding.brandPrimaryColor; // primary color shortcut

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    try {
      const res = await fetch("/api/partner/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Login failed");
        setLoading(false);
        return;
      }

      if (data.mustChangePassword) {
        router.push(`${routes.login}?changePassword=true`);
        return;
      }

      toast.success("Welcome back!");
      localStorage.setItem("partner_tenant_id", data.tenant.id);
      localStorage.setItem("partner_tenant_slug", data.tenant.slug);
      router.push(routes.dashboard);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href={routes.home} className="flex items-center gap-2">
            {branding.brandLogoUrl ? (
              <img src={branding.brandLogoUrl} alt={displayName} className="h-10" />
            ) : (
              <span className="text-lg font-bold text-gray-900">{displayName}</span>
            )}
          </Link>
          <Link
            href={routes.signup}
            className="text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ color: pc }}
          >
            Create Account
          </Link>
        </div>
      </header>

      {/* Login Form */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            {/* Logo */}
            <div className="text-center mb-8">
              {branding.brandLogoUrl ? (
                <div className="flex justify-center mb-4">
                  <img src={branding.brandLogoUrl} alt={displayName} className="h-14" />
                </div>
              ) : (
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  style={{ backgroundColor: pc }}
                >
                  <span className="text-2xl font-bold text-white">
                    {displayName.charAt(0)}
                  </span>
                </div>
              )}
              <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
              <p className="text-sm text-gray-500 mt-1">Sign in to your business dashboard</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email address
                </label>
                <div className="relative">
                  <Icon
                    icon="solar:letter-linear"
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                  />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@business.com"
                    className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                    style={{ "--tw-ring-color": pc } as React.CSSProperties}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">Password</label>
                  <Link
                    href={routes.resetPassword}
                    className="text-xs font-medium hover:opacity-80 transition-opacity"
                    style={{ color: pc }}
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Icon
                    icon="solar:lock-keyhole-linear"
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                  />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-11 pr-12 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                    style={{ "--tw-ring-color": pc } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <Icon icon={showPassword ? "solar:eye-closed-linear" : "solar:eye-linear"} className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: pc }}
              >
                {loading ? (
                  <>
                    <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>

            <div className="my-6 border-t border-gray-100" />

            <p className="text-center text-sm text-gray-500">
              Don&#39;t have an account?{" "}
              <Link href={routes.signup} className="font-semibold hover:opacity-80" style={{ color: pc }}>
                Get started free
              </Link>
            </p>
          </div>

          {branding.poweredByVisible && (
            <p className="text-center text-xs text-gray-400 mt-6">
              Powered by {displayName} &mdash; &copy; {new Date().getFullYear()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
