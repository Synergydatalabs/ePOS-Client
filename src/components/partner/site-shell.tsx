"use client";

// ============================================================================
// PartnerSiteShell — shared chrome for partner-facing auxiliary pages
// (login, signup, reset-password, about, privacy, terms, cookies).
//
// PHASE 7b-fix2 (2026-05-18):
//   Rewritten to match the new partner landing page theme:
//   - White navigation bar with black wordmark logo
//   - Same menu items as the new landing (Features / Solutions / Hardware /
//     Pricing / Contact)
//   - Dark navy footer matching the landing footer
//   - Poppins font (`font-poppins`)
//   - Light cookie banner instead of dark
//
//   Pages slot their content into the middle area on white background.
//   For auth pages (login/signup) the form card should be light (bg-white
//   with subtle border/shadow) — see partner/login/page.tsx for the pattern.
// ============================================================================

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";
import ItapShell from "./itap-shell";

// Template-faithful default palette — overridden by tenant branding when set
const TEMPLATE_DEFAULTS = {
  primary: "#0075FF",
  navy: "#002834",
};

// ---------------------------------------------------------------------------
// Per-host chrome config.
//
// The shell was originally pinned to Oreugo's colours + logos regardless of
// host. That's correct on oreugo.ca (Oreugo IS the tenant), but on the
// canonical iTap platform host (itap.synergydatalabs.com) it looked wrong —
// showing the Oreugo header on the iTap signup / signin pages.
//
// We now pick a chrome preset at mount based on window.location.hostname:
//   • iTap host   → purple/magenta gradient palette, iTap wordmark,
//                   Synergy Data Labs contact info in the footer.
//   • Anything else → Oreugo palette (dark green + orange CTA) — original
//                     behaviour, so Oreugo and any inherited partner
//                     domain still render exactly as before.
//
// If more partners land in the future, extend the picker rather than
// bolting more hostname checks into JSX.
// ---------------------------------------------------------------------------

interface ShellChrome {
  headerBg: string;
  footerBg: string;
  ctaBg: string;
  // 2026-10-08: the accent the AUTH FORMS use - buttons, focus rings,
  // selected tiles. Deliberately separate from ctaBg, which is the marketing
  // CTA on the chrome: Indian Beans' header CTA is gold (#E0A526), and gold
  // carrying white button text is about 1.9:1, so reusing ctaBg in a form
  // would be unreadable. This is the tenant's own primary-button colour.
  //
  // It exists because the auth pages were each deciding their accent with a
  // two-way host test (hub teal or Oreugo orange), so a third tenant could
  // only ever come out as one of the other two. Indian Beans rendered the
  // whole signup card in Oreugo orange inside its own green chrome.
  formAccent: string;
  logoOnLight: string;
  logoOnDark: string;
  contactEmail: string;
  contactPhone: string | null;
  companyName: string;
  socials: Array<{ href: string; icon: string; label: string }>;
  // 2026-10-07: per-tenant top nav items. Each entry is [label, href].
  // The href can be an anchor (#features) OR an absolute path (/features)
  // for tenants whose landing is multi-page rather than one-page scroll.
  // Omit / empty = render no nav links (brand + CTA only).
  navItems?: Array<[string, string]>;
}

const OREUGO_CHROME: ShellChrome = {
  headerBg: "#195937",     // brand green
  footerBg: "#202F27",     // deep green
  ctaBg: "#FF914D",        // brand orange
  formAccent: "#FF914D",   // same as the CTA - orange on white reads fine
  logoOnLight: "/images/logo/pl/oreugo_wordmark_black.png",
  logoOnDark: "/images/logo/pl/oreugo_wordmark_white.png",
  contactEmail: "info@oreugo.ca",
  contactPhone: "226-500-0381",
  companyName: "Oreugo",
  socials: [
    { href: "https://www.instagram.com/oreugo.pos", icon: "mdi:instagram", label: "Instagram" },
    { href: "https://www.linkedin.com/company/oreugo/", icon: "mdi:linkedin", label: "LinkedIn" },
    { href: "https://www.facebook.com/share/1B9ezFDbdm/", icon: "mdi:facebook", label: "Facebook" },
  ],
};

