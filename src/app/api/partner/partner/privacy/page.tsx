"use client";

import { useEffect } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";

export default function PrivacyPolicyPage() {
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const pc = branding.brandPrimaryColor;

  useEffect(() => {
    document.title = `Privacy Policy | ${displayName}`;
  }, [displayName]);

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
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
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-12">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-gray max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Introduction</h2>
            <p className="text-gray-600 leading-relaxed">
              {displayName} Technologies Inc. (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our point-of-sale software, website, and related services (collectively, the &quot;Services&quot;).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Information We Collect</h2>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Personal Information</h3>
            <p className="text-gray-600 leading-relaxed mb-4">When you register for an account or use our Services, we may collect:</p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Name, email address, phone number, and business name</li>
              <li>Business address and tax identification numbers</li>
              <li>Payment information (processed securely by our payment partners)</li>
              <li>Employee information you enter into the system (names, roles, schedules)</li>
              <li>Login credentials (passwords are stored in hashed, non-reversible form)</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-900 mb-2 mt-6">Transaction Data</h3>
            <p className="text-gray-600 leading-relaxed mb-4">Through normal use of our POS system, we process:</p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Sales transactions, order details, and payment records</li>
              <li>Inventory data, menu items, and pricing</li>
              <li>Customer order history (for businesses using our online ordering)</li>
            </ul>

            <h3 className="text-lg font-semibold text-gray-900 mb-2 mt-6">Automatically Collected Data</h3>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Device information (browser type, operating system)</li>
              <li>IP address and approximate location</li>
              <li>Usage analytics (pages visited, features used)</li>
              <li>Cookies and similar tracking technologies</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>To provide, maintain, and improve our Services</li>
              <li>To process transactions and send related information</li>
              <li>To send administrative messages, updates, and security alerts</li>
              <li>To respond to your inquiries and provide customer support</li>
              <li>To monitor usage patterns and improve user experience</li>
              <li>To detect, prevent, and address fraud or technical issues</li>
              <li>To comply with legal obligations and enforce our terms</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Data Sharing & Disclosure</h2>
            <p className="text-gray-600 leading-relaxed mb-4">We do not sell your personal information. We may share data with:</p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li><strong>Payment processors</strong> — to facilitate card transactions (they are PCI-DSS compliant)</li>
              <li><strong>Cloud infrastructure providers</strong> — to host and operate our Services (AWS)</li>
              <li><strong>Legal authorities</strong> — when required by law, subpoena, or court order</li>
              <li><strong>Business transfers</strong> — in connection with a merger, acquisition, or sale of assets</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Data Security</h2>
            <p className="text-gray-600 leading-relaxed">
              We implement industry-standard security measures including encryption in transit (TLS), encryption at rest, access controls, and regular security audits. Payment card data is never stored on our servers — it is processed directly by PCI-DSS certified payment processors.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Data Retention</h2>
            <p className="text-gray-600 leading-relaxed">
              We retain your data for as long as your account is active or as needed to provide Services. Transaction records are retained for a minimum of 7 years for tax and regulatory compliance. You may request deletion of your account and personal data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Your Rights</h2>
            <p className="text-gray-600 leading-relaxed mb-4">Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Access and receive a copy of your personal data</li>
              <li>Correct inaccurate or incomplete personal data</li>
              <li>Request deletion of your personal data</li>
              <li>Object to or restrict processing of your data</li>
              <li>Data portability (receive your data in a structured format)</li>
              <li>Withdraw consent at any time</li>
            </ul>
            <p className="text-gray-600 leading-relaxed mt-4">
              To exercise any of these rights, contact us at <a href="mailto:info@oreugo.ca" className="font-medium hover:underline" style={{ color: pc }}>info@oreugo.ca</a>.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Cookies</h2>
            <p className="text-gray-600 leading-relaxed">
              We use cookies and similar technologies to maintain sessions, remember preferences, and analyze usage. For details, please see our{" "}
              <Link href={routes.isPartnerDomain ? "/cookies" : "/partner/cookies"} className="font-medium hover:underline" style={{ color: pc }}>Cookie Policy</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Children&apos;s Privacy</h2>
            <p className="text-gray-600 leading-relaxed">
              Our Services are not directed to individuals under 18. We do not knowingly collect personal information from children. If we become aware that we have collected data from a child, we will take steps to delete it promptly.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Changes to This Policy</h2>
            <p className="text-gray-600 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on our website and updating the &quot;Last updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Contact Us</h2>
            <p className="text-gray-600 leading-relaxed">
              If you have questions about this Privacy Policy or our data practices, contact us at:
            </p>
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
