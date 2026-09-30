"use client";

import { useEffect } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";

export default function AboutPage() {
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const pc = branding.brandPrimaryColor;
  const ac = branding.brandAccentColor;

  useEffect(() => {
    document.title = `About Us | ${displayName}`;
  }, [displayName]);

  const differentiators = [
    {
      icon: "solar:monitor-smartphone-bold-duotone",
      title: "One smart device does it all",
      description: "Seamlessly handle inventory, suppliers, scheduling, and accounting from a single piece of hardware.",
    },
    {
      icon: "solar:tag-price-bold-duotone",
      title: "No subscription fees ever",
      description: "Enjoy full access without recurring monthly costs. Our software is free — forever.",
    },
    {
      icon: "solar:settings-bold-duotone",
      title: "Fully self-customizable",
      description: "Tailor the system exactly to fit your unique business needs — your way, your rules.",
    },
    {
      icon: "solar:headphones-round-sound-bold-duotone",
      title: "24/7 dedicated support",
      description: "Real, friendly help is always available whenever you need it — day or night.",
    },
    {
      icon: "solar:wallet-money-bold-duotone",
      title: "Save money and make more",
      description: "Cut wasteful costs and boost your profits with better control and smarter insights.",
    },
    {
      icon: "solar:shield-check-bold-duotone",
      title: "Powered by Global Payments",
      description: "Fast, secure, and reliable payment processing through one of the world's leading payment providers.",
    },
  ];

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
            <div className="flex items-center gap-6">
              <Link href={routes.home} className="text-sm text-gray-300 hover:text-white transition-colors flex items-center gap-1">
                <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
                Home
              </Link>
              <Link href={routes.signup} className="px-5 py-2 rounded-full text-sm font-semibold text-gray-900 hover:opacity-90 transition-colors" style={{ backgroundColor: pc }}>
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative bg-gray-900 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900" />
        <div className="absolute top-0 right-0 w-1/2 h-full" style={{ background: `linear-gradient(to left, ${pc}1A, transparent)` }} />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="font-medium mb-4 text-sm tracking-wide uppercase" style={{ color: pc }}>About Us</p>
              <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-6">
                Welcome to <span style={{ color: pc }}>{displayName}</span> Technology Inc.
              </h1>
              <p className="text-lg text-gray-400 leading-relaxed">
                We&apos;re a fresh, innovative POS technology company that has just launched across Canada.
                Our mission is simple: Help you run your business more easily — and more profitably.
              </p>
            </div>
            <div className="hidden lg:block">
              <img
                src="/images/home/b9x79.jpg"
                alt={`${displayName} POS Terminal`}
                className="rounded-2xl shadow-2xl w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="py-20 sm:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
              A smart all-in-one POS system
            </h2>
            <p className="text-lg text-gray-500 leading-relaxed max-w-3xl mx-auto">
              At {displayName}, we&apos;ve built a smart all-in-one POS system that goes far beyond just taking payments.
              Everything your business needs fits into one powerful hardware device — inventory management,
              supplier management, staff scheduling, and accounting — all in one place. No extra software,
              no complicated setups, and no multiple systems to juggle.
            </p>
          </div>
        </div>
      </section>

      {/* Why We Built */}
      <section className="py-20 sm:py-28 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-sm font-semibold tracking-wider uppercase mb-3" style={{ color: ac }}>OUR STORY</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
              Why We Built {displayName}
            </h2>
          </div>
          <div className="bg-white rounded-3xl p-8 sm:p-12 shadow-sm border border-gray-100">
            <p className="text-gray-600 leading-relaxed text-lg mb-6">
              We know how frustrating traditional POS systems can be — expensive monthly subscriptions,
              confusing features, and tools that feel more like a burden than a help.
            </p>
            <p className="text-gray-600 leading-relaxed text-lg mb-6">
              That&apos;s why we took a different approach.
            </p>
            <p className="text-gray-600 leading-relaxed text-lg">
              We proudly partnered with <strong>Global Payments</strong>, one of the world&apos;s leading payment providers,
              to deliver fast, secure, and reliable payment processing. Combined with our powerful built-in
              business tools, we&apos;ve created a complete solution that is simple, affordable, and truly user-friendly.
            </p>
          </div>
        </div>
      </section>

      {/* What Makes Us Different */}
      <section className="py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold tracking-wider uppercase mb-3" style={{ color: ac }}>WHY CHOOSE US</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
              What Makes {displayName} Different
            </h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {differentiators.map((item) => (
              <div key={item.title} className="bg-gray-50 rounded-2xl p-8 hover:shadow-lg transition-all">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ backgroundColor: `${pc}1A` }}>
                  <Icon icon={item.icon} className="w-7 h-7" style={{ color: ac }} />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{item.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Our Promise */}
      <section className="py-20 sm:py-28 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">Our Promise</h2>
          <p className="text-lg text-gray-500 leading-relaxed mb-6">
            We believe small and medium-sized businesses deserve modern, powerful tools without the
            high costs or headaches. Whether you run a restaurant, retail store, cafe, or any other business,
            {displayName} is designed to simplify your daily operations.
          </p>
          <p className="text-lg text-gray-500 leading-relaxed mb-6">
            We focus on what truly matters: giving you a reliable, easy-to-use system that works for you — not the other way around.
            A system that saves you time, reduces mistakes, and helps your business grow every single day.
          </p>
          <p className="text-lg text-gray-700 font-medium">
            Thank you for considering {displayName} Technology Inc. as your business partner.
            We&apos;re genuinely excited to help Canadian businesses like yours succeed with smarter, simpler technology.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20" style={{ backgroundColor: pc }}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Ready to make running your business easier?
          </h2>
          <p className="text-lg text-gray-700 mb-8">
            Get in touch with us today or explore our solutions.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href={routes.signup}
              className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-semibold bg-gray-900 text-white hover:bg-gray-800 transition-colors"
            >
              Get Started Free
              <Icon icon="solar:arrow-right-linear" className="w-5 h-5 ml-2" />
            </Link>
            <a
              href={routes.isPartnerDomain ? "/#contact" : "/partner#contact"}
              className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-semibold border-2 border-gray-900 text-gray-900 hover:bg-gray-900/10 transition-colors"
            >
              Contact Sales
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              &copy; {displayName} Technologies Inc. {new Date().getFullYear()} &mdash; All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              <a href={routes.isPartnerDomain ? "/privacy" : "/partner/privacy"} className="text-sm text-gray-400 hover:text-white transition-colors">Privacy</a>
              <a href={routes.isPartnerDomain ? "/terms" : "/partner/terms"} className="text-sm text-gray-400 hover:text-white transition-colors">Terms</a>
              <a href={routes.isPartnerDomain ? "/cookies" : "/partner/cookies"} className="text-sm text-gray-400 hover:text-white transition-colors">Cookies</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
