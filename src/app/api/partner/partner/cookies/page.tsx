"use client";

import { useEffect } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";

export default function CookiePolicyPage() {
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const pc = branding.brandPrimaryColor;

  useEffect(() => {
    document.title = `Cookie Policy | ${displayName}`;
  }, [displayName]);

  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href={routes.home} className="flex items-center gap-3">
              {branding.brandLogoUrl ? (
                <img src={branding.brandLogoUrl} alt={displayName} className="h-10 sm:h-12" />
              ) : (
                <span className="text-xl font-bold text-white">{displayName}</span>
              )}
            </Link>
            <Link href={routes.home} className="text-sm text-gray-300 hover:text-white transition-colors flex items-center gap-1">
              <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
              Back to Home
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Cookie Policy</h1>
        <p className="text-sm text-gray-500 mb-12">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-gray max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. What Are Cookies</h2>
            <p className="text-gray-600 leading-relaxed">
              Cookies are small text files stored on your device when you visit a website. They help websites remember your preferences, keep you logged in, and understand how you interact with the site. {displayName} Technologies Inc. uses cookies and similar technologies to provide, protect, and improve our Services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Types of Cookies We Use</h2>

            <div className="bg-gray-50 rounded-xl p-6 mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Essential Cookies</h3>
              <p className="text-sm text-gray-500 mb-2">Required — Cannot be disabled</p>
              <p className="text-gray-600 text-sm leading-relaxed">
                These cookies are necessary for the Services to function. They enable core features like authentication, session management, and security. Without these cookies, the Services cannot operate properly.
              </p>
              <div className="mt-3 space-y-1">
                <p className="text-xs text-gray-500"><strong>partner_token</strong> — Authenticates your session (24-hour expiry)</p>
                <p className="text-xs text-gray-500"><strong>next-auth.session-token</strong> — Session management for authenticated users</p>
                <p className="text-xs text-gray-500"><strong>csrf-token</strong> — Prevents cross-site request forgery attacks</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-6 mb-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Functional Cookies</h3>
              <p className="text-sm text-gray-500 mb-2">Optional — Enhance your experience</p>
              <p className="text-gray-600 text-sm leading-relaxed">
                These cookies remember your preferences and choices to provide a more personalized experience, such as language settings, display preferences, and recently viewed items.
              </p>
            </div>

            <div className="bg-gray-50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Analytics Cookies</h3>
              <p className="text-sm text-gray-500 mb-2">Optional — Help us improve</p>
              <p className="text-gray-600 text-sm leading-relaxed">
                These cookies help us understand how visitors interact with our website by collecting and reporting information anonymously. This helps us improve our Services and user experience.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Third-Party Cookies</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              Some cookies are set by third-party services that appear on our pages. We use:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li><strong>Google reCAPTCHA</strong> — To protect forms from spam and abuse</li>
              <li><strong>Payment processors</strong> — To securely process card payments</li>
            </ul>
            <p className="text-gray-600 leading-relaxed mt-4">
              These third parties have their own privacy policies governing the use of cookies they set.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Managing Cookies</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              You can control cookies through your browser settings. Most browsers allow you to:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>View what cookies are stored and delete them individually</li>
              <li>Block third-party cookies</li>
              <li>Block cookies from specific sites</li>
              <li>Block all cookies</li>
              <li>Delete all cookies when you close your browser</li>
            </ul>
            <p className="text-gray-600 leading-relaxed mt-4">
              <strong>Note:</strong> Blocking essential cookies will prevent you from logging in and using the POS system. We recommend keeping essential cookies enabled for the best experience.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Cookie Retention</h2>
            <p className="text-gray-600 leading-relaxed">
              Session cookies are deleted when you close your browser. Persistent cookies remain on your device for a set period (typically 24 hours to 1 year, depending on the cookie) or until you delete them manually.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Updates to This Policy</h2>
            <p className="text-gray-600 leading-relaxed">
              We may update this Cookie Policy from time to time to reflect changes in technology, regulation, or our business practices. Changes will be posted on this page with an updated revision date.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Contact Us</h2>
            <p className="text-gray-600 leading-relaxed">If you have questions about our use of cookies, contact us:</p>
            <div className="mt-4 bg-gray-50 rounded-xl p-6">
              <p className="font-semibold text-gray-900">{displayName} Technologies Inc.</p>
              <p className="text-gray-600 mt-1">Email: <a href="mailto:info@oreugo.ca" className="hover:underline" style={{ color: pc }}>info@oreugo.ca</a></p>
              <p className="text-gray-600">Phone: <a href="tel:+12265000381" className="hover:underline" style={{ color: pc }}>226-500-0381</a></p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