const ITAP_CHROME: ShellChrome = {
  headerBg: "#6D5DEC",     // iTap purple (matches wordmark gradient start)
  footerBg: "#2A1E5C",     // deep purple
  ctaBg: "#E13FB0",        // iTap magenta (matches wordmark gradient end)
  formAccent: "#3A3EBF",   // Synergy teal, as the auth pages already used
  logoOnLight: "/images/logo/itap-wordmark.png",
  logoOnDark: "/images/logo/itap-wordmark.png",
  contactEmail: "hello@synergydatalabs.com",
  contactPhone: null,
  companyName: "Synergy Data Labs",
  socials: [
    { href: "https://www.linkedin.com/company/synergydatalabs/", icon: "mdi:linkedin", label: "LinkedIn" },
  ],
};

// 2026-10-07: Indian Beans — white-label tenant with its own apex,
// own brand palette (deep forest green + gold), own landing site
// served from /public/sites/indianbeans/. Picking the right chrome
// for indianbeans.com keeps auth pages (signin, signup, etc) visually
// continuous with the marketing site rather than defaulting to
// Oreugo or Synergy Data Labs branding.
const INDIANBEANS_CHROME: ShellChrome = {
  headerBg: "#17301F",     // deep forest green (--theme in landing CSS)
  footerBg: "#0F2317",     // even deeper green for footer contrast
  ctaBg: "#E0A526",        // gold accent (same as landing CTAs)
  formAccent: "#B8322A",   // --cherry from the landing CSS: their own .btn colour
  logoOnLight: "/sites/indianbeans/assets/logo.svg",
  logoOnDark: "/sites/indianbeans/assets/logo.svg",
  contactEmail: "hello@indianbeans.com",
  contactPhone: null,
  companyName: "Indian Beans",
  socials: [],
  // Indian Beans landing is multi-page (unlike Oreugo's one-page
  // scroll), so link to the actual pages served from
  // /public/sites/indianbeans/ via the middleware.
  navItems: [
    ["Features", "/features"],
    ["Solutions", "/solutions"],
    ["Integrations", "/integrations"],
    ["Pricing", "/pricing"],
    ["About", "/about"],
    ["Contact", "/contact"],
  ],
};

/**
 * Which tenant a hostname belongs to.
 *
 * The auth pages used to infer this by comparing their accent colour against
 * a constant - `primary === HUB_TEAL` stood in for "are we on hub". That
 * breaks the moment a third tenant exists, and it broke silently: Indian
 * Beans is neither hub nor Oreugo, so it inherited Oreugo's copy along with
 * Oreugo's orange. Ask for the variant instead of reading the paint.
 */
export type HostVariant = "oreugo" | "hub" | "indianbeans";

export function hostVariant(hostname: string): HostVariant {
  const h = hostname.toLowerCase();
  if (h === "indianbeans.com" || h === "www.indianbeans.com") return "indianbeans";
  if (
    h.includes("synergydatalabs") ||
    h === "itap.zashx.com" ||
    h === "localhost" ||
    h.startsWith("127.")
  ) {
    return "hub";
  }
  return "oreugo";
}

/** The accent an auth form should paint itself with on this host. */
export function formAccentForHost(hostname: string): string {
  return pickChromeForHost(hostname).formAccent;
}

const BRAND_FONT_STACK = "'Helvetica Now Display', Helvetica, Arial, sans-serif";

/**
 * Pick the chrome preset for the current host. iTap platform hosts
 * (itap.synergydatalabs.com, itap.zashx.com during migration) get iTap
 * chrome; everything else keeps Oreugo chrome so no partner domain
 * regresses.
 */
function pickChromeForHost(hostname: string): ShellChrome {
  const h = hostname.toLowerCase();
  // White-label tenants with their own apex get their own chrome preset
  // first — this branch has to come BEFORE the Synergy / Oreugo
  // fallback so each tenant keeps its brand.
  if (h === "indianbeans.com" || h === "www.indianbeans.com") {
    return INDIANBEANS_CHROME;
  }
  if (
    h.includes("synergydatalabs") ||
    h === "itap.zashx.com" ||
    h === "localhost" ||
    h.startsWith("127.")
  ) {
    return ITAP_CHROME;
  }
  return OREUGO_CHROME;
}

// Host detector for the top-level chrome switch. Any Synergy Data Labs
// subdomain — including the flagship `hub.synergydatalabs.com` platform host,
// the legacy `itap.synergydatalabs.com` staging, and the older
// `itap.zashx.com` migration domain — renders the datanova ItapShell
// (white pill nav + teal-gradient footer). Everything else — Oreugo and any
// inherited partner domain — falls through to the existing Oreugo chrome so
// no partner regresses.
//
// The exported name stays `isItapHost` for now — the file rename to
// "hub-shell" is deferred so we don't cascade import updates through
// every partner page in the same pass.
export function isItapHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  // Only true Synergy Data Labs / iTap hosts get the ItapShell
  // (datanova pill nav, "hub" wordmark, teal footer). White-label
  // tenants render through the Oreugo-style shell with their own
  // chrome preset applied — see pickChromeForHost.
  return (
    h.includes("synergydatalabs") ||   // hub.*, itap.*, www.*, apex, etc.
    h === "itap.zashx.com" ||
    h === "localhost" ||
    h.startsWith("127.")
  );
}

