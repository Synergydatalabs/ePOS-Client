"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { usePartnerRoutes } from "@/lib/use-partner-routes";
import { usePartnerBranding } from "@/lib/use-partner-branding";

export default function PartnerLandingPage() {
  const routes = usePartnerRoutes();
  const { branding, displayName } = usePartnerBranding();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pc = branding.brandPrimaryColor;
  const ac = branding.brandAccentColor;

  // Dynamic page title
  useEffect(() => {
    document.title = `${displayName} | Point of Sale Solutions`;
    // Dynamic favicon
    if (branding.brandFaviconUrl) {
      const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
      if (link) link.href = branding.brandFaviconUrl;
    }
  }, [displayName, branding.brandFaviconUrl]);

  // Contact form state
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
      const res = await fetch("/api/partner/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
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

  const features = [
    {
      tag: "MANAGE ORDERS EASILY",
      title: "POS Software",
      description:
        "Quick Service, Table Service, Pickup, Delivery & Takeaway — manage every order type from a single, intuitive interface.",
      icon: "solar:monitor-smartphone-bold-duotone",
    },
    {
      tag: "IN HOUSE",
      title: "Online Ordering",
      description:
        "Consolidate your mobile orders directly into your POS. No third-party fees, no commission cuts — keep more of your revenue.",
      icon: "solar:smartphone-bold-duotone",
    },
    {
      tag: "SEAMLESS",
      title: "Tableside Ordering",
      description:
        "QR code ordering lets guests browse, order, and pay right from their table — reducing wait times and boosting table turnover.",
      icon: "solar:qr-code-bold-duotone",
    },
    {
      tag: "INTEGRATED",
      title: "Payment Processing",
      description:
        "Accept all payment types — tap, chip, swipe, Apple Pay, Google Pay — with the lowest processing rates in the industry.",
      icon: "solar:card-recive-bold-duotone",
    },
    {
      tag: "FULL CONTROL",
      title: "Inventory & Supply Chain",
      description:
        "Track stock levels in real time, set low-stock alerts, manage suppliers, and automate purchase orders — never run out of key ingredients.",
      icon: "solar:box-bold-duotone",
    },
    {
      tag: "REAL-TIME INSIGHTS",
      title: "Analytics & Reporting",
      description:
        "Live dashboards for sales, labour costs, product mix, and peak hours. Export reports, compare locations, and make data-driven decisions.",
      icon: "solar:chart-2-bold-duotone",
    },
    {
      tag: "BACK OF HOUSE",
      title: "Kitchen Display System",
      description:
        "Replace paper tickets with a digital kitchen display. Orders flow instantly from POS to kitchen with priority routing and prep timers.",
      icon: "solar:chef-hat-bold-duotone",
    },
    {
      tag: "GROW YOUR TEAM",
      title: "Staff Management",
      description:
        "Role-based permissions, time tracking, shift scheduling, and performance reports — manage your entire team from one dashboard.",
      icon: "solar:users-group-rounded-bold-duotone",
    },
  ];

  const stats = [
    { value: "500+", label: "Restaurants" },
    { value: "99.9%", label: "Uptime" },
    { value: "24/7", label: "Support" },
    { value: "2 min", label: "Setup" },
  ];

  const inputFocusStyle = { "--tw-ring-color": pc } as React.CSSProperties;

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
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

            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm text-gray-300 hover:text-white transition-colors">Features</a>
              <a href="#solutions" className="text-sm text-gray-300 hover:text-white transition-colors">Solutions</a>
              <a href="#hardware" className="text-sm text-gray-300 hover:text-white transition-colors">Hardware</a>
              <a href="#pricing" className="text-sm text-gray-300 hover:text-white transition-colors">Pricing</a>
              <a href="#contact" className="text-sm text-gray-300 hover:text-white transition-colors">Contact</a>
            </div>

            <div className="flex items-center gap-3">
              <Link href={routes.login} className="text-sm font-medium text-gray-300 hover:text-white transition-colors hidden sm:block">Login</Link>
              <Link href={routes.signup} className="px-5 py-2 rounded-full text-sm font-semibold text-gray-900 hover:opacity-90 transition-colors" style={{ backgroundColor: pc }}>Get Started</Link>
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 text-gray-300">
                <Icon icon={mobileMenuOpen ? "solar:close-circle-linear" : "solar:hamburger-menu-linear"} className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden bg-gray-900 border-t border-gray-800 px-4 py-4 space-y-3">
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block text-gray-300 hover:text-white py-2">Features</a>
            <a href="#solutions" onClick={() => setMobileMenuOpen(false)} className="block text-gray-300 hover:text-white py-2">Solutions</a>
            <a href="#hardware" onClick={() => setMobileMenuOpen(false)} className="block text-gray-300 hover:text-white py-2">Hardware</a>
            <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-gray-300 hover:text-white py-2">Pricing</a>
            <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="block text-gray-300 hover:text-white py-2">Contact</a>
            <Link href={routes.login} className="block text-gray-300 hover:text-white py-2">Login</Link>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative bg-gray-900 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900" />
        <div className="absolute top-0 right-0 w-1/2 h-full" style={{ background: `linear-gradient(to left, ${pc}1A, transparent)` }} />
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full blur-3xl" style={{ backgroundColor: `${pc}0D` }} />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="font-medium mb-4 text-sm tracking-wide uppercase" style={{ color: pc }}>
                A trusted POS solution for hospitality businesses
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
                Empower your business with{" "}
                <span style={{ color: pc }}>{displayName}.</span>
              </h1>
              <p className="text-lg sm:text-xl text-gray-400 mb-10 max-w-xl">
                The all-in-one point of sale system built for restaurants, cafes, and quick service.
                Manage orders, payments, and your team — all from one platform.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href={routes.signup}
                  className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-semibold text-gray-900 hover:opacity-90 transition-all"
                  style={{ backgroundColor: pc, boxShadow: `0 10px 25px -5px ${pc}33` }}
                >
                  Get Started Free
                  <Icon icon="solar:arrow-right-linear" className="w-5 h-5 ml-2" />
                </Link>
                <a
                  href="#contact"
                  className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-semibold border border-gray-600 text-white hover:bg-gray-800 transition-colors"
                >
                  Contact Sales
                </a>
              </div>
            </div>
            <div className="hidden lg:flex justify-center">
              <div className="relative">
                <div className="absolute -inset-4 rounded-3xl blur-2xl opacity-20" style={{ backgroundColor: pc }} />
                <img
                  src="/images/home/b9x79.jpg"
                  alt={`${displayName} POS Terminal`}
                  className="relative rounded-2xl shadow-2xl max-w-md w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section style={{ backgroundColor: pc }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl sm:text-4xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-sm font-medium text-gray-700 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Redefining Section */}
      <section className="py-20 sm:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
            Redefining the Future of POS Solutions.
          </h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            As a restaurant-first platform, {displayName} tailors to your unique needs — our wide array of features
            and integrations give you the flexibility to choose what works best for your business.
          </p>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="pb-20 sm:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold tracking-wider uppercase mb-3" style={{ color: ac }}>EVERYTHING YOU NEED</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">Powerful features, one platform.</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature) => (
              <div key={feature.title} className="bg-gray-50 rounded-2xl p-8 sm:p-10 hover:bg-gray-100 transition-colors">
                <p className="text-xs font-semibold tracking-wider uppercase mb-3" style={{ color: ac }}>{feature.tag}</p>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">{feature.title}</h3>
                    <p className="text-gray-500 leading-relaxed">{feature.description}</p>
                  </div>
                  <div className="flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${pc}1A` }}>
                    <Icon icon={feature.icon} className="w-7 h-7" style={{ color: ac }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solutions Section */}
      <section id="solutions" className="py-20 sm:py-28 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="flex gap-3 mb-6">
                <span className="px-4 py-1.5 rounded-full text-xs font-semibold" style={{ backgroundColor: `${pc}26`, color: ac }}>All-in-One Platform</span>
                <span className="px-4 py-1.5 rounded-full text-xs font-semibold" style={{ backgroundColor: `${pc}26`, color: ac }}>Easy Setup</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
                Everything you need to run your restaurant.
              </h2>
              <p className="text-gray-500 leading-relaxed mb-8">
                From front-of-house to back-of-house, {displayName} gives you complete control.
                Manage your menu, track inventory, view real-time reports, and process payments — all in one place.
              </p>
              <ul className="space-y-4">
                {[
                  "Counter POS & Table Service",
                  "Kitchen Display System",
                  "QR Code Table Ordering",
                  "Inventory & Supply Chain Management",
                  "Staff Management & Permissions",
                  "Real-time Sales & Analytics",
                  "Integrated Payment Processing",
                  "Multi-location Support",
                  "Online Ordering & Delivery",
                  "Customer Loyalty Programs",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-gray-700">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${pc}33` }}>
                      <Icon icon="solar:check-read-linear" className="w-3.5 h-3.5" style={{ color: ac }} />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="absolute -inset-4 rounded-3xl blur-2xl opacity-10" style={{ backgroundColor: pc }} />
              <img
                src="/images/home/b9x79.jpg"
                alt={`${displayName} POS System`}
                className="relative rounded-3xl shadow-2xl w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Hardware Section */}
      <section id="hardware" className="py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold tracking-wider uppercase mb-3" style={{ color: ac }}>STATE-OF-THE-ART HARDWARE</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Professional POS Terminals</h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              Built for the demands of modern hospitality — sleek, durable, and lightning-fast.
              Available for monthly rental or outright purchase.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Countertop Terminal",
                description: "Full-featured Android POS with built-in printer, scanner, and NFC payments. Perfect for counter service and checkout.",
                icon: "solar:monitor-bold-duotone",
                features: ["Built-in receipt printer", "NFC / Tap to pay", "10\" HD touchscreen"],
              },
              {
                title: "Handheld Terminal",
                description: "Compact mobile POS for tableside ordering and payments. Wi-Fi and 4G connectivity for maximum flexibility.",
                icon: "solar:smartphone-bold-duotone",
                features: ["Portable & wireless", "Built-in card reader", "Long battery life"],
              },
              {
                title: "Kitchen Display",
                description: "Heat-resistant kitchen display system that replaces paper tickets. Auto-routing, timers, and priority alerts.",
                icon: "solar:monitor-smartphone-bold-duotone",
                features: ["Heat & splash resistant", "Auto order routing", "Prep time tracking"],
              },
            ].map((hw) => (
              <div key={hw.title} className="bg-gray-50 rounded-2xl p-8 hover:shadow-lg transition-all">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6" style={{ backgroundColor: `${pc}1A` }}>
                  <Icon icon={hw.icon} className="w-7 h-7" style={{ color: ac }} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{hw.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed mb-4">{hw.description}</p>
                <ul className="space-y-2">
                  {hw.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <Icon icon="solar:check-circle-bold" className="w-4 h-4 flex-shrink-0" style={{ color: ac }} />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 sm:py-28 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold tracking-wider uppercase mb-3" style={{ color: ac }}>SIMPLE PRICING</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Free software. Low processing fees.</h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              No monthly software fees, no hidden charges. You only pay for payment processing — at rates lower than any competitor.
            </p>
          </div>
          <div className="max-w-lg mx-auto">
            <div className="bg-white rounded-3xl p-10 shadow-xl border border-gray-100">
              <div className="text-center mb-8">
                <p className="text-sm font-semibold uppercase tracking-wider mb-2" style={{ color: ac }}>ALL-INCLUSIVE</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-5xl font-bold text-gray-900">$0</span>
                  <span className="text-gray-500">/month</span>
                </div>
                <p className="text-sm text-gray-500 mt-2">Software is free — forever</p>
              </div>
              <ul className="space-y-4 mb-8">
                {[
                  "Full POS software suite",
                  "Online ordering portal",
                  "Kitchen display system",
                  "Inventory management",
                  "Staff management & scheduling",
                  "Real-time analytics & reporting",
                  "Multi-location support",
                  "24/7 customer support",
                  "Free software updates",
                  "Lowest payment processing rates",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-gray-700 text-sm">
                    <Icon icon="solar:check-circle-bold" className="w-5 h-5 flex-shrink-0" style={{ color: ac }} />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href={routes.signup}
                className="block w-full py-4 rounded-full text-center text-base font-semibold text-gray-900 hover:opacity-90 transition-colors"
                style={{ backgroundColor: pc }}
              >
                Start Free Trial
              </Link>
              <p className="text-xs text-gray-400 text-center mt-4">
                Hardware available for rent or purchase. Contact us for details.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA + Contact Form Section */}
      <section id="contact" className="py-20 sm:py-28" style={{ backgroundColor: pc }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">
            {/* Left text */}
            <div className="lg:pt-8">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
                Ready to get started?
              </h2>
              <p className="text-lg text-gray-700 mb-8">
                Want to see what {displayName} can do for your business? Let&apos;s talk!
              </p>
              <div className="flex flex-col sm:flex-row gap-4 mb-12">
                <Link
                  href={routes.signup}
                  className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-semibold bg-gray-900 text-white hover:bg-gray-800 transition-colors"
                >
                  Start Free Trial
                </Link>
              </div>

              {/* Contact Info */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900">Get in Touch</h3>
                <div className="flex items-center gap-3 text-gray-800">
                  <Icon icon="solar:buildings-bold-duotone" className="w-5 h-5 text-gray-700" />
                  <span className="text-sm font-medium">{displayName} Technologies Inc.</span>
                </div>
                <a href="mailto:info@oreugo.ca" className="flex items-center gap-3 text-gray-800 hover:text-gray-900 transition-colors">
                  <Icon icon="solar:letter-bold-duotone" className="w-5 h-5 text-gray-700" />
                  <span className="text-sm font-medium">info@oreugo.ca</span>
                </a>
                <a href="tel:+12265000381" className="flex items-center gap-3 text-gray-800 hover:text-gray-900 transition-colors">
                  <Icon icon="solar:phone-bold-duotone" className="w-5 h-5 text-gray-700" />
                  <span className="text-sm font-medium">226-500-0381</span>
                </a>
              </div>
            </div>

            {/* Right form */}
            <div className="bg-white rounded-3xl p-8 sm:p-10 shadow-xl">
              {submitted ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                    <Icon icon="solar:check-circle-bold" className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Thank you!</h3>
                  <p className="text-gray-500">We&apos;ll be in touch shortly.</p>
                </div>
              ) : (
                <>
                  <h3 className="text-xl font-bold text-gray-900 mb-6 text-center">Request a Demo</h3>
                  <hr className="mb-6" />
                  <form onSubmit={handleContactSubmit} className="space-y-5">
                    {/* Interest Tags */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-2">I&apos;m Interested in..</label>
                      <div className="flex flex-wrap gap-2">
                        {["Point of Sale", "Payments", "Online Ordering", "Hardware", "Integrations"].map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => toggleInterest(item)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                              contactForm.interest.includes(item) ? "border-current" : "border-gray-200 text-gray-600 hover:border-gray-300"
                            }`}
                            style={contactForm.interest.includes(item) ? { backgroundColor: `${pc}1A`, borderColor: ac, color: ac } : undefined}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-1">First Name <span className="text-red-500">*</span></label>
                        <input type="text" required value={contactForm.firstName} onChange={(e) => setContactForm((p) => ({ ...p, firstName: e.target.value }))} placeholder="Enter first name" className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputFocusStyle} />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-1">Last Name</label>
                        <input type="text" value={contactForm.lastName} onChange={(e) => setContactForm((p) => ({ ...p, lastName: e.target.value }))} placeholder="Enter last name" className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputFocusStyle} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-1">Email <span className="text-red-500">*</span></label>
                        <input type="email" required value={contactForm.email} onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))} placeholder="you@company.com" className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputFocusStyle} />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-1">Phone</label>
                        <input type="tel" value={contactForm.phone} onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))} placeholder="226-500-0381" className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputFocusStyle} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-1">Company <span className="text-red-500">*</span></label>
                      <input type="text" required value={contactForm.company} onChange={(e) => setContactForm((p) => ({ ...p, company: e.target.value }))} placeholder="Your restaurant or business name" className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent" style={inputFocusStyle} />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-900 mb-1">Message</label>
                      <textarea rows={3} value={contactForm.message} onChange={(e) => setContactForm((p) => ({ ...p, message: e.target.value }))} placeholder="Tell us about your business..." className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:border-transparent resize-none" style={inputFocusStyle} />
                    </div>

                    {submitError && (
                      <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{submitError}</p>
                    )}

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 rounded-full text-base font-semibold text-gray-900 hover:opacity-90 transition-colors disabled:opacity-50"
                      style={{ backgroundColor: pc }}
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

      {/* Footer */}
      <footer className="bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
            {/* Logo + Contact */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                {branding.brandLogoUrl ? (
                  <img src={branding.brandLogoUrl} alt={displayName} className="h-10" />
                ) : (
                  <span className="text-lg font-bold text-white">{displayName}</span>
                )}
              </div>
              <p className="text-sm text-gray-400 mb-4">{displayName} Technologies Inc.</p>
              <div className="space-y-2">
                <a href="mailto:info@oreugo.ca" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
                  <Icon icon="solar:letter-linear" className="w-4 h-4" />
                  info@oreugo.ca
                </a>
                <a href="tel:+12265000381" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
                  <Icon icon="solar:phone-linear" className="w-4 h-4" />
                  226-500-0381
                </a>
              </div>
            </div>

            {/* Products */}
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
                    <a href={item.href} className="text-sm text-gray-400 hover:text-white transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Features */}
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
                    <a href={item.href} className="text-sm text-gray-400 hover:text-white transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Contact Us", href: "#contact" },
                  { label: "Privacy Policy", href: routes.isPartnerDomain ? "/privacy" : "/partner/privacy" },
                  { label: "Terms & Conditions", href: routes.isPartnerDomain ? "/terms" : "/partner/terms" },
                  { label: "Cookie Policy", href: routes.isPartnerDomain ? "/cookies" : "/partner/cookies" },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.href} className="text-sm text-gray-400 hover:text-white transition-colors">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-gray-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              &copy; {displayName} Technologies Inc. {new Date().getFullYear()} &mdash; All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <a href="#" className="text-gray-500 hover:text-white transition-colors">
                <Icon icon="mdi:instagram" className="w-5 h-5" />
              </a>
              <a href="#" className="text-gray-500 hover:text-white transition-colors">
                <Icon icon="mdi:linkedin" className="w-5 h-5" />
              </a>
              <a href="#" className="text-gray-500 hover:text-white transition-colors">
                <Icon icon="mdi:facebook" className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
