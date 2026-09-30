"use client";

import { useEffect } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";

export default function TermsPage() {
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const pc = branding.brandPrimaryColor;

  useEffect(() => {
    document.title = `Terms & Conditions | ${displayName}`;
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
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Terms & Conditions</h1>
        <p className="text-sm text-gray-500 mb-12">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-gray max-w-none space-y-8">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Agreement to Terms</h2>
            <p className="text-gray-600 leading-relaxed">
              By accessing or using the services provided by {displayName} Technologies Inc. (&quot;Company,&quot; &quot;we,&quot; &quot;us&quot;), including our point-of-sale software, hardware, payment processing, and website (collectively, the &quot;Services&quot;), you agree to be bound by these Terms & Conditions. If you do not agree, do not use the Services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Services Description</h2>
            <p className="text-gray-600 leading-relaxed mb-4">{displayName} provides:</p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li><strong>POS Software</strong> — Cloud-based point-of-sale system for order management, menu configuration, reporting, inventory tracking, and staff management</li>
              <li><strong>Payment Processing</strong> — Integrated card payment acceptance via third-party payment processors</li>
              <li><strong>POS Hardware</strong> — Terminals, displays, and peripherals available for purchase or monthly rental</li>
              <li><strong>Online Ordering</strong> — White-label digital ordering platform for pickup, delivery, and dine-in</li>
              <li><strong>Kitchen Display System</strong> — Digital order display for back-of-house operations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">3. Account Registration</h2>
            <p className="text-gray-600 leading-relaxed">
              To use certain Services, you must create an account. You agree to provide accurate, current, and complete information, keep your credentials confidential, and notify us immediately of any unauthorized access. You are responsible for all activity under your account.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Software License</h2>
            <p className="text-gray-600 leading-relaxed">
              We grant you a non-exclusive, non-transferable, revocable license to use our software for your internal business operations. The software is provided free of charge. You may not sublicense, reverse-engineer, decompile, or create derivative works of the software.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Hardware Terms</h2>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Purchase</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              Hardware purchased outright becomes your property upon full payment. A limited manufacturer warranty applies. We are not responsible for physical damage, water damage, or misuse.
            </p>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Monthly Rental</h3>
            <p className="text-gray-600 leading-relaxed">
              Rental hardware remains the property of {displayName} Technologies Inc. You must return equipment in good working condition upon termination. A replacement fee applies for lost, stolen, or damaged rental equipment. Rental fees are billed monthly in advance and are non-refundable.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Payment Processing</h2>
            <p className="text-gray-600 leading-relaxed mb-4">
              Payment processing is provided through third-party payment processors. By using our payment services, you also agree to the terms of the applicable payment processor. Processing fees are charged per transaction as outlined in your service agreement. Key terms:
            </p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Processing rates are set at the time of onboarding and may be adjusted with 30 days written notice</li>
              <li>Settlement times depend on your payment processor and banking institution</li>
              <li>Chargebacks and disputes are handled per the payment processor&apos;s policies</li>
              <li>You are responsible for PCI compliance at the point of interaction</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">7. Fees & Billing</h2>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li><strong>Software</strong> — Free, including updates and maintenance</li>
              <li><strong>Payment processing</strong> — Per-transaction fees as agreed in your merchant agreement</li>
              <li><strong>Hardware rental</strong> — Monthly fees as specified in your rental agreement</li>
              <li><strong>Hardware purchase</strong> — One-time payment at point of sale</li>
            </ul>
            <p className="text-gray-600 leading-relaxed mt-4">
              All fees are in Canadian Dollars (CAD) unless otherwise specified. Late payments may incur interest at 1.5% per month.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Acceptable Use</h2>
            <p className="text-gray-600 leading-relaxed mb-4">You agree not to:</p>
            <ul className="list-disc pl-6 text-gray-600 space-y-2">
              <li>Use the Services for any unlawful purpose</li>
              <li>Interfere with or disrupt the Services or servers</li>
              <li>Attempt to gain unauthorized access to any part of the Services</li>
              <li>Use the Services to process transactions for prohibited business types</li>
              <li>Resell or redistribute the Services without written consent</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Data Ownership</h2>
            <p className="text-gray-600 leading-relaxed">
              You retain ownership of all business data you input into the system (menu items, transactions, customer information, etc.). We claim no ownership of your data. You may export your data at any time. Upon account termination, we will retain your data for 90 days before deletion, unless a longer period is required by law.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Service Availability</h2>
            <p className="text-gray-600 leading-relaxed">
              We strive for 99.9% uptime but do not guarantee uninterrupted service. We are not liable for downtime due to scheduled maintenance (with 24-hour advance notice), internet outages, force majeure events, or third-party service failures. Our POS includes offline mode capabilities for continued operation during brief connectivity interruptions.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Limitation of Liability</h2>
            <p className="text-gray-600 leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, {displayName.toUpperCase()} TECHNOLOGIES INC. SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR BUSINESS OPPORTUNITIES. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY YOU IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">12. Indemnification</h2>
            <p className="text-gray-600 leading-relaxed">
              You agree to indemnify and hold harmless {displayName} Technologies Inc. from any claims, damages, or expenses arising from your use of the Services, your violation of these Terms, or your violation of any third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">13. Termination</h2>
            <p className="text-gray-600 leading-relaxed">
              Either party may terminate the service at any time with 30 days written notice. We may suspend or terminate your access immediately if you breach these Terms. Upon termination, rental hardware must be returned within 14 days. Software access will cease at the end of the notice period.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">14. Governing Law</h2>
            <p className="text-gray-600 leading-relaxed">
              These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada applicable therein. Any disputes shall be resolved in the courts of Ontario, Canada.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">15. Changes to Terms</h2>
            <p className="text-gray-600 leading-relaxed">
              We reserve the right to modify these Terms at any time. Material changes will be communicated via email or through the Services with at least 30 days notice. Continued use after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">16. Contact</h2>
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
