"use client";

// =============================================================================
// /marketplace — public hub software marketplace.
//
// Wrapped in PartnerSiteShell so it inherits the hub chrome (SDL pill nav +
// teal footer) on hub.synergydatalabs.com. On other partner domains
// (oreugo.ca et al.) it inherits their chrome — deliberate: any partner can
// browse hub's marketplace, we just don't offer the "Install" path there
// until they're a hub tenant (that's Phase 5 turn 2).
//
// Grid of cards, one per SOFTWARE listing. Client-side filter for search /
// category / pricing model — small catalog for launch, no need to hit the
// server for filter changes.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import PartnerSiteShell from "@/components/partner/site-shell";

interface Listing {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  priceReferenceCents: number | null;
  currency: string;
  version: string | null;
  licenseModel: string | null;
  pricingModel: string | null;
  trialDays: number | null;
  category: string | null;
  supplier: {
    id: string;
    displayName: string;
    brandColor: string | null;
    brandLogoUrl: string | null;
  };
  primaryImage: string | null;
}

const PRICING_LABEL: Record<string, string> = {
  ONE_TIME: "One-time",
  MONTHLY: "per month",
  ANNUAL: "per year",
  USAGE: "usage-based",
};

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pricingFilter, setPricingFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/marketplace/software");
        const data = await res.json();
        if (data.success) setListings(data.listings);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const l of listings) if (l.category) set.add(l.category);
    return Array.from(set).sort();
  }, [listings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings.filter((l) => {
      if (pricingFilter && l.pricingModel !== pricingFilter) return false;
      if (categoryFilter && l.category !== categoryFilter) return false;
      if (q) {
        const hay = `${l.name} ${l.description ?? ""} ${l.supplier.displayName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [listings, search, pricingFilter, categoryFilter]);

  const money = (cents: number, ccy: string) =>
    `${ccy} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <PartnerSiteShell>
      <div className="max-w-6xl mx-auto px-6 py-12 sm:py-16">
        <div className="mb-10">
          <p className="text-sm uppercase tracking-wider text-indigo-700 font-semibold">Software marketplace</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-slate-900">
            Every app on <span className="text-indigo-700">hub</span>, in one place.
          </h1>
          <p className="mt-3 text-slate-600 max-w-2xl">
            Browse software built by hub creators. Each listing is a real product with a real vendor —
            pay online, install in one click. One account, one bill, one platform.
          </p>
        </div>

        {/* Filters */}
        <div className="mb-8 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Icon icon="solar:magnifer-linear" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              placeholder="Search software or vendor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={pricingFilter}
            onChange={(e) => setPricingFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
          >
            <option value="">Any pricing</option>
            <option value="ONE_TIME">One-time</option>
            <option value="MONTHLY">Monthly</option>
            <option value="ANNUAL">Annual</option>
            <option value="USAGE">Usage</option>
          </select>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-14 text-center">
            <Icon icon="solar:box-linear" className="w-12 h-12 mx-auto text-slate-300" />
            <p className="mt-3 text-lg font-semibold text-slate-800">
              {listings.length === 0 ? "No listings yet" : "No listings match your filters"}
            </p>
            <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
              {listings.length === 0
                ? "The first hub creators are listing their software now. Check back soon — or become one yourself."
                : "Try clearing a filter to see more results."}
            </p>
            {listings.length === 0 && (
              <Link
                href="/partner/signup/supplier"
                className="mt-4 inline-block text-sm font-semibold text-indigo-700 hover:text-indigo-800"
              >
                List your software →
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((l) => (
              <Link
                key={l.id}
                href={`/marketplace/${l.id}`}
                className="group rounded-2xl border border-slate-200 bg-white overflow-hidden hover:border-indigo-400 hover:shadow-md transition-all flex flex-col"
              >
                <div
                  className="aspect-[16/9] flex items-center justify-center border-b border-slate-100"
                  style={{
                    backgroundColor: l.supplier.brandColor
                      ? `${l.supplier.brandColor}10`
                      : "#F0F8F6",
                  }}
                >
                  {l.primaryImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={l.primaryImage} alt={l.name} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <Icon
                      icon="solar:code-square-bold-duotone"
                      className="w-16 h-16"
                      style={{ color: l.supplier.brandColor || "#3A3EBF" }}
                    />
                  )}
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-slate-900 group-hover:text-indigo-700 leading-snug">
                      {l.name}
                    </h3>
                    {l.category && (
                      <span className="shrink-0 rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] font-medium">
                        {l.category}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mb-3">
                    by <span className="font-medium text-slate-700">{l.supplier.displayName}</span>
                    {l.version && <> · v{l.version}</>}
                  </p>
                  {l.description && (
                    <p className="text-sm text-slate-600 line-clamp-3 flex-1 mb-4">
                      {l.description}
                    </p>
                  )}
                  <div className="flex items-baseline justify-between mt-auto pt-3 border-t border-slate-100">
                    <div>
                      <span className="text-xl font-bold text-slate-900 tabular-nums">
                        {money(l.priceCents, l.currency)}
                      </span>
                      {l.pricingModel && l.pricingModel !== "ONE_TIME" && (
                        <span className="text-xs text-slate-500 ml-1">
                          {PRICING_LABEL[l.pricingModel] || l.pricingModel.toLowerCase()}
                        </span>
                      )}
                    </div>
                    {l.trialDays ? (
                      <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide">
                        {l.trialDays}-day trial
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PartnerSiteShell>
  );
}
