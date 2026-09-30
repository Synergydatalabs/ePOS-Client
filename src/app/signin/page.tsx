"use client";

import { signIn, getSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useRef } from "react";
import { Icon } from "@iconify/react";
import { useRecaptcha } from "@/hooks/useRecaptcha";
import PartnerSiteShell, { isItapHost } from "@/components/partner/site-shell";

// Hub palette — used on Synergy Data Labs / hub subdomains so the sign-in
// form matches the pill nav rendered by ItapShell. Oreugo (and any other
// tenant domain) keeps its historical indigo accent instead. Detected client-
// side because we don't have the hostname during SSR.
const HUB_TEAL_DEEP = "#0F766E";
const HUB_TEAL_TINT = "#E6F1EF";
const HUB_TEAL_RING = "#99D8CF";
const INDIGO_LEGACY = "#4F46E5";
const INDIGO_TINT   = "#EEF2FF";
const INDIGO_RING   = "#C7D2FE";

interface TenantOption {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  role: string;
  icon: string;
}

const BUSINESS_COLORS: Record<string, string> = {
  restaurant: "#F59E0B",
  salon: "#9333EA",
  retail: "#10B981",
  cab: "#3B82F6",
};

const BUSINESS_LABELS: Record<string, string> = {
  restaurant: "Restaurant",
  salon: "Salon",
  retail: "Retail",
  cab: "Transport",
};

function SignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const errorParam = searchParams.get("error");
  const hasCheckedRef = useRef(false);
  const isRedirectingRef = useRef(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaType, setMfaType] = useState<"TOTP" | "SMS">("TOTP");
  const [checkingSession, setCheckingSession] = useState(true);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const recaptcha = useRecaptcha();

  // Palette detector — teal on any Synergy Data Labs / hub subdomain (so the
  // form matches the ItapShell nav rendered by PartnerSiteShell around it),
  // legacy indigo everywhere else. Detected once on mount; SSR default is
  // hub so the first paint on the flagship platform host doesn't flash the
  // wrong accent.
  const [isHub, setIsHub] = useState(true);
  useEffect(() => {
    setIsHub(isItapHost(window.location.hostname));
  }, []);
  const accent      = isHub ? HUB_TEAL_DEEP : INDIGO_LEGACY;
  const accentTint  = isHub ? HUB_TEAL_TINT : INDIGO_TINT;
  const accentRing  = isHub ? HUB_TEAL_RING : INDIGO_RING;
  const logoSrc     = isHub ? "/images/logo/hub-wordmark.svg" : "/images/logo/itap-wordmark.png";
  const brandName   = isHub ? "hub" : "iTap";

  // Check if user is already logged in - only once on mount
  useEffect(() => {
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const checkExistingSession = async () => {
      try {
        const session = await getSession();
        if (session?.user && !isRedirectingRef.current) {
          isRedirectingRef.current = true;
          window.location.replace(callbackUrl);
          return;
        }
      } catch (err) {
        console.log("[iTAP] No active session found");
      } finally {
        setCheckingSession(false);
      }
    };

    checkExistingSession();
  }, [callbackUrl]);

  useEffect(() => {
    if (errorParam) {
      if (errorParam === "CredentialsSignin") {
        setError("Invalid email or password");
      } else if (errorParam !== "SessionRequired") {
        setError("Please sign in to continue.");
      }
    }
  }, [errorParam]);

  // ── Local auth login (for demo / partner accounts) ──
  const tryLocalAuth = async (tenantId?: string): Promise<boolean> => {
    try {
      const recaptchaToken = await recaptcha.execute("signin");
      const res = await fetch("/api/partner/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          password,
          recaptchaToken,
          ...(tenantId ? { tenantId } : {}),
        }),
      });

      if (!res.ok) return false; // Not a local-auth account, try Cognito

      const data = await res.json();
      if (!data.success) return false;

      // Multi-tenant: show picker
      if (data.multiTenant && data.tenants?.length > 1) {
        setTenants(data.tenants);
        setShowPicker(true);
        return true;
      }

      // Single tenant — complete login
      if (data.tenant) {
        localStorage.setItem("partner_tenant_id", data.tenant.id);
        localStorage.setItem("partner_tenant_slug", data.tenant.slug);
        localStorage.setItem("tap_active_tenant", data.tenant.id);
        isRedirectingRef.current = true;
        window.location.replace("/dashboard");
        return true;
      }

      return false;
    } catch {
      return false; // Network error, fall through to Cognito
    }
  };

  const handleTenantSelect = async (tenantId: string) => {
    setLoading(true);
    setError(null);
    const success = await tryLocalAuth(tenantId);
    if (!success) {
      setError("Failed to access this business. Please try again.");
    }
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isRedirectingRef.current) return;

    setLoading(true);
    setError(null);

    try {
      // Step 1: Try local DB auth first (demo / partner accounts)
      if (!needsMfa) {
        const localSuccess = await tryLocalAuth();
        if (localSuccess) {
          setLoading(false);
          return; // Handled by local auth (redirecting or showing picker)
        }
      }

      // Step 2: Fall back to Cognito (real customers)
      const credentials: any = {
        redirect: false,
        email: email.toLowerCase().trim(),
        password,
      };

      if (needsMfa && mfaCode) {
        credentials.mfaCode = mfaCode;
        credentials.mfaType = mfaType;
      }

      const result = await signIn("credentials", credentials);

      if (result?.error) {
        // Handle MFA required
        if (result.error === "MFA_REQUIRED" || result.error.includes("MFA")) {
          setNeedsMfa(true);
          if (result.error.includes("TOTP") || result.error.includes("authenticator")) {
            setMfaType("TOTP");
          } else if (result.error.includes("SMS")) {
            setMfaType("SMS");
          }
          setLoading(false);
          return;
        }

        // Check if MFA required via JSON
        try {
          const errorData = JSON.parse(result.error);
          if (errorData.type === "MFA_REQUIRED") {
            setNeedsMfa(true);
            setMfaType(errorData.mfaType || "TOTP");
            setLoading(false);
            return;
          }
        } catch {
          // Not JSON, continue
        }

        // Handle invalid MFA code
        if (needsMfa && (result.error.includes("Invalid") || result.error.includes("code"))) {
          setError("Invalid verification code. Please try again.");
          setMfaCode("");
          setLoading(false);
          return;
        }

        setError(result.error === "CredentialsSignin" ? "Invalid email or password" : result.error);
        setLoading(false);
        return;
      }

      if (result?.ok) {
        // Prevent multiple redirects
        if (isRedirectingRef.current) return;
        isRedirectingRef.current = true;

        // Wait for session to be fully established
        await new Promise(resolve => setTimeout(resolve, 500));

        // Use replace instead of href to prevent back button issues
        window.location.replace(callbackUrl);
      }
    } catch (err: any) {
      setError(err.message || "Failed to sign in. Please try again.");
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setNeedsMfa(false);
    setMfaCode("");
    setMfaType("TOTP");
    setError(null);
  };

  // Show loading while checking for existing session
  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center">
          <div
            className="animate-spin rounded-full h-10 w-10 border-b-2"
            style={{ borderBottomColor: accent }}
          ></div>
          <p className="text-sm text-gray-500 mt-3">Checking session...</p>
        </div>
      </div>
    );
  }

  // ── Tenant Picker View ──
  if (showPicker && tenants.length > 0) {
    return (
      <PartnerSiteShell>
        <div className="py-16 sm:py-24 px-4">
          <div className="mx-auto w-full max-w-lg">
            <div className="bg-white rounded-3xl shadow-xl ring-1 ring-gray-100 p-8 sm:p-10">
              <div className="mb-8 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoSrc} alt={brandName} height={40} className="h-10" />
              </div>

              <p className="text-center text-sm text-gray-500 mb-6">
                You have access to {tenants.length} businesses. Select one to continue.
              </p>

              <div className="space-y-3">
                {tenants.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleTenantSelect(t.id)}
                    disabled={loading}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 transition-all text-left group disabled:opacity-50"
                    style={{ transition: "border-color .15s, background-color .15s" }}
                    onMouseOver={(e) => { e.currentTarget.style.borderColor = accentRing; e.currentTarget.style.backgroundColor = accentTint; }}
                    onMouseOut={(e) => { e.currentTarget.style.borderColor = "#E5E7EB"; e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: BUSINESS_COLORS[t.businessType] || "#6B7280" }}
                    >
                      <Icon icon={t.icon} className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{t.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {BUSINESS_LABELS[t.businessType] || t.businessType} &middot; {t.role.replace("TENANT_", "").replace("_", " ")}
                      </p>
                    </div>
                    <Icon icon="solar:arrow-right-linear" className="w-5 h-5 text-gray-400 transition-colors flex-shrink-0" />
                  </button>
                ))}
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm text-center">
                  {error}
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-gray-100 text-center">
                <button
                  onClick={() => { setShowPicker(false); setTenants([]); setError(null); }}
                  className="text-sm text-gray-500 transition-colors"
                  style={{ transition: "color .15s" }}
                  onMouseOver={(e) => { e.currentTarget.style.color = accent; }}
                  onMouseOut={(e) => { e.currentTarget.style.color = "#6B7280"; }}
                >
                  &larr; Use a different account
                </button>
              </div>
            </div>
          </div>
        </div>
      </PartnerSiteShell>
    );
  }

  // ── Login Form View ──
  return (
    <PartnerSiteShell>
      <div className="py-16 sm:py-24 px-4">
        <div className="mx-auto w-full max-w-md">
          <div className="bg-white rounded-3xl shadow-xl ring-1 ring-gray-100 p-8 sm:p-10">

            {/* Logo */}
            <div className="mb-8 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt={brandName} height={40} className="h-10" />
            </div>

            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
              <p className="text-sm text-gray-500 mt-1">Sign in to your {brandName} dashboard</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm text-center">
                {error}
              </div>
            )}

            {/* MFA Form */}
            {needsMfa ? (
              <form onSubmit={handleSubmit}>
                <div className="text-center mb-6">
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                    style={{ backgroundColor: accentTint }}
                  >
                    <Icon
                      icon={mfaType === "TOTP" ? "solar:shield-keyhole-bold" : "solar:phone-bold"}
                      className="w-8 h-8"
                      style={{ color: accent }}
                    />
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">
                    {mfaType === "TOTP" ? "Authenticator Code" : "Verification Code"}
                  </h2>
                  <p className="text-sm text-gray-600">
                    {mfaType === "TOTP"
                      ? "Enter the 6-digit code from your authenticator app"
                      : "Enter the 6-digit code sent to your phone"}
                  </p>
                </div>

                <div className="mb-6">
                  <input
                    type="text"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    className="w-full rounded-lg border border-gray-300 bg-transparent px-5 py-3 text-2xl text-center tracking-[0.5em] font-mono text-gray-900 outline-none transition focus:border-transparent focus:ring-2 disabled:opacity-50"
                    style={{ "--tw-ring-color": accent } as React.CSSProperties}
                    maxLength={6}
                    autoFocus
                    required
                    disabled={loading}
                  />
                </div>

                <div className="mb-4">
                  <button
                    type="submit"
                    disabled={loading || mfaCode.length !== 6}
                    className="flex w-full cursor-pointer items-center justify-center rounded-lg px-5 py-3 text-base font-medium text-white transition duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                    style={{ backgroundColor: accent }}
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2" />
                        Verifying...
                      </>
                    ) : (
                      "Verify"
                    )}
                  </button>
                </div>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={handleBackToLogin}
                    className="text-sm text-gray-600"
                    style={{ transition: "color .15s" }}
                    onMouseOver={(e) => { e.currentTarget.style.color = accent; }}
                    onMouseOut={(e) => { e.currentTarget.style.color = "#4B5563"; }}
                  >
                    &larr; Back to login
                  </button>
                </div>
              </form>
            ) : (
              /* Sign In Form */
              <form onSubmit={handleSubmit}>
                <div className="mb-5">
                  <input
                    type="email"
                    placeholder="Email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    autoFocus
                    className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-3 text-base text-gray-900 placeholder:text-gray-500 outline-none transition focus:border-transparent focus:ring-2 disabled:opacity-50"
                    style={{ "--tw-ring-color": accent } as React.CSSProperties}
                  />
                </div>
                <div className="mb-5">
                  <input
                    type="password"
                    placeholder="Password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-3 text-base text-gray-900 placeholder:text-gray-500 outline-none transition focus:border-transparent focus:ring-2 disabled:opacity-50"
                    style={{ "--tw-ring-color": accent } as React.CSSProperties}
                  />
                </div>
                <div className="mb-8">
                  <button
                    type="submit"
                    disabled={loading || !email || !password}
                    className="flex w-full cursor-pointer items-center justify-center rounded-lg px-5 py-3 text-base font-medium text-white transition duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                    style={{ backgroundColor: accent }}
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2" />
                        Signing in...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* Links - only show when not in MFA mode */}
            {!needsMfa && (
              <div className="text-center">
                <a
                  href="/partner/reset-password"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-3 inline-block text-sm text-gray-600"
                  style={{ transition: "color .15s" }}
                  onMouseOver={(e) => { e.currentTarget.style.color = accent; }}
                  onMouseOut={(e) => { e.currentTarget.style.color = "#4B5563"; }}
                >
                  Forgot Password?
                </a>

                <div className="text-sm text-gray-500 space-y-1">
                  <p>
                    New to {brandName}?{" "}
                    <a
                      href="/partner/signup"
                      className="hover:underline font-medium"
                      style={{ color: accent }}
                    >
                      Sign up as a business
                    </a>
                  </p>
                  <p>
                    Selling to businesses?{" "}
                    <a
                      href="/partner/signup/supplier"
                      className="hover:underline font-medium"
                      style={{ color: accent }}
                    >
                      Sign up as a supplier
                    </a>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PartnerSiteShell>
  );
}

function LoadingFallback() {
  // Neutral gray spinner — used only for the Suspense boundary before the
  // client palette detector runs. Once SignInContent hydrates it picks the
  // hub or Oreugo accent based on hostname.
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-400" />
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SignInContent />
    </Suspense>
  );
}
