"use client";

// ============================================================================
// ItapShell — chrome for the hub product surface (hub.synergydatalabs.com
// and any Synergy Data Labs subdomain served by tap-app).
//
// UNIFIED NAV (2026-09-08):
//   Rewritten to render the same nav as the SDL landing site at
//   synergydatalabs.com (Astro/Amplify — source at
//   C:\Mod App\SDL\datanova-1.0.0\src\components\sections\Navbar.astro).
//   A visitor crossing from the marketing site to the hub subdomain now
//   sees identical brand, items, colours and layout — the two surfaces
//   read as one product. The ONLY intentional difference is the primary
//   CTA: landing shows "Book a demo" (marketing context), hub shows
//   "Get started" (product context).
//
// Spec:
//   • Brand   — "Synergy Data Labs" wordmark. Indigo "Synergy" (weight 800)
//               + slate "Data Labs" (weight 500), tight tracking.
//   • Items   — Home / Solutions↓ (Banking Infrastructure, POS System) /
//               Hub / About / Contact. All cross-domain to synergydatalabs.com.
//   • CTAs    — "Sign in" (ghost) + "Get started" (solid indigo). Both
//               deep-link into local /partner/login and /partner/signup
//               on the hub host.
//   • Colours — Meridian tokens (#3A3EBF indigo, white ground, slate inks).
//   • Height  — 76px desktop, 64px mobile. Sticky, opaque, thin bottom
//               border. No floating pill.
//   • Footer  — same "Synergy Data Labs" lockup, subtle indigo-tinted
//               gradient, three-column links.
// ============================================================================

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

// Meridian palette — mirror of --m-* CSS vars on the landing site so
// the two chrome surfaces render the same colours pixel-for-pixel.
const M_ACCENT = "#3A3EBF";
const M_ACCENT_HOVER = "#2B2F99";
const M_INK = "#0B1220";
const M_INK_2 = "#2D3547";
const M_INK_3 = "#5A6479";
const M_HAIRLINE = "#E1E4EE";
const M_HAIRLINE_2 = "#EEF0F6";
const M_GROUND_2 = "#F4F5F9";

// Landing site origin. Overridable via env for local dev; defaults to
// the production apex. Home / Solutions items / About / Contact all
// route here since those pages don't exist on the hub subdomain.
const MARKETING_ORIGIN =
  process.env.NEXT_PUBLIC_MARKETING_URL || "https://synergydatalabs.com";
