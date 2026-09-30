"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { toast } from "sonner";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";

export default function PartnerSignupPage() {
  const router = useRouter();
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const [form, setForm] = useState({
    businessName: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  const pc = branding.brandPrimaryColor;

  const updateForm = (field: string, value: string) => {
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
      const res = await fetch("/api/partner/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: form.businessName,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          password: form.password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      toast.success(`Account created! Welcome to ${displayName}.`);
      localStorage.setItem("partner_tenant_id", data.tenant.id);
      localStorage.setItem("partner_tenant_slug", data.tenant.slug);
      router.push(routes.dashboard);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
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

  const inputFocusStyle = { "--tw-ring-color": pc } as React.CSSProperties;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href={routes.home} className="flex items-center gap-2">
            {branding.brandLogoUrl ? (
              <img src={branding.brandLogoUrl} alt={displayName} className="h-10" />
            ) : (
              <span className="text-lg font-bold text-gray-900">{displayName}</span>
            )}
          </Link>
          <Link href={routes.login} className="text-sm font-medium hover:opacity-80" style={{ color: pc }}>
            Sign In
          </Link>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
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
                  <span className="text-2xl font-bold text-white">{displayName.charAt(0)}</span>
                </div>
              )}
              <h1 className="text-2xl font-bold text-gray-900">Create your business</h1>
              <p className="text-sm text-gray-500 mt-1">Set up your POS system in minutes</p>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center gap-2 mb-8">
              <div className="flex-1 h-1 rounded-full" style={{ backgroundColor: step >= 1 ? pc : "#E5E7EB" }} />
              <div className="flex-1 h-1 rounded-full" style={{ backgroundColor: step >= 2 ? pc : "#E5E7EB" }} />
            </div>

            <form onSubmit={handleSignup}>
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Business Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Icon icon="solar:shop-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="text" required value={form.businessName}
                        onChange={(e) => updateForm("businessName", e.target.value)}
                        placeholder="Your Restaurant Name"
                        className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                        style={inputFocusStyle}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">First Name <span className="text-red-500">*</span></label>
                      <input type="text" required value={form.firstName} onChange={(e) => updateForm("firstName", e.target.value)} placeholder="First name"
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputFocusStyle} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Last Name</label>
                      <input type="text" value={form.lastName} onChange={(e) => updateForm("lastName", e.target.value)} placeholder="Last name"
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputFocusStyle} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Icon icon="solar:letter-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input type="email" required value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="you@business.com"
                        className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputFocusStyle} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!form.businessName || !form.firstName || !form.email) { toast.error("Please fill in all required fields"); return; }
                      setStep(2);
                    }}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2"
                    style={{ backgroundColor: pc }}
                  >
                    Continue <Icon icon="solar:arrow-right-linear" className="w-4 h-4" />
                  </button>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 -mt-2 mb-2">
                    <Icon icon="solar:arrow-left-linear" className="w-4 h-4" /> Back
                  </button>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Password <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Icon icon="solar:lock-keyhole-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input type={showPassword ? "text" : "password"} required value={form.password} onChange={(e) => updateForm("password", e.target.value)}
                        placeholder="Min 8 chars, uppercase, lowercase, number"
                        className="w-full pl-11 pr-12 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputFocusStyle} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <Icon icon={showPassword ? "solar:eye-closed-linear" : "solar:eye-linear"} className="w-5 h-5" />
                      </button>
                    </div>
                    {form.password && (
                      <div className="mt-2">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className={`h-1 flex-1 rounded-full ${i <= strength.score ? strength.color : "bg-gray-200"}`} />
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{strength.label}</p>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Icon icon="solar:lock-keyhole-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input type="password" required value={form.confirmPassword} onChange={(e) => updateForm("confirmPassword", e.target.value)}
                        placeholder="Confirm your password"
                        className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:border-transparent ${
                          form.confirmPassword && form.confirmPassword !== form.password ? "border-red-300" : "border-gray-200"
                        }`} style={inputFocusStyle} />
                      {form.confirmPassword && form.confirmPassword === form.password && (
                        <Icon icon="solar:check-circle-bold" className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                      )}
                    </div>
                    {form.confirmPassword && form.confirmPassword !== form.password && (
                      <p className="text-xs text-red-500 mt-1">Passwords don&#39;t match</p>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    By creating an account, you agree to our <a href="#" style={{ color: pc }} className="hover:underline">Terms of Service</a> and <a href="#" style={{ color: pc }} className="hover:underline">Privacy Policy</a>.
                  </p>
                  <button type="submit" disabled={loading || form.password !== form.confirmPassword}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ backgroundColor: pc }}>
                    {loading ? (<><Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" /> Creating account...</>) : (<>Create Account <Icon icon="solar:arrow-right-linear" className="w-4 h-4" /></>)}
                  </button>
                </div>
              )}
            </form>

            <div className="my-6 border-t border-gray-100" />
            <p className="text-center text-sm text-gray-500">
              Already have an account?{" "}
              <Link href={routes.login} className="font-semibold hover:opacity-80" style={{ color: pc }}>Sign in</Link>
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
