"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { toast } from "sonner";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const token = searchParams.get("token");
  const pc = branding.brandPrimaryColor;

  const [mode, setMode] = useState<"request" | "reset">(token ? "reset" : "request");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => { if (token) setMode("reset"); }, [token]);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/partner/auth/forgot-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) setSuccess(true);
      else toast.error(data.error || "Failed to send reset email");
    } catch { toast.error("Something went wrong"); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { toast.error("Passwords don't match"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/partner/auth/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (data.success) { setSuccess(true); toast.success("Password reset successfully!"); }
      else toast.error(data.error || "Reset failed");
    } catch { toast.error("Something went wrong"); }
    finally { setLoading(false); }
  };

  const inputStyle = { "--tw-ring-color": pc } as React.CSSProperties;

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
            Back to Login
          </Link>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            {mode === "request" && !success && (
              <>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${pc}20` }}>
                    <Icon icon="solar:lock-keyhole-unlocked-linear" className="w-8 h-8" style={{ color: pc }} />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900">Forgot your password?</h1>
                  <p className="text-sm text-gray-500 mt-1">Enter your email and we&#39;ll send you a reset link</p>
                </div>
                <form onSubmit={handleRequestReset} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                    <div className="relative">
                      <Icon icon="solar:letter-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com"
                        className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputStyle} />
                    </div>
                  </div>
                  <button type="submit" disabled={loading} className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{ backgroundColor: pc }}>
                    {loading ? (<><Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" /> Sending...</>) : "Send Reset Link"}
                  </button>
                </form>
              </>
            )}

            {mode === "request" && success && (
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
                  <Icon icon="solar:letter-bold" className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
                <p className="text-sm text-gray-500 mb-6">If an account exists with <strong>{email}</strong>, we&#39;ve sent a password reset link.</p>
                <Link href={routes.login} className="inline-flex items-center gap-2 text-sm font-semibold hover:opacity-80" style={{ color: pc }}>
                  <Icon icon="solar:arrow-left-linear" className="w-4 h-4" /> Back to Login
                </Link>
              </div>
            )}

            {mode === "reset" && !success && (
              <>
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${pc}20` }}>
                    <Icon icon="solar:key-linear" className="w-8 h-8" style={{ color: pc }} />
                  </div>
                  <h1 className="text-2xl font-bold text-gray-900">Set new password</h1>
                  <p className="text-sm text-gray-500 mt-1">Choose a strong password for your account</p>
                </div>
                <form onSubmit={handleResetPassword} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                    <div className="relative">
                      <Icon icon="solar:lock-keyhole-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input type={showPassword ? "text" : "password"} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 8 chars, uppercase, lowercase, number"
                        className="w-full pl-11 pr-12 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputStyle} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <Icon icon={showPassword ? "solar:eye-closed-linear" : "solar:eye-linear"} className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
                    <div className="relative">
                      <Icon icon="solar:lock-keyhole-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm your password"
                        className={`w-full pl-11 pr-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:border-transparent ${confirmPassword && confirmPassword !== newPassword ? "border-red-300" : "border-gray-200"}`}
                        style={inputStyle} />
                    </div>
                    {confirmPassword && confirmPassword !== newPassword && <p className="text-xs text-red-500 mt-1">Passwords don&#39;t match</p>}
                  </div>
                  <button type="submit" disabled={loading || (!!confirmPassword && confirmPassword !== newPassword)}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{ backgroundColor: pc }}>
                    {loading ? (<><Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" /> Resetting...</>) : "Reset Password"}
                  </button>
                </form>
              </>
            )}

            {mode === "reset" && success && (
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
                  <Icon icon="solar:check-circle-bold" className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Password reset!</h2>
                <p className="text-sm text-gray-500 mb-6">Your password has been updated. You can now sign in.</p>
                <Link href={routes.login} className="inline-flex items-center justify-center px-6 py-3 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: pc }}>
                  Sign In
                </Link>
              </div>
            )}
          </div>

          {branding.poweredByVisible && (
            <p className="text-center text-xs text-gray-400 mt-6">Powered by {displayName} &mdash; &copy; {new Date().getFullYear()}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PartnerResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-transparent" /></div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
