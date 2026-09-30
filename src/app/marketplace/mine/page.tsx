"use client";

// =============================================================================
// /marketplace/mine — the buyer's purchase history + install links.
//
// Auth-gated (partner_token). Anonymous visitors get redirected to sign in.
// Wrapped in PartnerSiteShell so it inherits the hub chrome. Each purchase
// card shows: supplier name + logo, product name(s), price paid, date,
// method (STRIPE / MOCK / etc.), Download link (if the source product is
// still SOFTWARE and has a downloadUrl), Receipt link (the pay page's
// permalink which now renders in its paid-state form).
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import PartnerSiteShell from "@/components/partner/site-shell";

interface Software {
  downloadUrl: string | null;
  docsUrl: string | null;
  version: string | null;
  licenseModel: string | null;
}

interface Item {
  id: string;
  productId: string | null;
  productName: string;
  productDescription: string | null;
  quantity: number;
  unitLabel: string;
  unitPriceCents: number;
  lineTotalCents: number;
  software: Software | null;
}

interface Purchase {
  id: string;
  invoiceNumber: string;
  currency: string;
  totalCents: number;
  amountPaidCents: number;
  paidAt: string | null;
  paidMethod: string | null;
  notes: string | null;
  supplier: {
    id: string;
    displayName: string;
    contactEmail: string | null;
    websiteUrl: string | null;
    brandColor: string | null;
    brandLogoUrl: string | null;
  };
  items: Item[];
}

export default function MyPurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/marketplace/purchases");
    if (res.status === 401) {
      setNeedsAuth(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    if (data.success) setPurchases(data.purchases);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const money = (cents: number, ccy: string) =>
    `${ccy} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <PartnerSiteShell>
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-8 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">My purchases</h1>
            <p className="mt-1 text-slate-500">
              Software you&apos;ve bought on hub. Downloads, receipts, and vendor contact all live here.
            </p>
          </div>
          <Link
            href="/marketplace"
            className="text-sm font-semibold text-indigo-700 hover:text-indigo-800"
          >
            Browse marketplace →
          </Link>
        </div>

        {needsAuth ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-14 text-center">
            <Icon icon="solar:lock-keyhole-linear" className="w-12 h-12 mx-auto text-slate-300" />
            <p className="mt-3 text-lg font-semibold text-slate-800">Sign in to see your purchases</p>
            <Link
              href="/partner/login?callbackUrl=/marketplace/mine"
              className="mt-4 inline-block rounded-xl bg-indigo-700 text-white px-5 py-2 text-sm font-semibold hover:bg-teal-600"
            >
              Sign in
            </Link>
          </div>
        ) : loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : purchases.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-14 text-center">
            <Icon icon="solar:bag-3-linear" className="w-12 h-12 mx-auto text-slate-300" />
            <p className="mt-3 text-lg font-semibold text-slate-800">Nothing purchased yet</p>
            <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
              Anything you buy from the marketplace shows up here — downloads, receipts, and
              vendor contact info in one place.
            </p>
            <Link
              href="/marketplace"
              className="mt-4 inline-block rounded-xl bg-indigo-700 text-white px-5 py-2 text-sm font-semibold hover:bg-teal-600"
            >
              Browse marketplace
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {purchases.map((p) => (
              <article
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
              >
                <header
                  className="px-5 py-4 flex items-center gap-3 border-b border-slate-100"
                  style={{
                    backgroundColor: p.supplier.brandColor ? `${p.supplier.brandColor}08` : "#F9FAFB",
                  }}
                >
                  {p.supplier.brandLogoUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={p.supplier.brandLogoUrl}
                      alt={p.supplier.displayName}
                      className="w-10 h-10 object-contain rounded"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded flex items-center justify-center text-sm font-bold text-white"
                      style={{ backgroundColor: p.supplier.brandColor || "#3A3EBF" }}
                    >
                      {p.supplier.displayName[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{p.supplier.displayName}</p>
                    <p className="text-xs text-slate-500">
                      Invoice <span className="font-mono">{p.invoiceNumber}</span> · Paid {fmtDate(p.paidAt)}
                      {p.paidMethod && <> · via {formatMethod(p.paidMethod)}</>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-slate-900 tabular-nums">
                      {money(p.amountPaidCents, p.currency)}
                    </p>
                  </div>
                </header>

                <div className="p-5 space-y-3">
                  {p.items.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-start justify-between gap-4 flex-wrap"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900">
                          {it.productName}
                          {it.software?.version && (
                            <span className="ml-2 text-xs font-mono text-slate-500">
                              v{it.software.version}
                            </span>
                          )}
                        </p>
                        {it.productDescription && (
                          <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">
                            {it.productDescription}
                          </p>
                        )}
                        {it.software?.licenseModel && (
                          <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                            Licence · {it.software.licenseModel}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {it.software?.downloadUrl && (
                          <a
                            href={it.software.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 hover:bg-teal-600"
                            style={p.supplier.brandColor ? { backgroundColor: p.supplier.brandColor } : undefined}
                          >
                            <Icon icon="solar:download-linear" className="w-4 h-4" />
                            Download
                          </a>
                        )}
                        {it.software?.docsUrl && (
                          <a
                            href={it.software.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium px-3 py-1.5 hover:bg-slate-50"
                          >
                            Docs
                          </a>
                        )}
                        {it.productId && (
                          <Link
                            href={`/marketplace/${it.productId}`}
                            className="text-xs text-slate-500 hover:text-indigo-700 underline underline-offset-2"
                          >
                            View listing
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <footer className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 flex-wrap text-xs">
                  <div className="text-slate-500 flex items-center gap-3">
                    <Link
                      href={`/pay/invoice/${p.id}`}
                      className="hover:text-indigo-700 inline-flex items-center gap-1"
                    >
                      <Icon icon="solar:receipt-linear" className="w-3.5 h-3.5" />
                      Receipt
                    </Link>
                    <Link
                      href={`/pay/invoice/${p.id}/print`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-indigo-700 inline-flex items-center gap-1"
                    >
                      <Icon icon="solar:printer-linear" className="w-3.5 h-3.5" />
                      Printable
                    </Link>
                    {p.supplier.contactEmail && (
                      <a
                        href={`mailto:${p.supplier.contactEmail}`}
                        className="hover:text-indigo-700 inline-flex items-center gap-1"
                      >
                        <Icon icon="solar:letter-linear" className="w-3.5 h-3.5" />
                        Support
                      </a>
                    )}
                  </div>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
    </PartnerSiteShell>
  );
}

function formatMethod(m: string): string {
  const map: Record<string, string> = {
    STRIPE: "Stripe",
    MOCK: "test payment",
    MONERIS: "Moneris",
    GP: "GP",
    CASH: "cash",
    CARD: "card",
  };
  return map[m] || m.toLowerCase();
}