function marketingUrl(path: string): string {
  return `${MARKETING_ORIGIN.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

interface ItapShellProps {
  children: React.ReactNode;
  loginHref: string;
  signupHref: string;
}

// Brand wordmark — inline component so it's identical in header + footer.
// Renders "Synergy" in indigo bold + "Data Labs" in slate medium, joined
// by a non-breaking space so browsers never wrap it mid-lockup.
function BrandWordmark({ size = "lg" }: { size?: "lg" | "sm" }) {
  const fontSize = size === "lg" ? "23px" : "19px";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "0.15rem",
        fontFamily:
          "'Inter Tight', 'Plus Jakarta Sans', Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        fontWeight: 800,
        fontSize,
        letterSpacing: "-0.04em",
        color: M_INK,
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}
    >
      Synergy
      <span
        style={{
          fontWeight: 500,
          color: M_INK_3,
          letterSpacing: "-0.03em",
        }}
      >
        &nbsp;Data&nbsp;Labs
      </span>
    </span>
  );
}

export default function ItapShell({ children, loginHref, signupHref }: ItapShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const pathname = usePathname();
  // Don't render a "Sign in" link when the visitor IS on a sign-in page —
  // a nav item that leads back to the current page is a dead-end trap.
  const onLoginPage =
    !!pathname && /^\/(signin|partner\/login)(\/|$)/.test(pathname);

  // Solutions dropdown click-away
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("#itap-solutions-dropdown")) setSolutionsOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Scroll-linked shadow: matches the [data-scrolled] behaviour on the
  // landing nav — nav gets a soft shadow once the page has scrolled past
  // 8px so it visually detaches from content behind it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change so it doesn't stay open across nav.
  useEffect(() => {
    setMobileOpen(false);
    setSolutionsOpen(false);
  }, [pathname]);

  const navShadow = scrolled
    ? "0 8px 20px -18px rgba(11,18,32,0.35)"
    : "none";

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#FFFFFF", color: M_INK }}
    >
      {/* =========================================================
          NAV — flat sticky bar (Meridian). Identical to
          synergydatalabs.com so the hub subdomain reads as the
          same product wearing a work uniform.
          ========================================================= */}
      <header
        className="sticky top-0 z-50 w-full"
        style={{
          background: "#FFFFFF",
          borderBottom: `1px solid ${M_HAIRLINE_2}`,
          boxShadow: navShadow,
          transition: "box-shadow .18s ease, border-color .18s ease",
        }}
      >
        <div
          className="mx-auto flex items-center gap-4 px-4 sm:px-6 lg:px-8"
          style={{ maxWidth: "1280px", height: "76px", minWidth: 0 }}
        >
          {/* Wordmark → landing home. Cross-domain so use <a>. */}
          <a
            href={marketingUrl("/")}
            aria-label="Synergy Data Labs"
            translate="no"
            className="flex-none focus:outline-none"
            style={{ textDecoration: "none" }}
          >
            <BrandWordmark size="lg" />
          </a>

          {/* Desktop nav links */}
          <nav
            className="hidden xl:flex items-center"
            aria-label="Primary"
            style={{ gap: "2rem", marginLeft: "2rem" }}
          >
            <a
              href={marketingUrl("/")}
              className="hover:opacity-100"
              style={navLinkStyle}
            >
              Home
            </a>

            <div id="itap-solutions-dropdown" className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSolutionsOpen((v) => !v);
                }}
                aria-haspopup="menu"
                aria-expanded={solutionsOpen}
                style={{
                  ...navLinkStyle,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                }}
              >
                Solutions
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {solutionsOpen && (
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    left: 0,
                    minWidth: "220px",
                    background: "#FFFFFF",
                    border: `1px solid ${M_HAIRLINE}`,
                    borderRadius: "12px",
                    padding: "0.4rem",
                    boxShadow: "0 24px 60px -32px rgba(11,18,32,0.25)",
                    zIndex: 60,
                  }}
                >
                  <a href={marketingUrl("/banking-infrastructure")} role="menuitem" style={dropdownItemStyle}>
                    Banking Infrastructure
                  </a>
                  <a href={marketingUrl("/pos-system")} role="menuitem" style={dropdownItemStyle}>
                    POS System
                  </a>
                </div>
              )}
            </div>

            <a href={marketingUrl("/hub")} style={navLinkStyle}>
              Hub
            </a>
            <a href={marketingUrl("/about")} style={navLinkStyle}>
              About
            </a>
            <a href={marketingUrl("/contact")} style={navLinkStyle}>
              Contact
            </a>
          </nav>

          {/* Desktop CTAs — pushed to the right */}
          <div className="hidden xl:flex items-center" style={{ marginLeft: "auto", gap: "0.5rem" }}>
            {!onLoginPage && (
              <Link href={loginHref} style={ghostBtnStyle}>
                Sign in
              </Link>
            )}
            <Link
              href={signupHref}
              style={solidBtnStyle}
              onMouseOver={(e) => (e.currentTarget.style.background = M_ACCENT_HOVER)}
              onMouseOut={(e) => (e.currentTarget.style.background = M_ACCENT)}
            >
              Get started
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>

          {/* Mobile hamburger + condensed CTA */}
          <div className="flex xl:hidden items-center gap-2" style={{ marginLeft: "auto" }}>
            <Link
              href={signupHref}
              style={{
                ...solidBtnStyle,
                padding: "0.45rem 0.85rem",
                fontSize: "13px",
              }}
            >
              Get started
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-label="Toggle navigation"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                border: `1px solid ${M_HAIRLINE}`,
                background: "#FFFFFF",
                borderRadius: 8,
                color: M_INK,
                cursor: "pointer",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {mobileOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" x2="21" y1="6" y2="6" />
                    <line x1="3" x2="21" y1="12" y2="12" />
                    <line x1="3" x2="21" y1="18" y2="18" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu — flat panel below nav bar */}
        {mobileOpen && (
          <div
            className="xl:hidden"
            style={{
              background: "#FFFFFF",
              borderTop: `1px solid ${M_HAIRLINE_2}`,
              borderBottom: `1px solid ${M_HAIRLINE_2}`,
              padding: "0.5rem clamp(1rem, 4vw, 2rem) 1rem",
            }}
          >
            <div className="flex flex-col" style={{ gap: "0.25rem" }}>
              <a href={marketingUrl("/")} style={mobileLinkStyle}>Home</a>
              <a href={marketingUrl("/banking-infrastructure")} style={{ ...mobileLinkStyle, paddingLeft: "1.25rem" }}>Banking Infrastructure</a>
              <a href={marketingUrl("/pos-system")} style={{ ...mobileLinkStyle, paddingLeft: "1.25rem" }}>POS System</a>
              <a href={marketingUrl("/hub")} style={mobileLinkStyle}>Hub</a>
              <a href={marketingUrl("/about")} style={mobileLinkStyle}>About</a>
              <a href={marketingUrl("/contact")} style={mobileLinkStyle}>Contact</a>
              <div style={{ height: 1, background: M_HAIRLINE_2, margin: "0.5rem 0" }} />
              {!onLoginPage && (
                <Link href={loginHref} style={mobileLinkStyle}>Sign in</Link>
              )}
              <Link href={signupHref} style={{ ...mobileLinkStyle, color: M_ACCENT, fontWeight: 600 }}>
                Get started →
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* =========================================================
          BODY — child pages render here
          ========================================================= */}
      <main className="flex-1" style={{ background: "#FFFFFF" }}>{children}</main>

      {/* =========================================================
          FOOTER — matches landing footer: soft indigo-tinted
          gradient, "Synergy Data Labs" wordmark, three-column links.
          ========================================================= */}
      <footer
        className="mt-auto w-full pb-10"
        style={{
          background: `linear-gradient(to top, ${M_GROUND_2} 0%, transparent 60%, #FFFFFF 100%)`,
        }}
      >
        <div className="mx-auto mt-auto w-full px-4 pb-10 pt-16 sm:px-6 lg:px-8" style={{ maxWidth: "1360px" }}>
          <hr className="mb-10" style={{ borderColor: M_HAIRLINE_2 }} />

          <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
            <div className="col-span-full self-center xl:col-span-2">
              <a
                href={marketingUrl("/")}
                className="focus:outline-none inline-flex"
                aria-label="Synergy Data Labs"
                style={{ textDecoration: "none" }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: "0.15rem",
                    fontFamily:
                      "'Inter Tight', 'Plus Jakarta Sans', Inter, system-ui, sans-serif",
                    fontWeight: 800,
                    fontSize: "30px",
                    letterSpacing: "-0.04em",
                    color: M_INK,
                    lineHeight: 1,
                  }}
                >
                  Synergy
                  <span style={{ fontWeight: 500, color: M_INK_3, letterSpacing: "-0.03em" }}>
                    &nbsp;Data&nbsp;Labs
                  </span>
                </span>
              </a>
              <p className="mt-5 text-pretty lg:w-5/12 xl:w-10/12" style={{ color: M_INK_2 }}>
                Canadian-built software infrastructure for modern financial
                services. AI, technology, and fintech, designed, developed, and
                supported entirely from Canada.
              </p>
            </div>

            <div className="col-span-1">
              <h3 className="font-semibold" style={{ color: M_INK_2 }}>Solutions</h3>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <a href={marketingUrl("/banking-infrastructure")} style={footerLinkStyle}>
                    Banking Infrastructure
                  </a>
                </li>
                <li>
                  <a href={marketingUrl("/pos-system")} style={footerLinkStyle}>
                    POS System
                  </a>
                </li>
                <li>
                  <a href={marketingUrl("/hub")} style={footerLinkStyle}>
                    Hub
                  </a>
                </li>
              </ul>
              <h3 className="mt-6 font-semibold" style={{ color: M_INK_2 }}>Company</h3>
              <ul className="mt-3 space-y-2 text-sm">
                <li><a href={marketingUrl("/about")} style={footerLinkStyle}>About</a></li>
                <li><a href={marketingUrl("/contact")} style={footerLinkStyle}>Contact</a></li>
              </ul>
            </div>

            <div className="col-span-1 md:col-span-2">
              <h3 className="font-semibold" style={{ color: M_INK_2 }}>Get in touch</h3>
              <ul className="mt-3 space-y-2 text-sm" style={{ color: M_INK_2 }}>
                <li>
                  <a href="tel:+19423887000" style={footerLinkStyle}>+1 (942) 388-7000</a>
                </li>
                <li>
                  <a href="mailto:info@synergydatalabs.com" style={footerLinkStyle}>
                    info@synergydatalabs.com
                  </a>
                </li>
                <li>
                  <a
                    href="https://synergydatalabs.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={footerLinkStyle}
                  >
                    synergydatalabs.com
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <hr className="mt-10 mb-5" style={{ borderColor: M_HAIRLINE_2 }} />

          <div className="grid gap-y-2 sm:flex sm:items-center sm:justify-between sm:gap-y-0">
            <p className="text-sm" style={{ color: M_INK_3 }}>
              &copy; {new Date().getFullYear()} Synergy Data Labs. All rights
              reserved.
            </p>
            <p className="text-sm" style={{ color: M_INK_3 }}>
              A Canadian company. Built with pride in Canada.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style tokens — kept as objects so the CTA and dropdown items don't need
