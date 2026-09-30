"use client";

// Supplier portal — Dashboard.
//
// Phase A: welcome header, live customer count, and an onboarding checklist
// that walks the supplier through what to do next. Product/order tiles
// arrive in Phase B when the catalog + PO features land.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";

interface SupplierMe {
  tenant: { id: string; name: string; currency: string };
  profile: {
    displayName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    warehouseAddress: unknown;
    categories: string[];
    onboardingStatus: string;
  } | null;
  stats: {
    activeCustomers: number;
  };
}

export default function SupplierDashboardPage() {
  const [data, setData] = useState<SupplierMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier/me")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4 max-w-4xl">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            <div className="h-28 bg-gray-100 rounded-2xl" />
            <div className="h-28 bg-gray-100 rounded-2xl" />
            <div className="h-28 bg-gray-100 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Couldn't load your supplier profile.</p>
      </div>
    );
  }

  const displayName = data.profile?.displayName || data.tenant.name;

  // Onboarding checklist — computed from what's actually in the profile,
  // not from the funnel enum, so it stays honest even if the enum drifts.
  const steps = [
    {
      key: "profile",
      title: "Complete your company profile",
      description: "Add your logo, warehouse address, and contact info.",
      done: !!(
        data.profile?.contactEmail &&
        data.profile?.contactPhone &&
        data.profile?.warehouseAddress
      ),
      href: "/supplier/settings",
      cta: "Edit profile",
    },
    {
      key: "categories",
      title: "Tag your product categories",
      description: "Helps merchants find you in the marketplace.",
      done: (data.profile?.categories?.length || 0) > 0,
      href: "/supplier/settings",
      cta: "Add categories",
    },
    {
      key: "products",
      title: "Upload your product catalog",
      description: "Add products manually or import from Excel/CSV.",
      done: false, // Phase B — feature not yet built
      disabled: true,
      href: "/supplier/products",
      cta: "Coming in Phase B",
    },
    {
      key: "gateway",
      title: "Apply for a payment gateway",
      description: "So merchants can pay you directly through the platform.",
      done: false, // Phase C
      disabled: true,
      href: "/supplier/settings",
      cta: "Coming in Phase C",
    },
  ];

  const completedSteps = steps.filter((s) => s.done).length;
  const totalSteps = steps.length;

  return (
    <div className="p-6 lg:p-10 max-w-5xl mx-auto">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
          Welcome, {displayName}
        </h1>
        <p className="text-gray-500 mt-1">
          Here's what's happening across your supplier account.
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatTile
          label="Active customers"
          value={data.stats.activeCustomers.toString()}
          icon="solar:shop-bold"
          accent="from-emerald-500 to-green-600"
          href="/supplier/customers"
        />
        <StatTile
          label="Products listed"
          value="0"
          icon="solar:box-bold"
          accent="from-indigo-500 to-purple-600"
          subtext="Catalog arrives in Phase B"
        />
        <StatTile
          label="Purchase orders"
          value="0"
          icon="solar:clipboard-list-bold"
          accent="from-amber-500 to-orange-600"
          subtext="Orders arrive in Phase B"
        />
      </div>

      {/* Onboarding checklist */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Get set up for the marketplace
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {completedSteps} of {totalSteps} complete
            </p>
          </div>
          <div className="hidden sm:block w-32">
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all"
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {steps.map((step) => (
            <div key={step.key} className="p-5 flex items-start gap-4">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  step.done
                    ? "bg-emerald-100 text-emerald-600"
                    : step.disabled
                    ? "bg-gray-100 text-gray-400"
                    : "bg-indigo-100 text-indigo-600"
                }`}
              >
                <Icon
                  icon={
                    step.done
                      ? "solar:check-circle-bold"
                      : step.disabled
                      ? "solar:clock-circle-linear"
                      : "solar:play-circle-bold"
                  }
                  className="w-5 h-5"
                />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900">{step.title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{step.description}</p>
              </div>
              {!step.done && !step.disabled && (
                <Link
                  href={step.href}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                >
                  {step.cta}
                  <Icon icon="solar:arrow-right-linear" className="w-4 h-4" />
                </Link>
              )}
              {step.disabled && (
                <span className="flex-shrink-0 text-xs text-gray-400 pt-1.5">
                  {step.cta}
                </span>
              )}
              {step.done && (
                <span className="flex-shrink-0 text-xs text-emerald-600 font-semibold pt-1.5">
                  ✓ Done
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  accent,
  href,
  subtext,
}: {
  label: string;
  value: string;
  icon: string;
  accent: string;
  href?: string;
  subtext?: string;
}) {
  const inner = (
    <div className="p-5 rounded-2xl bg-white border border-gray-200 hover:border-gray-300 transition-colors h-full">
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-9 h-9 rounded-xl bg-gradient-to-br ${accent} flex items-center justify-center`}
        >
          <Icon icon={icon} className="w-5 h-5 text-white" />
        </div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
