"use client";

// ============================================================================
// /partner/login — partner-owner sign in
//
// PHASE 7b-fix2 (2026-05-18): re-skinned to match the new partner theme.
// Form card is now light (white bg, gray-100 border, subtle shadow) and
// sits centered between the white shell header and the dark navy footer.
// Inputs are light, label colors come from the brand-aware navy token.
// ============================================================================

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { toast } from "sonner";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";
import PartnerSiteShell, { hostVariant, formAccentForHost, type HostVariant }
  from "@/components/partner/site-shell";
import { useRecaptcha } from "@/hooks/useRecaptcha";

const NAVY = "#002834";
// Per-host primary accent. Oreugo (and any inherited partner domain) still
// gets the orange the merchant explicitly asked for in Phase 7b-fix7. Every
// Synergy Data Labs / hub subdomain gets teal so the form matches the
// datanova pill nav rendered by ItapShell around it — otherwise the button
// reads as orange sitting inside a teal chrome, which is what the last
// screenshot flagged.
const ORANGE_ACCENT = "#FF914D";  // Oreugo brand orange

export default function PartnerLoginPage() {
  const router = useRouter();
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const recaptcha = useRecaptcha();

  // Per-host primary. SSR default is Oreugo orange so oreugo.ca doesn't
  // briefly paint teal on first paint; the effect flips it to teal on hub /
  // Synergy Data Labs hosts after hydration.
  const [primary, setPrimary] = useState<string>(ORANGE_ACCENT);
  const [variant, setVariant] = useState<HostVariant>("oreugo");
  useEffect(() => {
    const h = window.location.hostname;
    setVariant(hostVariant(h));
    // Accent comes from the host's own chrome preset now. The two-way test
    // here could only ever answer "hub" or "Oreugo", so Indian Beans - a
    // third tenant with its own apex - rendered in Oreugo orange.
    setPrimary(formAccentForHost(h));
  }, []);

  useEffect(() => {
    document.title = `Login | ${displayName}`;
  }, [displayName]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    try {
      const recaptchaToken = await recaptcha.execute("partner_login");
      const res = await fetch("/api/partner/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, recaptchaToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Login failed");
        // Phase I #4 (2026-09-12): server hands back a `redirect` hint
        // when the account is PENDING_APPROVAL — bounce the user to
        // the verification wizard so they can complete OTPs instead of
        // just seeing the error and retrying their password.
        if (data.redirect) {
          setTimeout(() => {
            window.location.href = data.redirect;
          }, 1200);
        }
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
      localStorage.setItem("tap_active_tenant", data.tenant.id);
      // Phase 8 (2026-07-30): supplier tenants get the supplier portal, not
      // the merchant dashboard. /supplier is a top-level route that renders
      // correctly on both partner domains and the standard domain — no
      // rewrite needed (see middleware).
      if (data.tenant.businessType === "supplier") {
        router.push("/supplier");
      } else {
        router.push(routes.dashboard);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PartnerSiteShell>
      {/* Decorative brand orb behind the form to add depth on the white canvas */}
      <div className="relative flex items-center justify-center py-16 sm:py-24 px-4 overflow-hidden">
        <div
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primary }}
        />

        <div className="relative w-full max-w-md">
          <div className="bg-white rounded-3xl shadow-2xl ring-1 ring-gray-100 p-8 sm:p-10">
            {/* Welcome header */}
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
                style={{ backgroundColor: `${primary}1A` }}
              >
                <Icon icon="solar:user-id-bold-duotone" className="w-9 h-9" style={{ color: primary }} />
              </div>
              <h1 className="text-3xl font-bold" style={{ color: NAVY }}>
                Welcome back
              </h1>
              <p className="text-base text-gray-600 mt-2">
                Login to your {displayName} dashboard
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              {/* Email */}
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
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
                    autoComplete="email"
                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                    style={{ "--tw-ring-color": primary, color: NAVY } as React.CSSProperties}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-semibold" style={{ color: NAVY }}>
                    Password
                  </label>
                  <Link
                    href={routes.resetPassword}
                    className="text-xs font-semibold hover:opacity-70 transition-opacity"
                    style={{ color: primary }}
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
                    autoComplete="current-password"
                    className="w-full pl-11 pr-12 py-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                    style={{ "--tw-ring-color": primary, color: NAVY } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <Icon icon={showPassword ? "solar:eye-closed-linear" : "solar:eye-linear"} className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Submit (template's leaf-button curve) */}
              <button
                type="submit"
                disabled={loading}
                className="leaf-button w-full py-3 text-sm font-semibold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 shadow-lg"
                style={{ backgroundColor: primary }}
              >
                {loading ? (
                  <>
                    <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  <>
                    Login
                    <Icon icon="solar:arrow-right-bold" className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="my-7 border-t border-gray-100" />

            <p className="text-center text-sm text-gray-600">
              Don&apos;t have an account?{" "}
              <Link
                href={routes.signup}
                className="font-semibold hover:opacity-70 transition-opacity"
                style={{ color: primary }}
              >
                Get started free
              </Link>
            </p>
          </div>

          {/* Sub-card help text — support email follows the palette: teal
              on hub routes it to the Synergy Data Labs inbox, orange keeps
              Oreugo's own address. */}
          <p className="text-center text-xs text-gray-500 mt-6">
            Trouble signing in?{" "}
            <a
              href={
                variant === "hub"
                  ? "mailto:info@synergydatalabs.com"
                  : variant === "indianbeans"
                  ? "mailto:hello@indianbeans.com"
                  : "mailto:info@oreugo.ca"
              }
              className="font-medium hover:underline"
              style={{ color: primary }}
            >
              Contact support
            </a>
          </p>
        </div>
      </div>
    </PartnerSiteShell>
  );
}
