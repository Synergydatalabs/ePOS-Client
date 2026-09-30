"use client";

// /partner/signup/supplier — public supplier signup.
//
// Separate from the merchant signup wizard (which is a 3-step affair
// asking about business type, POS features, etc.). Suppliers don't have
// any of that — they just need company info + a login. Single-step form.
//
// On success we set the partner_token cookie and drop the user straight
// into /supplier — no separate login step.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { toast } from "sonner";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";
import PartnerSiteShell, { isItapHost } from "@/components/partner/site-shell";

const NAVY = "#002834";
// Per-host primary. Oreugo keeps orange; every Synergy Data Labs / hub
// subdomain gets teal so the form matches the datanova pill nav. Same
// pattern as /partner/login and /partner/signup.
const ORANGE_ACCENT = "#FF914D";  // Oreugo brand orange
const HUB_TEAL      = "#3A3EBF";  // Synergy Data Labs teal

export default function SupplierSignupPage() {
  const router = useRouter();
  const routes = usePartnerRoutes();
  const { displayName } = usePartnerBranding();

  const [form, setForm] = useState({
    companyName: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Per-host primary. SSR default is Oreugo orange; hub / Synergy Data Labs
  // subdomains flip to teal after hydration.
  const [primary, setPrimary] = useState<string>(ORANGE_ACCENT);
  useEffect(() => {
    setPrimary(isItapHost(window.location.hostname) ? HUB_TEAL : ORANGE_ACCENT);
  }, []);

  useEffect(() => {
    document.title = `Sign Up as Supplier | ${displayName}`;
  }, [displayName]);

  const updateForm = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/partner/auth/register-supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          password: form.password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      toast.success(`Welcome, ${form.companyName}!`);
      localStorage.setItem("partner_tenant_id", data.tenant.id);
      localStorage.setItem("partner_tenant_slug", data.tenant.slug);
      localStorage.setItem("tap_active_tenant", data.tenant.id);
      // Hard nav so the /supplier layout picks up the fresh partner-token
      // cookie on first render (a router.push in some cases race-conditions
      // with the cookie set on the same response).
      window.location.href = "/supplier";
    } catch {
      toast.error("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const passwordStrength = () => {
    const p = form.password;
    if (!p) return { score: 0, label: "", color: "" };
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[a-z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    if (score <= 2) return { score, label: "Weak", color: "bg-red-500" };
    if (score <= 3) return { score, label: "Fair", color: "bg-amber-500" };
    if (score <= 4) return { score, label: "Good", color: "bg-green-400" };
    return { score, label: "Strong", color: "bg-green-600" };
  };
  const strength = passwordStrength();

  const inputClass =
    "w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all";
  const inputFocusStyle = { "--tw-ring-color": primary, color: NAVY } as React.CSSProperties;

  return (
    <PartnerSiteShell>
      <div className="relative flex items-center justify-center py-16 sm:py-24 px-4 overflow-hidden">
        <div
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primary }}
        />

        <div className="relative w-full max-w-lg">
          {/* Header */}
          <div className="text-center mb-6">
            <div
              className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center text-white"
              style={{ backgroundColor: primary }}
            >
              <Icon icon="solar:box-bold" className="w-7 h-7" />
            </div>
            <h1 className="text-3xl font-bold" style={{ color: NAVY }}>
              List your business as a supplier
            </h1>
            <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
              {/* Platform name follows the palette. */}
              Reach restaurants, cafes, retailers on {primary === HUB_TEAL ? "hub" : "iTap"} POS.
              Manage your catalog, receive purchase orders, and (once approved) accept card
              payments — all from one portal.
            </p>
          </div>

          {/* Form */}
          <form
            onSubmit={handleSignup}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 space-y-4"
          >
            {/* Company */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Company name
              </label>
              <div className="relative">
                <Icon
                  icon="solar:buildings-bold"
                  className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  required
                  value={form.companyName}
                  onChange={(e) => updateForm("companyName", e.target.value)}
                  placeholder="e.g. Fresh Foods Wholesale"
                  className={inputClass}
                  style={inputFocusStyle}
                />
              </div>
            </div>

            {/* Contact name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  First name
                </label>
                <div className="relative">
                  <Icon
                    icon="solar:user-bold"
                    className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    required
                    value={form.firstName}
                    onChange={(e) => updateForm("firstName", e.target.value)}
                    className={inputClass}
                    style={inputFocusStyle}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  Last name
                </label>
                <div className="relative">
                  <Icon
                    icon="solar:user-linear"
                    className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => updateForm("lastName", e.target.value)}
                    className={inputClass}
                    style={inputFocusStyle}
                  />
                </div>
              </div>
            </div>

            {/* Email + phone */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Work email
              </label>
              <div className="relative">
                <Icon
                  icon="solar:letter-bold"
                  className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => updateForm("email", e.target.value)}
                  placeholder="orders@company.com"
                  className={inputClass}
                  style={inputFocusStyle}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Phone <span className="text-gray-400 font-normal normal-case">(optional)</span>
              </label>
              <div className="relative">
                <Icon
                  icon="solar:phone-bold"
                  className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateForm("phone", e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className={inputClass}
                  style={inputFocusStyle}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Icon
                  icon="solar:lock-password-bold"
                  className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={form.password}
                  onChange={(e) => updateForm("password", e.target.value)}
                  placeholder="8+ chars, mixed case, 1 number"
                  className={inputClass}
                  style={inputFocusStyle}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <Icon
                    icon={showPassword ? "solar:eye-closed-linear" : "solar:eye-linear"}
                    className="w-5 h-5"
                  />
                </button>
              </div>
              {form.password && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${strength.color}`}
                      style={{ width: `${(strength.score / 5) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{strength.label}</span>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Confirm password
              </label>
              <div className="relative">
                <Icon
                  icon="solar:lock-keyhole-bold"
                  className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={form.confirmPassword}
                  onChange={(e) => updateForm("confirmPassword", e.target.value)}
                  className={inputClass}
                  style={inputFocusStyle}
                />
              </div>
              {form.confirmPassword && form.password !== form.confirmPassword && (
                <p className="text-xs text-red-500 mt-1">Passwords don't match</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: primary }}
            >
              {loading ? "Creating account…" : "Create supplier account"}
            </button>

            <p className="text-xs text-gray-400 text-center pt-2">
              By creating an account, you agree to our terms and privacy policy.
            </p>
          </form>

          {/* Alt routes */}
          <div className="mt-6 text-center text-sm text-gray-500 space-y-1">
            <p>
              Already have an account?{" "}
              <Link
                href={routes.login}
                className="font-semibold"
                style={{ color: primary }}
              >
                Login
              </Link>
            </p>
            <p>
              Not a software creator?{" "}
              <Link
                href={routes.signup}
                className="font-semibold text-gray-700 hover:text-gray-900"
              >
                Sign up as a business instead
              </Link>
            </p>
          </div>
        </div>
      </div>
    </PartnerSiteShell>
  );
}
