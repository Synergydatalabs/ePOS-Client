"use client";

// ============================================================================
// /partner/reset-password — OTP-based password reset (Phase I #4, 2026-09-12).
//
// Flow: enter email → receive 6-digit OTP by email → enter OTP + new
// password on this same page → done. No token in the URL, no reset link.
//
// The legacy `?token=` URL still works (the server tolerates it for one
// deploy cycle so any link-based email in transit doesn't 404), but the
// page's own UI only ever renders the OTP flow.
// ============================================================================

import { useState, useEffect, Suspense } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { toast } from "sonner";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";
import PartnerSiteShell, { isItapHost } from "@/components/partner/site-shell";
import { useRecaptcha } from "@/hooks/useRecaptcha";

const NAVY = "#002834";
const ORANGE_ACCENT = "#FF914D";
const HUB_TEAL = "#3A3EBF";

type Step = "request" | "verify" | "done";

function ResetPasswordContent() {
  const routes = usePartnerRoutes();
  const { displayName } = usePartnerBranding();
  const recaptcha = useRecaptcha();

  const [primary, setPrimary] = useState<string>(ORANGE_ACCENT);
  useEffect(() => {
    setPrimary(isItapHost(window.location.hostname) ? HUB_TEAL : ORANGE_ACCENT);
  }, []);

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    document.title = `Reset Password | ${displayName}`;
  }, [displayName]);

  // Cooldown ticker so the resend button doesn't get hammered.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  async function requestOtp(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email) {
      toast.error("Enter your email");
      return;
    }
    setLoading(true);
    try {
      const recaptchaToken = await recaptcha.execute("partner_forgot_password");
      const res = await fetch("/api/partner/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, recaptchaToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Could not send code");
        return;
      }
      toast.success("If that email exists, a 6-digit code is on the way.");
      setStep("verify");
      setResendCooldown(60);
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    if (!/^\d{6}$/.test(otp.trim())) {
      toast.error("Enter the 6-digit code from your email");
      return;
    }
    setLoading(true);
    try {
      const recaptchaToken = await recaptcha.execute("partner_reset_password");
      const res = await fetch("/api/partner/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          otp: otp.trim(),
          newPassword,
          recaptchaToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Reset failed");
        return;
      }
      setStep("done");
      toast.success("Password reset. You can now log in.");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const inputFocusStyle = { "--tw-ring-color": primary, color: NAVY } as React.CSSProperties;

  return (
    <PartnerSiteShell>
      <div className="relative flex items-center justify-center py-16 sm:py-24 px-4 overflow-hidden">
        <div
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primary }}
        />

        <div className="relative w-full max-w-md">
          <div className="bg-white rounded-3xl shadow-2xl ring-1 ring-gray-100 p-8 sm:p-10">
            {/* Step 1 — request OTP by email */}
            {step === "request" && (
              <>
                <div className="text-center mb-8">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
                    style={{ backgroundColor: `${primary}1A` }}
                  >
                    <Icon
                      icon="solar:lock-keyhole-unlocked-bold-duotone"
                      className="w-9 h-9"
                      style={{ color: primary }}
                    />
                  </div>
                  <h1 className="text-3xl font-bold" style={{ color: NAVY }}>
                    Forgot your password?
                  </h1>
                  <p className="text-base text-gray-600 mt-2">
                    Enter your email and we&apos;ll send a 6-digit code
                  </p>
                </div>

                <form onSubmit={requestOtp} className="space-y-5">
                  <div>
                    <label
                      className="block text-sm font-semibold mb-1.5"
                      style={{ color: NAVY }}
                    >
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
                        className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                        style={inputFocusStyle}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="leaf-button w-full py-3 text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 shadow-lg"
                    style={{ backgroundColor: primary }}
                  >
                    {loading ? (
                      <>
                        <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Send code"
                    )}
                  </button>
                </form>
              </>
            )}

            {/* Step 2 — enter OTP + new password */}
            {step === "verify" && (
              <>
                <div className="text-center mb-8">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
                    style={{ backgroundColor: `${primary}1A` }}
                  >
                    <Icon icon="solar:key-bold-duotone" className="w-9 h-9" style={{ color: primary }} />
                  </div>
                  <h1 className="text-3xl font-bold" style={{ color: NAVY }}>
                    Enter code + new password
                  </h1>
                  <p className="text-base text-gray-600 mt-2">
                    We sent a 6-digit code to <strong className="break-all">{email}</strong>. Enter it below along with a new password.
                  </p>
                </div>

                <form onSubmit={submitReset} className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                      6-digit code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="123456"
                      className="w-full px-4 py-3 rounded-xl bg-white border border-gray-200 text-center text-2xl tracking-[0.5em] font-semibold focus:outline-none focus:ring-2 focus:border-transparent"
                      style={inputFocusStyle}
                    />
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>Code expires in 15 minutes</span>
                      <button
                        type="button"
                        onClick={() => requestOtp()}
                        disabled={loading || resendCooldown > 0}
                        className="font-semibold hover:underline disabled:opacity-40 disabled:no-underline"
                        style={{ color: primary }}
                      >
                        {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                      New password
                    </label>
                    <div className="relative">
                      <Icon icon="solar:lock-keyhole-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 12 chars, letter + digit"
                        autoComplete="new-password"
                        className="w-full pl-11 pr-12 py-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                        style={inputFocusStyle}
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

                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                      Confirm password
                    </label>
                    <div className="relative">
                      <Icon icon="solar:lock-keyhole-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Retype your password"
                        autoComplete="new-password"
                        className={`w-full pl-11 pr-4 py-3 rounded-xl bg-white border text-sm focus:outline-none focus:ring-2 focus:border-transparent ${
                          confirmPassword && confirmPassword !== newPassword
                            ? "border-red-500"
                            : "border-gray-200"
                        }`}
                        style={inputFocusStyle}
                      />
                    </div>
                    {confirmPassword && confirmPassword !== newPassword && (
                      <p className="text-xs text-red-600 mt-1">Passwords don&apos;t match</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !!confirmPassword && confirmPassword !== newPassword}
                    className="leaf-button w-full py-3 text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 shadow-lg"
                    style={{ backgroundColor: primary }}
                  >
                    {loading ? (
                      <>
                        <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
                        Resetting...
                      </>
                    ) : (
                      "Reset password"
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStep("request");
                      setOtp("");
                    }}
                    className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
                  >
                    ← Use a different email
                  </button>
                </form>
              </>
            )}

            {/* Step 3 — done */}
            {step === "done" && (
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-5">
                  <Icon icon="solar:check-circle-bold" className="w-9 h-9 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold mb-2" style={{ color: NAVY }}>
                  Password reset!
                </h2>
                <p className="text-base text-gray-600 mb-6">
                  Your password has been updated. You can now log in.
                </p>
                <Link
                  href={routes.login}
                  className="leaf-button inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-lg"
                  style={{ backgroundColor: primary }}
                >
                  Login
                </Link>
              </div>
            )}
          </div>

          <p className="text-center text-xs text-gray-500 mt-6">
            Need help?{" "}
            <a
              href={primary === HUB_TEAL ? "mailto:info@synergydatalabs.com" : "mailto:info@oreugo.ca"}
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

export default function PartnerResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-transparent" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
