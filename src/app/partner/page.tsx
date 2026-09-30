"use client";

// ============================================================================
// /partner — Public landing page (white-label, brand-aware)
//
// PHASE 7b (2026-05-18) REDESIGN
// - Light theme inspired by the dsign-tailwind-nextjs-free template
// - Poppins typography via root layout's --font-poppins CSS var
// - Hero uses the partner-supplied image at /images/home/b9x79.jpg
// - Logos drawn from /images/logo/pl/ (partner-uploaded assets)
// - Template's signature "leaf-button" curved CTA shape
// - Partner brand colors take precedence over template defaults — if a
//   partner hasn't set their colors, we fall back to the template's blue
//   palette (#0075FF primary, #002834 navy, #DAEBFF light blue)
// - Menu items + footer columns + contact form + cookie banner kept from
//   the previous landing per user request
// ============================================================================

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";
import { useRecaptcha } from "@/hooks/useRecaptcha";

// Template default palette — used when partner has not set their own brand
// colors in TenantSettings. Each tenant can override via Settings UI.
const TEMPLATE_DEFAULTS = {
  primary: "#0075FF",     // blue
  navy: "#002834",        // deep navy text/background
  lightBlue: "#DAEBFF",   // soft section backgrounds
  accent: "#00276F",      // mid blue accent
};

// Official Oreugo brand palette (from the partner-supplied brand sheet).
// Used across the entire public site so the page reads in their actual
// brand colours rather than the template's default blue.
const ORANGE_ACCENT = "#FF914D";   // brand orange (CTAs, accents)
const GREEN_PRIMARY = "#195937";   // brand green (header, primary surfaces)
const GREEN_DARK = "#202F27";      // deep green (footer, contrast surfaces)
// Helvetica Now Display is a licensed Monotype face. We declare it first
// in the stack so machines with it installed (or self-hosted via @font-face
// later) render it; otherwise we fall back through system Helvetica → Arial
// → generic sans for a visually consistent typeface.
const BRAND_FONT_STACK = "'Helvetica Now Display', Helvetica, Arial, sans-serif";

// Partner-supplied logos live under public/images/logo/pl/. We use the
// black wordmark for light backgrounds and the white wordmark when the
// section background is dark (footer).
const PARTNER_LOGO_DARK_ON_LIGHT = "/images/logo/pl/oreugo_wordmark_black.png";
const PARTNER_LOGO_LIGHT_ON_DARK = "/images/logo/pl/oreugo_wordmark_white.png";
// Hero collage supplied by the partner — 7-image grid spanning POS terminal,
// restaurant, retail. Wide landscape aspect; no overlay pills so the
// composition reads cleanly.
const HERO_IMAGE = "/images/home/homepage.png";
// Why-us strip keeps the original cropped lifestyle shot — different scene
// from the hero so the page isn't visually repetitive.
const SECONDARY_IMAGE = "/images/home/b9x79.jpg";
const PARTNER_FAVICON_DEFAULT = "/images/logo/pl/fvi.png";

