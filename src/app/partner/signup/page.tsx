"use client";

// ============================================================================
// /partner/signup — partner business registration (3-step wizard)
//
// PHASE 7b-fix2 (2026-05-18): re-skinned to match the new partner theme.
// Same 3-step wizard logic (business type → details → password), but the
// form card is now light (white bg, gray-100 border, navy text). Inputs
// are light, brand color highlights focus + active states.
// ============================================================================

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { toast } from "sonner";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";
import PartnerSiteShell, { isItapHost } from "@/components/partner/site-shell";
import { useRecaptcha } from "@/hooks/useRecaptcha";

const NAVY = "#002834";
// Per-host primary accent. Oreugo keeps orange (Phase 7b-fix7); every
// Synergy Data Labs / hub subdomain gets teal so the form matches the
// datanova pill nav rendered by ItapShell around it. Same pattern as
// /partner/login.
const ORANGE_ACCENT = "#FF914D";  // Oreugo brand orange
const HUB_TEAL      = "#3A3EBF";  // Synergy Data Labs teal

export default function PartnerSignupPage() {
  const router = useRouter();
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const [form, setForm] = useState({
    businessName: "",
    firstName: "",
    lastName: "",
    email: "",
    // Phase F #6e (2026-08-27): phone field now collected in the unified
    // wizard so the supplier flow can drop its dedicated page. Always
    // optional for business accounts; still optional (but useful) for
    // suppliers so we know how to reach them about payouts / KYB.
    phone: "",
    password: "",
    confirmPassword: "",
    // Phase F #6 (2026-08-27): widened to include 'general' for hub-host
    // buyers whose businessType isn't tied to a POS flavour. Fall-through
    // icon paths in step 2 already default to the restaurant cup for
    // anything they don't explicitly branch on — safe for 'general'.
    businessType: "restaurant" as "restaurant" | "salon" | "retail" | "general",
  });
  // Phase F #6e (2026-08-27): unified signup. Both flows use the same
  // wizard now — role decides which POST endpoint runs at the end and
  // whether the phone field is prominent. Software Creator tile flips
  // this to 'supplier' and continues in-form instead of navigating.
  const [role, setRole] = useState<"merchant" | "supplier">("merchant");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const recaptcha = useRecaptcha();

  // Per-host primary. SSR default is Oreugo orange so oreugo.ca doesn't
  // flash teal on first paint; the effect flips it to teal on hub /
  // Synergy Data Labs hosts after hydration. Same pattern as /partner/login.
  const [primary, setPrimary] = useState<string>(ORANGE_ACCENT);
  useEffect(() => {
    setPrimary(isItapHost(window.location.hostname) ? HUB_TEAL : ORANGE_ACCENT);
  }, []);

  useEffect(() => {
    document.title = `Sign Up | ${displayName}`;
  }, [displayName]);

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
      const recaptchaToken = await recaptcha.execute("partner_signup");
      // Phase F #6e (2026-08-27): branch by role so one wizard drives both
      // signups. The two endpoints diverge in what they build server-side
      // (supplier gets a SupplierProfile + businessType='supplier' tenant;
      // merchant gets POS defaults keyed on businessType). Payload keys
      // differ — the supplier endpoint expects `companyName`, so we map.
      const endpoint =
        role === "supplier"
          ? "/api/partner/auth/register-supplier"
          : "/api/partner/auth/register";
      const payload =
        role === "supplier"
          ? {
              companyName: form.businessName,
              firstName: form.firstName,
              lastName: form.lastName,
              email: form.email,
              phone: form.phone,
              password: form.password,
              recaptchaToken,
            }
          : {
              businessName: form.businessName,
              firstName: form.firstName,
              lastName: form.lastName,
              email: form.email,
              // Phase I #4 (2026-09-12): phone required for merchant signup
              // so the verify wizard can fire the phone OTP after account
              // creation. Server validates + normalizes.
              phone: form.phone,
              password: form.password,
              businessType: form.businessType,
              recaptchaToken,
            };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      toast.success(`Account created! Verify your contact details next.`);
      localStorage.setItem("partner_tenant_id", data.tenant.id);
      localStorage.setItem("partner_tenant_slug", data.tenant.slug);
      // Phase I #4 (2026-09-12): both merchant and supplier signups now
      // land in the verification wizard. Tenant is created as
      // PENDING_APPROVAL and the portal is off-limits until email + phone
      // OTPs verify and an admin approves. /partner/verify reads status
      // from the just-issued cookie and drives the wizard end-to-end.
      // Hard nav so the layout picks up the fresh session cleanly.
      if (role === "supplier") {
        localStorage.setItem("tap_active_tenant", data.tenant.id);
      }
      window.location.href = "/partner/verify";
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

  // Light-theme input style — used by every text/email/password field below
  const inputClass =
    "w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all";
  const inputFocusStyle = { "--tw-ring-color": primary, color: NAVY } as React.CSSProperties;

  // Phase F #6 (2026-08-27): the tile set is different per host.
  //   Oreugo (and any other white-label partner) — POS is the whole
  //     product, so the picker shows the three POS flavours + the CTA
  //     underneath is "Sign up as a supplier".
  //   Hub (Synergy Data Labs) — the marketplace is the pitch. A prospect
  //     signing up here is either a buyer (business account, browses the
  //     marketplace) or a creator (lists software). POS is one lane among
  //     many and doesn't belong in first-impression furniture.
  const OREUGO_BUSINESS_TYPES = [
    {
      type: "restaurant" as const,
      label: "Restaurant / Cafe",
      description: "Food service, dine-in, takeaway & delivery",
      icon: "solar:cup-hot-bold-duotone",
    },
    {
      type: "retail" as const,
      label: "Retail / Store",
      description: "Product sales, inventory & quick checkout",
      icon: "solar:bag-heart-bold-duotone",
    },
    {
      type: "salon" as const,
      label: "Salon / Barbershop",
      description: "Appointments, services & technician checkout",
      icon: "solar:scissors-bold-duotone",
    },
  ];
  const HUB_BUSINESS_TYPES = [
    {
      // Neutral businessType stored on the tenant — no POS UI shown until
      // the operator explicitly turns one on from their portal settings
      // (that flow is Phase 5.5 nice-to-have, not built yet). "general"
      // is a plain VarChar value; nothing in the schema enforces the enum.
      type: "general" as const,
      label: "Business account",
      description: "Browse the marketplace, buy apps, run your operations from hub",
      icon: "solar:shop-2-bold-duotone",
    },
  ];
  const businessTypes = primary === HUB_TEAL ? HUB_BUSINESS_TYPES : OREUGO_BUSINESS_TYPES;

  return (
    <PartnerSiteShell>
      <div className="relative flex items-center justify-center py-16 sm:py-24 px-4 overflow-hidden">
        {/* Decorative brand orb for depth on white canvas */}
        <div
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primary }}
        />

        <div className="relative w-full max-w-lg">
          <div className="bg-white rounded-3xl shadow-2xl ring-1 ring-gray-100 p-8 sm:p-10">
            {/* Welcome header */}
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
                style={{ backgroundColor: `${primary}1A` }}
              >
                <Icon icon="solar:add-square-bold-duotone" className="w-9 h-9" style={{ color: primary }} />
              </div>
              <h1 className="text-3xl font-bold" style={{ color: NAVY }}>
                {primary === HUB_TEAL ? "Sign up for hub" : "Create your business"}
              </h1>
              <p className="text-base text-gray-600 mt-2">
                {primary === HUB_TEAL
                  ? "One account. Pick what you'll use hub for below."
                  : "Set up your POS system in minutes"}
              </p>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center gap-2 mb-8">
              <div
                className="flex-1 h-1.5 rounded-full transition-colors"
                style={{ backgroundColor: step >= 1 ? primary : "#E5E7EB" }}
              />
              <div
                className="flex-1 h-1.5 rounded-full transition-colors"
                style={{ backgroundColor: step >= 2 ? primary : "#E5E7EB" }}
              />
              <div
                className="flex-1 h-1.5 rounded-full transition-colors"
                style={{ backgroundColor: step >= 3 ? primary : "#E5E7EB" }}
              />
            </div>

            <form onSubmit={handleSignup}>
              {/* ====== Step 1: Business Type ====== */}
              {step === 1 && (
                <div className="space-y-5">
                  <p className="text-sm font-semibold mb-3" style={{ color: NAVY }}>
                    {primary === HUB_TEAL
                      ? "What do you want to do on hub?"
                      : "What type of business are you?"}
                  </p>
                  <div className="grid grid-cols-1 gap-3">
                    {businessTypes.map((bt) => (
                      <button
                        key={bt.type}
                        type="button"
                        onClick={() => {
                          // Phase F #6e (2026-08-27): reset role to merchant
                          // in case the user previously picked Software
                          // Creator, hit back, and switched to a business tile.
                          setRole("merchant");
                          updateForm("businessType", bt.type);
                          setStep(2);
                        }}
                        className="flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left hover:shadow-md"
                        style={{
                          borderColor: form.businessType === bt.type ? primary : "#E5E7EB",
                          backgroundColor: form.businessType === bt.type ? `${primary}0D` : "white",
                        }}
                      >
                        <div
                          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${primary}1A` }}
                        >
                          <Icon icon={bt.icon} className="w-6 h-6" style={{ color: primary }} />
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-base" style={{ color: NAVY }}>{bt.label}</p>
                          <p className="text-xs text-gray-600 mt-0.5">{bt.description}</p>
                        </div>
                        {form.businessType === bt.type && (
                          <Icon
                            icon="solar:check-circle-bold"
                            className="w-6 h-6 flex-shrink-0"
                            style={{ color: primary }}
                          />
                        )}
                      </button>
                    ))}

                    {/* Phase F #1 (2026-08-27): Hub hosts only — expose the
                        software-creator path directly from the signup wizard.
                        Different auth-model (supplier tenant, not merchant),
                        so instead of continuing this 3-step form we hand off
                        to /partner/signup/supplier which already collects the
                        creator-specific fields (company legal name, etc.).
                        Kept off Oreugo + other white-label partner domains —
                        they're POS-only. */}
                    {primary === HUB_TEAL && (
                      // Phase F #6e (2026-08-27): tile now advances in-form
                      // instead of navigating to /partner/signup/supplier.
                      // Sets role='supplier' + businessType='general' so the
                      // Step 2 UI doesn't try to pick a POS icon based on the
                      // (unused) businessType.
                      <button
                        type="button"
                        onClick={() => {
                          setRole("supplier");
                          updateForm("businessType", "general");
                          setStep(2);
                        }}
                        className="flex items-center gap-4 p-4 rounded-2xl border-2 border-dashed transition-all text-left hover:shadow-md"
                        style={{ borderColor: "#E5E7EB", backgroundColor: "white" }}
                      >
                        <div
                          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${primary}1A` }}
                        >
                          <Icon icon="solar:code-square-bold-duotone" className="w-6 h-6" style={{ color: primary }} />
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-base" style={{ color: NAVY }}>Software Creator</p>
                          <p className="text-xs text-gray-600 mt-0.5">List apps on the hub marketplace</p>
                        </div>
                        <Icon icon="solar:arrow-right-linear" className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ====== Step 2: Business + Personal Info ====== */}
              {step === 2 && (
                <div className="space-y-5">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 -mt-2 mb-2"
                  >
                    <Icon icon="solar:arrow-left-linear" className="w-4 h-4" /> Back
                  </button>

                  {/* Pill showing chosen business type */}
                  <div
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-full"
                    style={{ backgroundColor: `${primary}1A` }}
                  >
                    <Icon
                      icon={
                        role === "supplier"
                          ? "solar:code-square-bold-duotone"
                          : form.businessType === "salon"
                          ? "solar:scissors-bold-duotone"
                          : form.businessType === "retail"
                          ? "solar:bag-heart-bold-duotone"
                          : form.businessType === "general"
                          ? "solar:shop-2-bold-duotone"
                          : "solar:cup-hot-bold-duotone"
                      }
                      className="w-4 h-4"
                      style={{ color: primary }}
                    />
                    <span className="text-xs font-semibold" style={{ color: primary }}>
                      {role === "supplier"
                        ? "Software Creator"
                        : form.businessType === "salon"
                        ? "Salon / Barbershop"
                        : form.businessType === "retail"
                        ? "Retail / Store"
                        : form.businessType === "general"
                        ? "Business account"
                        : "Restaurant / Cafe"}
                    </span>
                  </div>

                  {/* Business / Company name */}
                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                      {role === "supplier" ? "Company Name" : "Business Name"} <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Icon
                        icon={role === "supplier" ? "solar:buildings-bold" : "solar:shop-linear"}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                      />
                      <input
                        type="text"
                        required
                        value={form.businessName}
                        onChange={(e) => updateForm("businessName", e.target.value)}
                        placeholder={
                          role === "supplier"
                            ? "e.g. Fresh Foods Wholesale"
                            : form.businessType === "salon"
                            ? "Your Salon Name"
                            : form.businessType === "retail"
                            ? "Your Store Name"
                            : form.businessType === "general"
                            ? "Your Business Name"
                            : "Your Restaurant Name"
                        }
                        className={inputClass}
                        style={inputFocusStyle}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                        First Name <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Icon icon="solar:user-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          required
                          value={form.firstName}
                          onChange={(e) => updateForm("firstName", e.target.value)}
                          placeholder="First name"
                          className={inputClass}
                          style={inputFocusStyle}
                          autoComplete="given-name"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                        Last Name
                      </label>
                      <div className="relative">
                        <Icon icon="solar:user-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          value={form.lastName}
                          onChange={(e) => updateForm("lastName", e.target.value)}
                          placeholder="Last name"
                          className={inputClass}
                          style={inputFocusStyle}
                          autoComplete="family-name"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                      Email <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Icon icon="solar:letter-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => updateForm("email", e.target.value)}
                        placeholder={role === "supplier" ? "orders@company.com" : "you@business.com"}
                        className={inputClass}
                        style={inputFocusStyle}
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  {/* Phase I #4 (2026-09-12): phone is now REQUIRED for every
                      signup type — the verification wizard sends an OTP to it
                      after account creation and the tenant stays PENDING_APPROVAL
                      until both channels verify. Was supplier-only when phone
                      was just a courtesy contact for KYB. */}
                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                      Phone <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Icon icon="solar:phone-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="tel"
                        required
                        value={form.phone}
                        onChange={(e) => updateForm("phone", e.target.value)}
                        placeholder="+1 (555) 000-0000"
                        className={inputClass}
                        style={inputFocusStyle}
                        autoComplete="tel"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      We&apos;ll text a 6-digit code to verify this number.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (!form.businessName || !form.firstName || !form.email || !form.phone) {
                        toast.error("Please fill in all required fields");
                        return;
                      }
                      // Loose sanity check — server does the real validation.
                      // At least 7 digits after stripping formatting.
                      if (form.phone.replace(/\D/g, "").length < 7) {
                        toast.error("Enter a valid phone number");
                        return;
                      }
                      setStep(3);
                    }}
                    className="leaf-button w-full py-3 text-sm font-semibold text-white transition-all flex items-center justify-center gap-2 hover:opacity-90 shadow-lg"
                    style={{ backgroundColor: primary }}
                  >
                    Continue <Icon icon="solar:arrow-right-linear" className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* ====== Step 3: Password ====== */}
              {step === 3 && (
                <div className="space-y-5">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 -mt-2 mb-2"
                  >
                    <Icon icon="solar:arrow-left-linear" className="w-4 h-4" /> Back
                  </button>

                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                      Password <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Icon icon="solar:lock-keyhole-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        value={form.password}
                        onChange={(e) => updateForm("password", e.target.value)}
                        placeholder="Min 8 chars, uppercase, lowercase, number"
                        className="w-full pl-11 pr-12 py-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                        style={inputFocusStyle}
                        autoComplete="new-password"
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
                    {form.password && (
                      <div className="mt-2">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div
                              key={i}
                              className={`h-1.5 flex-1 rounded-full ${i <= strength.score ? strength.color : "bg-gray-200"}`}
                            />
                          ))}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">{strength.label}</p>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: NAVY }}>
                      Confirm Password <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Icon icon="solar:lock-keyhole-linear" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="password"
                        required
                        value={form.confirmPassword}
                        onChange={(e) => updateForm("confirmPassword", e.target.value)}
                        placeholder="Confirm your password"
                        className={`w-full pl-11 pr-12 py-3 rounded-xl bg-white border text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all ${
                          form.confirmPassword && form.confirmPassword !== form.password
                            ? "border-red-500"
                            : "border-gray-200"
                        }`}
                        style={inputFocusStyle}
                        autoComplete="new-password"
                      />
                      {form.confirmPassword && form.confirmPassword === form.password && (
                        <Icon
                          icon="solar:check-circle-bold"
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-green-600"
                        />
                      )}
                    </div>
                    {form.confirmPassword && form.confirmPassword !== form.password && (
                      <p className="text-xs text-red-600 mt-1">Passwords don&apos;t match</p>
                    )}
                  </div>

                  <p className="text-xs text-gray-600">
                    By creating an account, you agree to our{" "}
                    <Link
                      href={routes.isPartnerDomain ? "/terms" : "/partner/terms"}
                      style={{ color: primary }}
                      className="font-semibold hover:underline"
                    >
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link
                      href={routes.isPartnerDomain ? "/privacy" : "/partner/privacy"}
                      style={{ color: primary }}
                      className="font-semibold hover:underline"
                    >
                      Privacy Policy
                    </Link>
                    .
                  </p>

                  <button
                    type="submit"
                    disabled={loading || form.password !== form.confirmPassword}
                    className="leaf-button w-full py-3 text-sm font-semibold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90 shadow-lg"
                    style={{ backgroundColor: primary }}
                  >
                    {loading ? (
                      <>
                        <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      <>
                        Create Account <Icon icon="solar:arrow-right-linear" className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </form>

            <div className="my-7 border-t border-gray-100" />
            <p className="text-center text-sm text-gray-600">
              Already have an account?{" "}
              <Link
                href={routes.login}
                className="font-semibold hover:opacity-70 transition-opacity"
                style={{ color: primary }}
              >
                Login
              </Link>
            </p>
            {/* Phase B (2026-07-30): pointer to the supplier-side signup.
                On hub, the Software Creator tile in Step 1 handles this in
                one click, so the pointer just adds noise — hidden. On Oreugo
                (POS-only) the tile isn't shown, so we keep the fallback so
                the odd supplier who lands there has a way over. */}
            {primary !== HUB_TEAL && (
              <p className="text-center text-sm text-gray-500 mt-2">
                Sell to businesses on iTap?{" "}
                <Link
                  href="/partner/signup/supplier"
                  className="font-semibold hover:opacity-70 transition-opacity text-gray-700"
                >
                  Sign up as a supplier →
                </Link>
              </p>
            )}
          </div>

          {/* Help text below the card — support email routed by palette. */}
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