// their own utility classes. All colours mirror the --m-* CSS vars on
// the landing site.
// ---------------------------------------------------------------------------

const navLinkStyle: React.CSSProperties = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontWeight: 500,
  fontSize: "15px",
  color: M_INK_2,
  textDecoration: "none",
  padding: "0.4rem 0",
  borderBottom: "1px solid transparent",
  transition: "color .15s, border-color .15s",
  cursor: "pointer",
};

const dropdownItemStyle: React.CSSProperties = {
  display: "block",
  padding: "0.55rem 0.75rem",
  borderRadius: 8,
  fontSize: 14,
  color: M_INK_2,
  textDecoration: "none",
};

const ghostBtnStyle: React.CSSProperties = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontWeight: 500,
  fontSize: "14px",
  color: M_INK_2,
  background: "transparent",
  padding: "0.5rem 0.85rem",
  borderRadius: 10,
  textDecoration: "none",
  transition: "background .15s, color .15s",
};

const solidBtnStyle: React.CSSProperties = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontWeight: 600,
  fontSize: "14px",
  color: "#FFFFFF",
  background: M_ACCENT,
  padding: "0.55rem 1.1rem",
  borderRadius: 10,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  boxShadow: "0 6px 20px -12px rgba(58,62,191,0.6)",
  transition: "background .15s, transform .15s",
};

const mobileLinkStyle: React.CSSProperties = {
  fontFamily: "Inter, system-ui, sans-serif",
  fontWeight: 500,
  fontSize: "15px",
  color: M_INK_2,
  textDecoration: "none",
  padding: "0.65rem 0.5rem",
  borderRadius: 8,
};

const footerLinkStyle: React.CSSProperties = {
  color: M_INK_2,
  textDecoration: "none",
  transition: "color .15s",
};