export default function PartnerSiteShell({ children }: { children: React.ReactNode }) {
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Host-level chrome switch. iTap platform hosts render the datanova-inspired
  // ItapShell (white pill nav + teal-gradient footer, ported from
  // C:\Mod App\SDL\datanova-1.0.0 so the auth pages are visually continuous
  // with the Synergy Data Labs marketing site). Everything else — Oreugo and
  // any inherited partner domain — falls through to the existing Oreugo
  // chrome below so no partner regresses.
  //
  // FLASH FIX (2026-09-08): the previous version defaulted to `false` +
  // OREUGO_CHROME during SSR and swapped to ItapShell in a useEffect after
  // mount. That produced a ~1-frame green flash on hub.synergydatalabs.com
  // between SSR paint (Oreugo green) and post-hydration re-render (Itap
  // indigo). Fixed by:
  //   1. Using useState initializers that read window.location.hostname
  //      synchronously during the first client render (hydration) — no
  //      useEffect swap needed.
  //   2. Defaulting the SSR pass to iTap since hub is the primary surface.
  //      Oreugo now has the reverse (indigo → green) transient trade-off,
  //      but Oreugo customers land directly on oreugo.ca and rarely see
  //      this shell fallback.
  const [isItap] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return isItapHost(window.location.hostname);
    }
    return true;
  });
  const [chrome] = useState<ShellChrome>(() => {
    if (typeof window !== "undefined") {
      return pickChromeForHost(window.location.hostname);
    }
    return ITAP_CHROME;
  });

  // Cookie consent (must be declared before the early return so hook order
  // stays stable across the iTap / Oreugo render branches).
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  useEffect(() => {
    const consent = localStorage.getItem("cookie_consent");
    if (!consent) setShowCookieBanner(true);
  }, []);
  const acceptCookies = () => {
    localStorage.setItem("cookie_consent", "accepted");
    setShowCookieBanner(false);
  };

  if (isItap) {
    return (
      <ItapShell loginHref={routes.login} signupHref={routes.signup}>
        {children}
      </ItapShell>
    );
  }

  const primary = chrome.ctaBg;
  const navy = TEMPLATE_DEFAULTS.navy;

  const logoForLight = chrome.logoOnLight;
  const logoForDark = chrome.logoOnDark;

  // Anchor links from auth pages can't actually scroll to landing sections
  // (different page), so wire them to /<routes.home>#anchor for landing
  // navigation, and to clean anchors when already on the landing.
  const anchorPrefix = routes.home === "/" ? "" : routes.home;

  return (
    <div className="min-h-screen flex flex-col bg-white" style={{ color: navy, fontFamily: BRAND_FONT_STACK }}>
      {/* =========================================================
          NAV — white, sticky, same items as landing
          PHASE 7b-fix3 (2026-05-18): inner container constrained to
          max-w-7xl mx-auto so the logo + CTA align with the form card
          below. Bigger Get Started button (px-8 py-3 text-base) to
          match the template's heft. Same change applied in landing
          partner/page.tsx — keep both in sync.
          ========================================================= */}
      <nav
        className="sticky top-0 z-50 backdrop-blur-sm border-b"
        style={{ backgroundColor: `${chrome.headerBg}F2`, borderColor: "rgba(255,255,255,0.08)" }}
      >
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
          <div className="flex items-center justify-between h-20 py-4">
            <Link href={routes.home} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoForLight}
                alt={displayName}
                className="h-10 sm:h-12 object-contain"
              />
            </Link>

            <div className="hidden md:flex items-center gap-10">
              {(chrome.navItems ?? [
                ["Features", `${anchorPrefix}#features`],
                ["Solutions", `${anchorPrefix}#solutions`],
                ["Hardware", `${anchorPrefix}#hardware`],
                ["Pricing", `${anchorPrefix}#pricing`],
                ["Contact", `${anchorPrefix}#contact`],
              ]).map(([label, href]) => (
                <Link
                  key={label}
                  href={href}
                  className="text-[15px] font-medium tracking-wide uppercase hover:opacity-80 transition-opacity text-white"
                >
                  {label}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-5">
              {/* PHASE 7b-fix10: Login flipped to white + bold + subtle
                  underline (matches the landing page treatment). */}
              <Link
                href={routes.login}
                className="hidden sm:inline-block text-base font-semibold tracking-wide text-white underline decoration-2 decoration-white/30 underline-offset-[6px] hover:decoration-white transition-all"
              >
                Login
              </Link>
              <Link
                href={routes.signup}
                className="leaf-button px-8 py-3 text-base font-semibold text-white hover:opacity-90 transition-opacity shadow-md"
                style={{ backgroundColor: chrome.ctaBg }}
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
            style={{ backgroundColor: chrome.headerBg, borderColor: "rgba(255,255,255,0.08)" }}
          >
            {[
              ...(chrome.navItems ?? [
                ["Features", `${anchorPrefix}#features`],
                ["Solutions", `${anchorPrefix}#solutions`],
                ["Hardware", `${anchorPrefix}#hardware`],
                ["Pricing", `${anchorPrefix}#pricing`],
                ["Contact", `${anchorPrefix}#contact`],
              ]),
              ["Login", routes.login],
              ["Sign Up", routes.signup],
            ].map(([label, href]) => (
              <Link
                key={label}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2 font-medium hover:opacity-80 text-white"
              >
                {label}
              </Link>
            ))}
          </div>
        )}
      </nav>

      {/* =========================================================
          PAGE BODY — white background; child renders centered form
          ========================================================= */}
      <div className="flex-1 bg-white">
        {children}
      </div>

      {/* =========================================================
          FOOTER — dark navy (matches landing footer)
          ========================================================= */}
      <footer style={{ backgroundColor: chrome.footerBg }}>
        <div className="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 py-14">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div>
              {/* PHASE 7b-fix9: -ml-2 + object-left so the wordmark aligns
                  with the caption + contact rows below it (same fix as in
                  partner/page.tsx footer). */}
              <div className="flex items-center mb-4 -ml-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoForDark} alt={displayName} className="h-10 object-contain object-left" />
              </div>
              <p className="text-sm text-gray-300 mb-4">{chrome.companyName}</p>
              <div className="space-y-2">
                <a
                  href={`mailto:${chrome.contactEmail}`}
                  className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
                >
                  <Icon icon="solar:letter-linear" className="w-4 h-4" />
                  {chrome.contactEmail}
                </a>
                {chrome.contactPhone && (
                  <a
                    href={`tel:${chrome.contactPhone.replace(/\D/g, "")}`}
                    className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
                  >
                    <Icon icon="solar:phone-linear" className="w-4 h-4" />
                    {chrome.contactPhone}
                  </a>
                )}
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "About Us", href: routes.isPartnerDomain ? "/about" : "/partner/about" },
                  { label: "Privacy Policy", href: routes.isPartnerDomain ? "/privacy" : "/partner/privacy" },
                  { label: "Terms & Conditions", href: routes.isPartnerDomain ? "/terms" : "/partner/terms" },
                  { label: "Cookie Policy", href: routes.isPartnerDomain ? "/cookies" : "/partner/cookies" },
                ].map((item) => (
                  <li key={item.label}>
                    <Link href={item.href} className="text-sm text-gray-300 hover:text-white transition-colors">{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Connect</h4>
              <div className="flex items-center gap-4">
                {chrome.socials.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <Icon icon={s.icon} className="w-6 h-6" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10">
          <div className="w-full px-6 sm:px-10 lg:px-16 py-6 text-center">
            <p className="text-sm text-gray-400">
              &copy; {chrome.companyName} {new Date().getFullYear()} &mdash; All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* =========================================================
          COOKIE BANNER — light variant
          ========================================================= */}
      {showCookieBanner && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-2xl">
          <div className="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 py-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <p className="text-sm leading-relaxed flex-1" style={{ color: navy }}>
                We use cookies to enhance your experience.{" "}
                <Link
                  href={routes.isPartnerDomain ? "/cookies" : "/partner/cookies"}
                  className="underline font-medium"
                  style={{ color: primary }}
                >
                  Cookie Policy
                </Link>
                .
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={acceptCookies}
                  className="leaf-button px-5 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: primary }}
                >
                  Accept All
                </button>
                <button
                  onClick={acceptCookies}
                  className="leaf-button px-5 py-2 text-sm font-semibold border-2 hover:bg-gray-50 transition-colors"
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
