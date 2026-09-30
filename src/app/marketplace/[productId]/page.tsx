"use client";

// =============================================================================
// /marketplace/[productId] — public detail for one software listing.
//
// Two-column layout on desktop: images on the left, buy-panel on the right.
// Below: full description, requirements, license/pricing info, supplier
// about, T&C link. "Buy" button is Phase 5 turn 2 — for now it shows a
// disabled placeholder that says "Buy flow coming in the next pass".
//
// Rendered inside PartnerSiteShell so it inherits hub chrome on the
// synergydatalabs subdomain.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
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
  requirements: string | null;
  docsUrl: string | null;
  downloadUrl: string | null;
  category: string | null;
  images: { id: string; dataUrl: string; altText: string | null; isPrimary: boolean }[];
  supplier: {
    id: string;
    displayName: string;
    legalName: string | null;
    aboutText: string | null;
    contactEmail: string | null;
    websiteUrl: string | null;
    brandColor: string | null;
    brandLogoUrl: string | null;
  };
  activeTerms: { version: string; effectiveFrom: string } | null;
}

const PRICING_LABEL: Record<string, string> = {
  ONE_TIME: "One-time payment",
  MONTHLY: "Monthly subscription",
  ANNUAL: "Annual subscription",
  USAGE: "Usage-based",
};