export default function PartnerLandingPage() {
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Resolve effective brand colors: prefer tenant's overrides, fall back to
  // template defaults so a brand-new tenant still gets a polished look.
  //
  // PHASE 7b-fix1 (2026-05-18): removed `softBg` (light-blue section bg).
  // Per partner feedback the page should be white throughout with only the
  // footer in dark — the light-blue made content blend in. We keep the
  // template's lightBlue token available for incidental accents if needed.
  // PHASE 7b-fix7 (2026-06-25): partner asked for the whole landing page
  // to read in orange instead of cyan. Rather than touch every styled
  // element, we override the `primary` constant here — every existing
  // `style={{ color: primary }}` / `backgroundColor: primary` reference
  // automatically picks up the new orange. The brand's actual cyan stays
  // in the DB (`brandPrimaryColor`) for the admin portal and business
  // booking page; only this public marketing page is forced orange.
  const primary = ORANGE_ACCENT;
  const accent = branding.brandAccentColor || TEMPLATE_DEFAULTS.accent;
  const navy = TEMPLATE_DEFAULTS.navy;

  // Dynamic page title + favicon. We prefer the partner's uploaded favicon
  // (DB-driven `brandFaviconUrl`) but fall back to the static Oreugo `fvi.png`
  // shipped under /images/logo/pl/ so the tab icon is never the default Next.
  useEffect(() => {
    document.title = `${displayName} | Modern Point of Sale Solutions`;
    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (link) link.href = branding.brandFaviconUrl || PARTNER_FAVICON_DEFAULT;
  }, [displayName, branding.brandFaviconUrl]);

  // Cookie consent
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  useEffect(() => {
    const consent = localStorage.getItem("cookie_consent");
    if (!consent) setShowCookieBanner(true);
  }, []);
  const acceptCookies = () => {
    localStorage.setItem("cookie_consent", "accepted");
    setShowCookieBanner(false);
  };

  // Contact form (kept identical to previous page — POSTs to /api/partner/contact)
  const [contactForm, setContactForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    company: "",
    interest: [] as string[],
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const recaptcha = useRecaptcha();

  const toggleInterest = (item: string) => {
    setContactForm((prev) => ({
      ...prev,
      interest: prev.interest.includes(item)
        ? prev.interest.filter((i) => i !== item)
        : [...prev.interest, item],
    }));
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    try {
      const recaptchaToken = await recaptcha.execute("partner_contact");
      const res = await fetch("/api/partner/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...contactForm, recaptchaToken }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
      } else {
        setSubmitError(data.error || "Failed to send. Please try again.");
      }
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Logo resolution:
  //
  // PHASE 7b-fix9 (2026-06-25): partner asked us to use the BLACK wordmark
  // in the header (per their brand sheet — black logo on the brand green is
  // an approved combination) and the WHITE wordmark in the footer. Both are
  // pinned to the static PNG files so the DB-stored `brandLogoUrl` (which
  // points at the cyan wordmark from an earlier iteration) doesn't override
  // them on a dark background. When the partner exports a brand-spec
  // header/footer logo and we update the DB, switch back to the override.
  const logoForLight = PARTNER_LOGO_DARK_ON_LIGHT;
  const logoForDark = PARTNER_LOGO_LIGHT_ON_DARK;

  const features = [
    { tag: "MANAGE ORDERS EASILY", title: "POS Software", description: "Quick service, table service, pickup, delivery & takeaway — manage every order type from a single, intuitive interface.", icon: "solar:monitor-smartphone-bold-duotone" },
    { tag: "IN HOUSE", title: "Online Ordering", description: "Consolidate mobile orders directly into your POS. No third-party fees, no commission cuts — keep more of your revenue.", icon: "solar:smartphone-bold-duotone" },
    { tag: "SEAMLESS", title: "Tableside Ordering", description: "QR code ordering lets guests browse, order, and pay right from their table — reducing wait times and boosting turnover.", icon: "solar:qr-code-bold-duotone" },
    { tag: "INTEGRATED", title: "Payment Processing", description: "Tap, chip, swipe, Apple Pay, Google Pay — with the lowest processing rates in the industry.", icon: "solar:card-recive-bold-duotone" },
    { tag: "FULL CONTROL", title: "Inventory & Supply Chain", description: "Track stock levels in real time, set low-stock alerts, manage suppliers, automate purchase orders.", icon: "solar:box-bold-duotone" },
    { tag: "REAL-TIME INSIGHTS", title: "Analytics & Reporting", description: "Live dashboards for sales, labour costs, product mix, peak hours — make data-driven decisions.", icon: "solar:chart-2-bold-duotone" },
    { tag: "BACK OF HOUSE", title: "Kitchen Display System", description: "Replace paper tickets with a digital display. Orders flow instantly from POS to kitchen with priority routing.", icon: "solar:chef-hat-bold-duotone" },
    { tag: "GROW YOUR TEAM", title: "Staff Management", description: "Role-based permissions, time tracking, shift scheduling, and performance reports.", icon: "solar:users-group-rounded-bold-duotone" },
  ];

  // 500+ Restaurants was removed at partner's request — they're a new
  // brand and don't want to claim a customer count yet. Three stats
  // still read as a clean row and the grid below auto-flexes to 3-col.
  const stats = [
    { value: "99.9%", label: "Uptime" },
    { value: "24/7", label: "Support" },
    { value: "2 min", label: "Setup" },
  ];

  const inputFocusStyle = { "--tw-ring-color": primary } as React.CSSProperties;

  return (
    // PHASE 7b-fix8 (2026-06-25): swapped from Poppins to the brand font
    // stack (Helvetica Now Display with Helvetica/Arial fallbacks) so the
    // page renders in Oreugo's actual brand typeface.
    <div className="min-h-screen bg-white" style={{ color: navy, fontFamily: BRAND_FONT_STACK }}>
      {/* =========================================================
          NAV (sticky, light) — same menu items as previous landing
          PHASE 7b-fix3 (2026-05-18):
          - Inner container now constrained to max-w-7xl mx-auto so the
            logo on the left and the CTA on the right sit in the SAME
            gutter as the hero/features below. Previously the nav used
            `w-full px-6 sm:px-10 lg:px-16` which pushed the logo to the
            very edge of the viewport — looked detached.
          - Bigger "Get Started" button (px-8 py-3 text-base) so it has
            the template's heft. Login link bumped to text-base.
          - h-20 (was h-18 which isn't a tailwind class) for the nav row.
          ========================================================= */}
      {/* PHASE 7b-fix8: header now uses GREEN_PRIMARY background with the
          WHITE wordmark + white menu text, per Oreugo brand sheet. Orange
          accent stays on Login + Get Started for the colour pop. */}
      <nav
        className="sticky top-0 z-50 backdrop-blur-sm border-b"
        style={{ backgroundColor: `${GREEN_PRIMARY}F2`, borderColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
          <div className="flex items-center justify-between h-20 py-4">
            <Link href={routes.home} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoForLight} alt={displayName} className="h-10 sm:h-12 object-contain" />
            </Link>

            <div className="hidden md:flex items-center gap-10">
              {[
                ["Features", "#features"],
                ["Solutions", "#solutions"],
                ["Hardware", "#hardware"],
                ["Pricing", "#pricing"],
                ["Contact", "#contact"],
              ].map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  className="text-[15px] font-medium tracking-wide uppercase hover:opacity-80 transition-opacity text-white"
                >
                  {label}
                </a>
              ))}
            </div>

            <div className="flex items-center gap-5">
              {/* PHASE 7b-fix10 (2026-06-25): Login flipped to white + bold
                  with a thin underline at hover-offset — reads cleanly on
                  the green header and feels intentional rather than weak. */}
              <Link
                href={routes.login}
                className="hidden sm:inline-block text-base font-semibold tracking-wide text-white underline decoration-2 decoration-white/30 underline-offset-[6px] hover:decoration-white transition-all"
              >
                Login
              </Link>
              <Link
                href={routes.signup}
                className="leaf-button px-8 py-3 text-base font-semibold text-white hover:opacity-90 transition-opacity shadow-md"
                style={{ backgroundColor: ORANGE_ACCENT }}
              >
                Get Started
              </Link>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-white"
                aria-label="Open menu"
              >
                <Icon
                  icon={mobileMenuOpen ? "solar:close-circle-linear" : "solar:hamburger-menu-linear"}
                  className="w-6 h-6"
                />
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div
            className="md:hidden border-t px-6 py-4 space-y-3"
            style={{ backgroundColor: GREEN_PRIMARY, borderColor: "rgba(255,255,255,0.08)" }}
          >
            {[
              ["Features", "#features"],
              ["Solutions", "#solutions"],
              ["Hardware", "#hardware"],
              ["Pricing", "#pricing"],
              ["Contact", "#contact"],
              ["Login", routes.login],
            ].map(([label, href]) => (
              <a
                key={label}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2 font-medium hover:opacity-80 text-white"
              >
                {label}
              </a>
            ))}
          </div>
        )}
      </nav>

      {/* =========================================================
          HERO — 5/7 grid, white background, bigger headings + image
          PHASE 7b-fix1 (2026-05-18):
          - Background: white (template-faithful, matches what partner
            asked for; light-blue accent only appears as decorative orbs)
          - Heading: text-7xl on lg+ (was text-6xl) — meaningfully bigger
          - Grid: 12-col with text=5 / image=7 so the image dominates
          - Floating "Orders today" pill kept but with stronger shadow
            and a thin border so it reads cleanly on white
          ========================================================= */}
      <section className="relative overflow-hidden bg-white">
        {/* Decorative blur orbs — soft, sit BEHIND content to add depth
            without competing with it on a white canvas. Hidden on mobile
            because at small viewports they can cause faint horizontal
            scrollbars (overflow-hidden saves us, but `hidden md:block`
            also avoids painting them at all on phones). */}
        <div
          className="absolute -top-40 -right-40 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-20 hidden md:block"
          style={{ backgroundColor: primary }}
        />
        <div
          className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full blur-3xl opacity-10 hidden md:block"
          style={{ backgroundColor: accent }}
        />

        {/* PHASE 7b-fix6 (2026-06-25): hero container widened from max-w-7xl
            (1280px) to max-w-screen-2xl (1536px) and image col bumped from
            col-span-8 to col-span-9 — partner wants the collage to dominate
            the right side of the viewport. Everything else on the page stays
            in max-w-7xl so this is a deliberate hero-only spotlight. */}
        <div className="relative w-full max-w-screen-2xl mx-auto px-5 sm:px-10 lg:px-16 py-12 sm:py-16 lg:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-10 items-center">
            <div className="lg:col-span-3 flex flex-col justify-center text-center lg:text-left">
              <span
                className="inline-block px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider mb-6"
                style={{ backgroundColor: `${primary}1A`, color: primary }}
              >
                Built for modern businesses
              </span>
              {/* PHASE 7b-fix5: headline scaled back from text-7xl → text-5xl
                  on lg so the now-narrower text column doesn't run 7+ lines
                  tall and visually outweigh the wide collage. Still bold and
                  anchoring, just sized to live next to the bigger image. */}
              <h1
                className="text-4xl sm:text-5xl lg:text-5xl font-bold leading-[1.1] mb-5 tracking-tight"
                style={{ color: navy }}
              >
                Run your business on{" "}
                <span style={{ color: primary }}>one platform</span> — POS,
                payments, and reservations.
              </h1>
              <p className="text-base lg:text-lg text-gray-600 mb-7 leading-relaxed">
                From table to terminal in seconds. {displayName} brings together everything
                you need to run your business — tap, scan, and you're live.
              </p>
              {/* CTA buttons go full-width on mobile (better tap target +
                  cleaner stack), then size-to-content on sm+. */}
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <Link
                  href={routes.signup}
                  className="leaf-button px-8 py-4 text-base font-semibold text-white hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-2 shadow-lg"
                  style={{ backgroundColor: primary }}
                >
                  Start free trial
                  <Icon icon="solar:arrow-right-bold" className="w-5 h-5" />
                </Link>
                <a
                  href="#contact"
                  className="leaf-button px-8 py-4 text-base font-semibold border-2 hover:opacity-80 transition-opacity inline-flex items-center justify-center"
                  style={{ borderColor: navy, color: navy }}
                >
                  Book a demo
                </a>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-4 sm:gap-6 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <Icon icon="solar:check-circle-bold" className="w-5 h-5" style={{ color: primary }} />
                  No setup fee
                </div>
                <div className="flex items-center gap-2">
                  <Icon icon="solar:check-circle-bold" className="w-5 h-5" style={{ color: primary }} />
                  Cancel anytime
                </div>
              </div>
            </div>

            {/* Image column — col-span-9 visual anchor. The collage is a
                ~2:1 landscape composition; we render at its natural aspect
                with `w-full h-auto` so every tile is visible and the image
                stretches fully across the right side of the wider hero
                container. No object-cover (that was center-cropping it). */}
            <div className="relative lg:col-span-9">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={HERO_IMAGE}
                alt={`${displayName} — POS terminal, restaurant and retail in one platform`}
                className="block w-full h-auto max-w-none rounded-3xl shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          STATS — light grey strip
          PHASE 7b-fix1: bigger numerals to match the new hero scale
          ========================================================= */}
      <section className="bg-white py-16 border-y border-gray-100">
        <div className="w-full max-w-6xl mx-auto px-6 sm:px-10 lg:px-16">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {stats.map((s) => (
              <div key={s.label}>
                <p
                  className="text-5xl sm:text-6xl font-bold tracking-tight"
                  style={{ color: primary }}
                >
                  {s.value}
                </p>
                <p className="text-sm text-gray-600 mt-3 font-bold tracking-wider uppercase">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =========================================================
          FEATURES — card grid
          PHASE 7b-fix1 (2026-05-18):
          - Section heading: text-6xl (was 5xl) to anchor the page
          - Card tags: text-sm font-bold (was text-xs font-semibold)
            and bumped color contrast — partner said tags were "very tiny"
          - Card titles: text-2xl (was xl) and tighter leading
          - Cards: more padding (p-7 vs p-6) + visible default border
            instead of "appears only on hover" — they read as cards always
          ========================================================= */}
      <section id="features" className="py-16 sm:py-20 lg:py-24 bg-white">
        <div className="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
          <div className="text-center max-w-3xl mx-auto mb-16">
            {/* "Everything you need" tag uses the orange accent per partner
                ask — visually pairs with the orange nav buttons up top so
                the colour shows up in more than one spot. */}
            <span
              className="inline-block px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider mb-5"
              style={{ backgroundColor: `${ORANGE_ACCENT}1A`, color: ORANGE_ACCENT }}
            >
              Everything you need
            </span>
            <h2
              className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-5 tracking-tight"
              style={{ color: navy }}
            >
              All-in-one platform
            </h2>
            <p className="text-xl text-gray-600 leading-relaxed">
              From counter to checkout, {displayName} is the operating system for restaurants, cafés, salons, and retail.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-white rounded-2xl p-7 border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group"
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform"
                  style={{ backgroundColor: `${primary}1A` }}
                >
                  <Icon icon={f.icon} className="w-8 h-8" style={{ color: primary }} />
                </div>
                <p
                  className="text-sm font-bold uppercase tracking-wider mb-3"
                  style={{ color: primary }}
                >
                  {f.tag}
                </p>
                <h3 className="text-2xl font-bold mb-3 leading-tight" style={{ color: navy }}>
                  {f.title}
                </h3>
                <p className="text-base text-gray-600 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =========================================================
          SOLUTIONS / "WHY US" — image+copy alternating
          ========================================================= */}
      {/* =========================================================
          SOLUTIONS / "WHY US"
          PHASE 7b-fix1: gray-50 strip to break the white run, bigger H2,
          bigger row titles, larger checkmark tiles
          ========================================================= */}
      {/* PHASE 7b-fix6 (2026-06-25): "Why us" container widened from
          max-w-7xl to max-w-screen-2xl and the grid switched from a
          50/50 split to a 4/8 12-col split — partner wants this image
          to dominate the right side, same treatment as the hero. */}
      <section id="solutions" className="py-16 sm:py-20 lg:py-24" style={{ backgroundColor: "#F8FAFC" }}>
        <div className="w-full max-w-screen-2xl mx-auto px-6 sm:px-10 lg:px-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <div className="lg:col-span-4">
              <span
                className="inline-block px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider mb-5"
                style={{ backgroundColor: `${primary}1A`, color: primary }}
              >
                Why {displayName}
              </span>
              <h2
                className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-8 leading-tight tracking-tight"
                style={{ color: navy }}
              >
                Built by operators, for operators.
              </h2>
              <div className="space-y-6">
                {[
                  { title: "No long-term contracts", desc: "Pay monthly, scale up or down as your business changes." },
                  { title: "Setup in under an hour", desc: "Hardware ships pre-configured. Menu import from CSV in minutes." },
                  { title: "Always on", desc: "Offline mode keeps orders flowing even if the internet drops." },
                  { title: "Real Canadian support", desc: "Talk to a human in your timezone, day or night." },
                ].map((item) => (
                  <div key={item.title} className="flex gap-4">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${primary}1A` }}
                    >
                      <Icon icon="solar:check-circle-bold" className="w-7 h-7" style={{ color: primary }} />
                    </div>
                    <div>
                      <h3 className="font-bold text-xl mb-1.5" style={{ color: navy }}>{item.title}</h3>
                      <p className="text-base text-gray-600 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative lg:col-span-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={SECONDARY_IMAGE}
                alt="Operator using POS"
                className="block w-full h-auto max-w-none rounded-3xl shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          CONTACT
          PHASE 7b-fix1: section bg WHITE (was light-blue) to match the
          template, "Let's talk" intro made meaningfully more stylish:
          - Larger badge with leading dot accent
          - H2 bumped to 6xl
          - Contact lines styled as pill rows with brand-tinted icon tiles
          - Form card now sits on a subtle gray surface for separation
          ========================================================= */}
      <section id="contact" className="py-16 sm:py-20 lg:py-24 bg-white relative overflow-hidden">
        {/* Soft brand-tinted orb in the background — adds depth without
            making the section feel "filled in" the way light-blue did */}
        <div
          className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl opacity-10"
          style={{ backgroundColor: primary }}
        />
        <div className="relative w-full max-w-6xl mx-auto px-6 sm:px-10 lg:px-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
            <div>
              <span
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider mb-6"
                style={{ backgroundColor: `${primary}1A`, color: primary }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full animate-pulse"
                  style={{ backgroundColor: primary }}
                />
                Let's talk
              </span>
              <h2
                className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight tracking-tight"
                style={{ color: navy }}
              >
                Ready to upgrade your business?
              </h2>
              <p className="text-xl text-gray-600 mb-10 leading-relaxed">
                Tell us about your business — we'll put together a custom demo
                and a quote that fits.
              </p>

              {/* Contact rows as pill-styled action chips */}
              <div className="space-y-3">
                <div
                  className="flex items-center gap-4 p-4 rounded-2xl border border-gray-100"
                  style={{ color: navy }}
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primary}1A` }}
                  >
                    <Icon icon="solar:buildings-bold-duotone" className="w-6 h-6" style={{ color: primary }} />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Company</p>
                    <p className="text-base font-semibold">{displayName} Technologies Inc.</p>
                  </div>
                </div>
                <a
                  href="mailto:info@oreugo.ca"
                  className="flex items-center gap-4 p-4 rounded-2xl border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all"
                  style={{ color: navy }}
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primary}1A` }}
                  >
                    <Icon icon="solar:letter-bold-duotone" className="w-6 h-6" style={{ color: primary }} />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Email</p>
                    <p className="text-base font-semibold">info@oreugo.ca</p>
                  </div>
                </a>
                <a
                  href="tel:+12265000381"
                  className="flex items-center gap-4 p-4 rounded-2xl border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all"
                  style={{ color: navy }}
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${primary}1A` }}
                  >
                    <Icon icon="solar:phone-bold-duotone" className="w-6 h-6" style={{ color: primary }} />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Phone</p>
                    <p className="text-base font-semibold">226-500-0381</p>
                  </div>
                </a>
              </div>
            </div>

            <div className="bg-white rounded-3xl p-8 sm:p-10 shadow-2xl ring-1 ring-gray-100">
              {submitted ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                    <Icon icon="solar:check-circle-bold" className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-bold mb-2" style={{ color: navy }}>Thank you!</h3>
                  <p className="text-gray-500">We'll be in touch shortly.</p>
                </div>
              ) : (
                <>
                  <h3 className="text-xl font-bold mb-6 text-center" style={{ color: navy }}>
                    Request a Demo
                  </h3>
                  <hr className="mb-6 border-gray-100" />
                  <form onSubmit={handleContactSubmit} className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold mb-2" style={{ color: navy }}>
                        I&apos;m Interested in...
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {["Point of Sale", "Payments", "Online Ordering", "Hardware", "Integrations"].map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => toggleInterest(item)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                              contactForm.interest.includes(item) ? "" : "border-gray-200 text-gray-600 hover:border-gray-300"
                            }`}
                            style={
                              contactForm.interest.includes(item)
                                ? { backgroundColor: `${primary}1A`, borderColor: primary, color: primary }
                                : undefined
                            }
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold mb-1" style={{ color: navy }}>
                          First Name <span className="text-red-500">*</span>
                        </label>
                        <input type="text" required value={contactForm.firstName}
                          onChange={(e) => setContactForm((p) => ({ ...p, firstName: e.target.value }))}
                          placeholder="Enter first name"
                          className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                          style={inputFocusStyle} />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold mb-1" style={{ color: navy }}>Last Name</label>
                        <input type="text" value={contactForm.lastName}
                          onChange={(e) => setContactForm((p) => ({ ...p, lastName: e.target.value }))}
                          placeholder="Enter last name"
                          className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                          style={inputFocusStyle} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold mb-1" style={{ color: navy }}>
                          Email <span className="text-red-500">*</span>
                        </label>
                        <input type="email" required value={contactForm.email}
                          onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))}
                          placeholder="you@company.com"
                          className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                          style={inputFocusStyle} />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold mb-1" style={{ color: navy }}>Phone</label>
                        <input type="tel" value={contactForm.phone}
                          onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))}
                          placeholder="226-500-0381"
                          className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                          style={inputFocusStyle} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold mb-1" style={{ color: navy }}>
                        Company <span className="text-red-500">*</span>
                      </label>
                      <input type="text" required value={contactForm.company}
                        onChange={(e) => setContactForm((p) => ({ ...p, company: e.target.value }))}
                        placeholder="Your business name"
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                        style={inputFocusStyle} />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold mb-1" style={{ color: navy }}>Message</label>
                      <textarea rows={3} value={contactForm.message}
                        onChange={(e) => setContactForm((p) => ({ ...p, message: e.target.value }))}
                        placeholder="Tell us about your business..."
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent resize-none"
                        style={inputFocusStyle} />
                    </div>

                    {submitError && (
                      <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{submitError}</p>
                    )}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="leaf-button w-full py-3 text-base font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: primary }}
                    >
                      {submitting ? "Sending..." : "Submit"}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
          FOOTER (kept structure — 4 columns + bottom bar)
          ========================================================= */}
      {/* PHASE 7b-fix8: footer now uses GREEN_DARK to match Oreugo's brand
          palette and create a clean two-tone with the GREEN_PRIMARY header.
          White wordmark works on both. */}
      <footer className="border-t" style={{ backgroundColor: GREEN_DARK, borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 py-16">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
            <div>
              {/* PHASE 7b-fix9: -ml-2 nudges the wordmark left so its visible
                  edge aligns with the "Oreugo Technologies Inc." caption and
                  the email / phone rows below — the PNG carries a few px of
                  transparent padding on its left side that throws off the
                  flush-left look. `object-left` anchors the rendered image
                  to the left of its box too. */}
              <div className="flex items-center mb-4 -ml-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoForDark} alt={displayName} className="h-10 object-contain object-left" />
              </div>
              <p className="text-sm text-gray-300 mb-4">{displayName} Technologies Inc.</p>
              <div className="space-y-2 mb-6">
                <a href="mailto:info@oreugo.ca" className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors">
                  <Icon icon="solar:letter-linear" className="w-4 h-4" />
                  info@oreugo.ca
                </a>
                <a href="tel:+12265000381" className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors">
                  <Icon icon="solar:phone-linear" className="w-4 h-4" />
                  226-500-0381
                </a>
              </div>
              <div className="flex items-center gap-4">
                <a href="https://www.instagram.com/oreugo.pos" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                  <Icon icon="mdi:instagram" className="w-5 h-5" />
                </a>
                <a href="https://www.linkedin.com/company/oreugo/" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                  <Icon icon="mdi:linkedin" className="w-5 h-5" />
                </a>
                <a href="https://www.facebook.com/share/1B9ezFDbdm/" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                  <Icon icon="mdi:facebook" className="w-5 h-5" />
                </a>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Products</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Point of Sale", href: "#features" },
                  { label: "Online Ordering", href: "#features" },
                  { label: "Tableside Ordering", href: "#features" },
                  { label: "Payment Processing", href: "#features" },
                  { label: "POS Hardware", href: "#hardware" },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.href} className="text-sm text-gray-300 hover:text-white transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Features</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Kitchen Display", href: "#features" },
                  { label: "Inventory Management", href: "#features" },
                  { label: "Staff Management", href: "#features" },
                  { label: "Analytics & Reporting", href: "#features" },
                  { label: "Multi-location", href: "#solutions" },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.href} className="text-sm text-gray-300 hover:text-white transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "About Us", href: routes.isPartnerDomain ? "/about" : "/partner/about" },
                  { label: "Contact Us", href: "#contact" },
                  { label: "Privacy Policy", href: routes.isPartnerDomain ? "/privacy" : "/partner/privacy" },
                  { label: "Terms & Conditions", href: routes.isPartnerDomain ? "/terms" : "/partner/terms" },
                  { label: "Cookie Policy", href: routes.isPartnerDomain ? "/cookies" : "/partner/cookies" },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.href} className="text-sm text-gray-300 hover:text-white transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10">
          <div className="w-full px-6 sm:px-10 lg:px-16 py-6 text-center">
            <p className="text-sm text-gray-400">
              &copy; {displayName} Technologies Inc. {new Date().getFullYear()} &mdash; All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* Cookie Consent Banner (light theme) */}
      {showCookieBanner && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-2xl">
          <div className="w-full px-6 sm:px-10 lg:px-16 py-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm leading-relaxed" style={{ color: navy }}>
                  We use cookies to enhance your experience, analyze site traffic, and improve our services. By continuing, you agree to our{" "}
                  <a href={routes.isPartnerDomain ? "/cookies" : "/partner/cookies"} className="underline font-medium" style={{ color: primary }}>
                    Cookie Policy
                  </a>{" "}
                  and{" "}
                  <a href={routes.isPartnerDomain ? "/privacy" : "/partner/privacy"} className="underline font-medium" style={{ color: primary }}>
                    Privacy Policy
                  </a>
                  .
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 w-full sm:w-auto">
                <button
                  onClick={acceptCookies}
                  className="leaf-button flex-1 sm:flex-none px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: primary }}
                >
                  Accept All
                </button>
                <button
                  onClick={acceptCookies}
                  className="leaf-button flex-1 sm:flex-none px-6 py-2.5 text-sm font-semibold border-2 hover:bg-gray-50 transition-colors"
                  style={{ borderColor: navy, color: navy }}
                >
                  Essential Only
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