export default function MarketplaceDetailPage() {
  const params = useParams<{ productId: string }>();
  const productId = params?.productId;

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Phase F #5 turn 2 (2026-08-27): purchase state.
  // authState is loaded once alongside the listing; the buy button is
  // gated on it. If null we haven't checked yet (show a spinner-y CTA);
  // if false the CTA becomes "Sign in to buy"; if the tenant object comes
  // back, we know who's about to pay and can show a personalised label.
  const [authState, setAuthState] = useState<null | {
    authenticated: boolean;
    tenantName?: string;
    isOwnListing?: boolean;
  }>(null);
  const [buying, setBuying] = useState(false);

  const load = useCallback(async () => {
    if (!productId) return;
    // Parallel: listing + auth state. Auth is a cheap same-origin fetch
    // that returns { authenticated: false } for anonymous visitors, so no
    // second round trip needed to render the buy CTA correctly.
    const [listingRes, authRes] = await Promise.all([
      fetch(`/api/marketplace/software/${productId}`),
      fetch("/api/partner/auth/session"),
    ]);
    if (listingRes.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const data = await listingRes.json();
    if (data.success) {
      setListing(data.listing);
      setSelectedImage(data.listing.images?.[0]?.dataUrl ?? null);
    }
    try {
      const authData = await authRes.json();
      if (authData?.authenticated && authData?.tenant) {
        setAuthState({
          authenticated: true,
          tenantName: authData.tenant.name,
          isOwnListing: authData.tenant.id === data.listing?.supplier?.id,
        });
      } else {
        setAuthState({ authenticated: false });
      }
    } catch {
      setAuthState({ authenticated: false });
    }
    setLoading(false);
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const money = (cents: number) =>
    listing
      ? `${listing.currency} ${(cents / 100).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "";

  const buy = async () => {
    if (!listing) return;
    setBuying(true);
    try {
      const res = await fetch(`/api/marketplace/software/${listing.id}/buy`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Purchase failed");
        setBuying(false);
        return;
      }
      if (!data.payUrl) {
        toast.error("Server returned no payment link");
        setBuying(false);
        return;
      }
      // Redirect to the pay page — same URL the supplier would email out.
      // Full-page nav; buying flag stays true so the button reads
      // "Redirecting…" until the browser navigates away.
      window.location.href = data.payUrl;
    } catch {
      toast.error("Purchase failed");
      setBuying(false);
    }
  };

  if (notFound) {
    return (
      <PartnerSiteShell>
        <div className="max-w-2xl mx-auto px-6 py-24 text-center">
          <p className="text-lg text-slate-800 font-semibold">Listing not found</p>
          <p className="mt-1 text-sm text-slate-500">
            It may have been removed by the vendor.
          </p>
          <Link href="/marketplace" className="mt-4 inline-block text-sm font-semibold text-indigo-700">
            ← Back to marketplace
          </Link>
        </div>
      </PartnerSiteShell>
    );
  }

  if (loading || !listing) {
    return (
      <PartnerSiteShell>
        <div className="max-w-6xl mx-auto px-6 py-16 animate-pulse space-y-6">
          <div className="h-8 w-1/3 bg-slate-100 rounded" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="aspect-video bg-slate-100 rounded-2xl" />
            <div className="space-y-3">
              <div className="h-10 bg-slate-100 rounded" />
              <div className="h-24 bg-slate-100 rounded" />
              <div className="h-14 bg-slate-100 rounded" />
            </div>
          </div>
        </div>
      </PartnerSiteShell>
    );
  }

  const brandColor = listing.supplier.brandColor || "#3A3EBF";

  return (
    <PartnerSiteShell>
      <div className="max-w-6xl mx-auto px-6 py-10 sm:py-12">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm">
          <Link href="/marketplace" className="text-slate-500 hover:text-indigo-700">← Marketplace</Link>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-10">
          {/* Images */}
          <div>
            <div
              className="aspect-video rounded-2xl border border-slate-200 flex items-center justify-center overflow-hidden"
              style={{ backgroundColor: `${brandColor}0A` }}
            >
              {selectedImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={selectedImage} alt={listing.name} className="max-h-full max-w-full object-contain" />
              ) : (
                <Icon
                  icon="solar:code-square-bold-duotone"
                  className="w-32 h-32"
                  style={{ color: brandColor }}
                />
              )}
            </div>
            {listing.images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {listing.images.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setSelectedImage(img.dataUrl)}
                    className={`shrink-0 w-20 h-16 rounded-lg border overflow-hidden ${
                      selectedImage === img.dataUrl ? "border-indigo-500" : "border-slate-200"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.dataUrl} alt={img.altText ?? ""} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Buy panel */}
          <aside>
            {listing.category && (
              <span className="inline-block rounded-full bg-slate-100 text-slate-600 px-2.5 py-0.5 text-xs font-medium mb-3">
                {listing.category}
              </span>
            )}
            <h1 className="text-3xl font-bold text-slate-900">{listing.name}</h1>
            <div className="mt-1 text-sm text-slate-500">
              by <Link href={`#supplier`} className="font-medium text-slate-700 hover:text-indigo-700">
                {listing.supplier.displayName}
              </Link>
              {listing.version && <> · v{listing.version}</>}
            </div>

            {/* Price */}
            <div className="mt-6 rounded-2xl border border-slate-200 p-5">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900 tabular-nums">
                  {money(listing.priceCents)}
                </span>
                {listing.pricingModel && listing.pricingModel !== "ONE_TIME" && (
                  <span className="text-sm text-slate-500">
                    {PRICING_LABEL[listing.pricingModel]?.toLowerCase() ?? listing.pricingModel.toLowerCase()}
                  </span>
                )}
              </div>
              {listing.priceReferenceCents && listing.priceReferenceCents > listing.priceCents && (
                <p className="text-xs text-slate-500 mt-1">
                  MSRP <span className="line-through">{money(listing.priceReferenceCents)}</span>
                </p>
              )}
              {listing.trialDays ? (
                <p className="mt-1 text-xs font-semibold" style={{ color: brandColor }}>
                  {listing.trialDays}-day free trial
                </p>
              ) : null}

              {/* Buy CTA — gates on auth state.
                    • authState null   → we haven't finished the check yet;
                                         show a neutral loading label so the
                                         user doesn't click twice.
                    • not authenticated → route them to sign in with the
                                         current page as the callback so
                                         we land back here after login.
                    • own listing      → refuse gracefully (supplier can't
                                         buy from themselves).
                    • authenticated    → real buy button. Clicking creates
                                         a supplier-issued invoice on the
                                         buyer's email and redirects them
                                         to the branded pay page (which in
                                         turn hits Stripe / mock). */}
              {authState === null ? (
                <button
                  type="button"
                  disabled
                  className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white opacity-60"
                  style={{ backgroundColor: brandColor }}
                >
                  Loading…
                </button>
              ) : authState.isOwnListing ? (
                <div className="mt-4">
                  <button
                    type="button"
                    disabled
                    className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-slate-500 bg-slate-100 cursor-not-allowed"
                  >
                    This is your own listing
                  </button>
                  <p className="mt-2 text-center text-[11px] text-slate-500">
                    Edit it in your Products page.
                  </p>
                </div>
              ) : !authState.authenticated ? (
                <div className="mt-4">
                  <Link
                    href={`/partner/login?callbackUrl=${encodeURIComponent(
                      typeof window !== "undefined" ? window.location.pathname : "/marketplace"
                    )}`}
                    className="block text-center rounded-xl px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
                    style={{ backgroundColor: brandColor }}
                  >
                    Sign in to buy
                  </Link>
                  <p className="mt-2 text-center text-[11px] text-slate-500">
                    New here?{" "}
                    <Link href="/partner/signup" className="underline font-medium">
                      Create a hub account
                    </Link>
                  </p>
                </div>
              ) : (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={buy}
                    disabled={buying}
                    className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: brandColor }}
                  >
                    {buying ? "Preparing checkout…" : `Buy ${money(listing.priceCents)}`}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-slate-500">
                    Bills to <span className="font-medium">{authState.tenantName}</span> ·
                    {" "}Card, Apple Pay, and Google Pay accepted
                  </p>
                </div>
              )}
            </div>

            {/* Facts */}
            <dl className="mt-6 space-y-3 text-sm">
              {listing.licenseModel && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">License</dt>
                  <dd className="text-slate-900 font-medium text-right">{listing.licenseModel}</dd>
                </div>
              )}
              {listing.pricingModel && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Pricing</dt>
                  <dd className="text-slate-900 font-medium text-right">
                    {PRICING_LABEL[listing.pricingModel] ?? listing.pricingModel}
                  </dd>
                </div>
              )}
              {listing.docsUrl && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Documentation</dt>
                  <dd className="text-right">
                    <a href={listing.docsUrl} target="_blank" rel="noopener noreferrer"
                       className="font-medium hover:underline" style={{ color: brandColor }}>
                      View docs →
                    </a>
                  </dd>
                </div>
              )}
              {listing.activeTerms && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Terms</dt>
                  <dd className="text-slate-900 font-medium text-right">
                    Version <span className="font-mono">{listing.activeTerms.version}</span>
                    <span className="text-xs text-slate-500 block">Presented at checkout</span>
                  </dd>
                </div>
              )}
            </dl>
          </aside>
        </div>

        {/* Description */}
        {listing.description && (
          <section className="mt-14 max-w-3xl">
            <h2 className="text-xl font-semibold text-slate-900 mb-3">About this software</h2>
            <p className="text-slate-700 leading-relaxed whitespace-pre-line">
              {listing.description}
            </p>
          </section>
        )}

        {/* Requirements */}
        {listing.requirements && (
          <section className="mt-10 max-w-3xl">
            <h2 className="text-xl font-semibold text-slate-900 mb-3">System requirements</h2>
            <pre className="whitespace-pre-wrap font-mono text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-5 m-0">
              {listing.requirements}
            </pre>
          </section>
        )}

        {/* Supplier */}
        <section id="supplier" className="mt-14 max-w-3xl">
          <h2 className="text-xl font-semibold text-slate-900 mb-3">About the vendor</h2>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-start gap-4">
              {listing.supplier.brandLogoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={listing.supplier.brandLogoUrl} alt={listing.supplier.displayName}
                     className="w-16 h-16 object-contain rounded-lg" />
              )}
              <div className="flex-1">
                <p className="font-semibold text-slate-900">{listing.supplier.displayName}</p>
                {listing.supplier.legalName && listing.supplier.legalName !== listing.supplier.displayName && (
                  <p className="text-xs text-slate-500 mt-0.5">{listing.supplier.legalName}</p>
                )}
                {listing.supplier.aboutText && (
                  <p className="mt-3 text-sm text-slate-700 whitespace-pre-line">{listing.supplier.aboutText}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  {listing.supplier.contactEmail && (
                    <a href={`mailto:${listing.supplier.contactEmail}`} className="text-slate-700 hover:text-indigo-700">
                      <Icon icon="solar:letter-linear" className="inline w-4 h-4 mr-1 -mt-0.5" />
                      {listing.supplier.contactEmail}
                    </a>
                  )}
                  {listing.supplier.websiteUrl && (
                    <a href={listing.supplier.websiteUrl} target="_blank" rel="noopener noreferrer"
                       className="text-slate-700 hover:text-indigo-700">
                      <Icon icon="solar:global-linear" className="inline w-4 h-4 mr-1 -mt-0.5" />
                      Website
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PartnerSiteShell>
  );
}
