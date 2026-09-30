"use client";

// Phase I #1 (2026-09-08) — Supplier portal: Payment Links list + create + manage.
//
// A payment link is a reusable checkout template. Supplier creates one per
// product/campaign here, gets a short URL back, drops that URL on their
// partner's site. Each click generates a fresh SupplierInvoice from the
// template (via /api/public/payment-links/[slug]/checkout) and routes the
// customer through the existing /pay/invoice/[id] pay flow.
//
// This page has three states:
//   - List (default): all links for this supplier + status/uses/URL
//   - Create modal: form to make a new link
//   - Detail drawer (open when a row is clicked): shows the big URL,
//     copy button, QR code, and a Disable action

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import PaymentLinkModal, { type EditableLink } from "./PaymentLinkModal";

interface PaymentLink {
  id: string;
  nickname: string;
  shortSlug: string;
  publicUrl: string;
  mode: "one_time" | "subscription";
  interval: string | null;
  intervalCount: number | null;
  unitAmountCents: number | null;
  currency: string;
  qtyLocked: boolean;
  qtyDefault: number;
  qtyMin: number;
  qtyMax: number | null;
  // Phase I #12 (2026-09-22): editable amount at pay time.
  amountLocked?: boolean;
  amountMinCents?: number | null;
  amountMaxCents?: number | null;
  partnerRef: string | null;
  partnerDisplayName: string | null;
  status: "active" | "disabled" | "expired";
  expiresAt: string | null;
  maxUses: number | null;
  currentUses: number;
  requireName: boolean;
  requirePhone: boolean;
  requireCompany: boolean;
  descriptionOverride: string | null;
  createdAt: string;
  product: {
    id: string;
    name: string;
    unitLabel: string;
  } | null;
  _count: { invoices: number };
}

interface ProductOption {
  id: string;
  name: string;
  wholesalePriceCents: number;
  priceCurrency: string;
  unitLabel: string;
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function statusPill(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: "bg-emerald-100", text: "text-emerald-800", label: "Active" },
    disabled: { bg: "bg-slate-100", text: "text-slate-600", label: "Disabled" },
    expired: { bg: "bg-amber-100", text: "text-amber-800", label: "Expired" },
  };
  const s = map[status] || map.disabled;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

export default function PaymentLinksPage() {
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<EditableLink | null>(null);
  const [detailLink, setDetailLink] = useState<PaymentLink | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "disabled">("all");

  async function reload() {
    setLoading(true);
    try {
      const [linksRes, productsRes] = await Promise.all([
        fetch("/api/supplier/payment-links"),
        fetch("/api/supplier/products"),
      ]);
      if (linksRes.ok) {
        const data = await linksRes.json();
        setLinks(data.links || []);
      }
      if (productsRes.ok) {
        const data = await productsRes.json();
        // supplier products endpoint returns { products: [...] } — normalize
        setProducts(
          (data.products || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            wholesalePriceCents: p.wholesalePriceCents,
            priceCurrency: p.priceCurrency ?? "CAD",
            unitLabel: p.unitLabel ?? "unit",
          }))
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load payment links");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function disableLink(id: string) {
    if (!confirm("Disable this payment link? Existing customers with the URL bookmarked will see 'link unavailable'. This can be reversed by editing the link.")) {
      return;
    }
    try {
      const res = await fetch(`/api/supplier/payment-links/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to disable");
      }
      toast.success("Payment link disabled");
      setDetailLink(null);
      await reload();
    } catch (err: any) {
      toast.error(err?.message || "Failed to disable");
    }
  }

  async function reactivateLink(id: string) {
    try {
      const res = await fetch(`/api/supplier/payment-links/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to reactivate");
      }
      toast.success("Payment link reactivated");
      await reload();
    } catch (err: any) {
      toast.error(err?.message || "Failed to reactivate");
    }
  }

  const filtered = links.filter((l) => {
    if (filter === "all") return true;
    return l.status === filter;
  });

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payment Links</h1>
          <p className="text-sm text-gray-600 mt-1">
            Reusable checkout templates. Share the URL — every click creates a
            fresh invoice and routes the customer through your payment gateway.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors"
        >
          <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
          New Payment Link
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-4">
        {(["all", "active", "disabled"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === k
                ? "bg-indigo-600 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {k === "all" ? `All (${links.length})` : k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div className="text-center py-20 text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-12 text-center">
          <Icon icon="solar:link-circle-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900 mb-1">
            {filter === "all" ? "No payment links yet" : `No ${filter} links`}
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            {filter === "all"
              ? "Create your first link — pick a product, set a nickname, share the URL."
              : "Try a different filter, or create a new link."}
          </p>
          {filter === "all" && (
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl"
            >
              <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
              Create Payment Link
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Nickname</th>
                <th className="text-left px-4 py-3 font-semibold">Product</th>
                <th className="text-left px-4 py-3 font-semibold">Price × Qty</th>
                <th className="text-left px-4 py-3 font-semibold">Type</th>
                <th className="text-left px-4 py-3 font-semibold">Uses</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((link) => (
                <tr
                  key={link.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setDetailLink(link)}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{link.nickname}</div>
                    {link.partnerRef && (
                      <div className="text-xs text-gray-500 mt-0.5 font-mono">
                        {link.partnerRef}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {link.product?.name || <span className="text-gray-400 italic">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {link.unitAmountCents != null
                      ? formatMoney(link.unitAmountCents, link.currency)
                      : "Product price"}
                    <span className="text-gray-400 ml-1">
                      ×{" "}
                      {link.qtyLocked
                        ? link.qtyDefault
                        : link.qtyMax != null
                        ? `${link.qtyMin}–${link.qtyMax}`
                        : `${link.qtyMin}+`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {link.mode === "subscription" ? (
                      <span className="inline-flex items-center gap-1 text-purple-700 text-xs font-medium">
                        <Icon icon="solar:refresh-circle-bold" className="w-3.5 h-3.5" />
                        Every {link.intervalCount === 1 ? "" : link.intervalCount + " "}
                        {link.interval}
                      </span>
                    ) : (
                      <span className="text-gray-600 text-xs">One-time</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900 font-medium">{link.currentUses}</div>
                    {link.maxUses != null && (
                      <div className="text-xs text-gray-500">of {link.maxUses}</div>
                    )}
                    <div className="text-xs text-gray-500">
                      {link._count.invoices} invoice{link._count.invoices === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusPill(link.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(link.publicUrl);
                          toast.success("URL copied");
                        }}
                        className="text-indigo-600 hover:text-indigo-800 p-1.5 rounded hover:bg-indigo-50"
                        title="Copy URL"
                      >
                        <Icon icon="solar:copy-bold" className="w-4 h-4" />
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          // FIX 2026-09-08: fetch the full record from the
                          // detail endpoint on Edit — the list endpoint
                          // omits redirectUrl + partnerLogoUrl (and could
                          // omit others in future), so hydrating the modal
                          // straight from the list row was leaving those
                          // fields blank and — on Save — nulling them in
                          // the DB. One extra round-trip, zero drift.
                          try {
                            const res = await fetch(`/api/supplier/payment-links/${link.id}`);
                            const json = await res.json();
                            if (!res.ok || !json.link) {
                              toast.error(json.error || "Could not load link details");
                              return;
                            }
                            const full = json.link;
                            setEditingLink({
                              id: full.id,
                              productId: full.product?.id ?? full.productId ?? null,
                              nickname: full.nickname,
                              mode: full.mode,
                              interval: full.interval,
                              intervalCount: full.intervalCount,
                              unitAmountCents: full.unitAmountCents,
                              currency: full.currency,
                              qtyLocked: full.qtyLocked,
                              qtyDefault: full.qtyDefault,
                              qtyMin: full.qtyMin,
                              qtyMax: full.qtyMax,
                              // Phase I #12 (2026-09-22): editable amount.
                              amountLocked: full.amountLocked,
                              amountMinCents: full.amountMinCents,
                              amountMaxCents: full.amountMaxCents,
                              partnerRef: full.partnerRef,
                              partnerDisplayName: full.partnerDisplayName,
                              partnerLogoUrl: full.partnerLogoUrl ?? null,
                              redirectUrl: full.redirectUrl ?? null,
                              notifyEmails: full.notifyEmails ?? null,
                              expiresAt: full.expiresAt,
                              maxUses: full.maxUses,
                              requireName: full.requireName,
                              requirePhone: full.requirePhone,
                              requireCompany: full.requireCompany,
                              descriptionOverride: full.descriptionOverride,
                              // Phase I #5 v2 (2026-09-14): per-link webhook
                              // fields — modal uses them to pre-fill the
                              // webhook section on edit.
                              webhookUrl: full.webhookUrl ?? null,
                              webhookTemplate: full.webhookTemplate ?? null,
                              webhookEvents: full.webhookEvents ?? [],
                              webhookContentType: full.webhookContentType,
                              webhookEnabled: full.webhookEnabled,
                              // Phase I #5 v3 (2026-09-14): partner-supplied
                              // secret — return in cleartext so the modal
                              // can pre-fill on edit (masked in the UI
                              // with a Show toggle).
                              webhookSecret: full.webhookSecret ?? null,
                            });
                          } catch {
                            toast.error("Could not load link details");
                          }
                        }}
                        className="text-gray-600 hover:text-gray-900 p-1.5 rounded hover:bg-gray-100"
                        title="Edit"
                      >
                        <Icon icon="solar:pen-bold" className="w-4 h-4" />
                      </button>
                      {link.status === "active" ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            disableLink(link.id);
                          }}
                          className="text-red-600 hover:text-red-800 p-1.5 rounded hover:bg-red-50"
                          title="Disable"
                        >
                          <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            reactivateLink(link.id);
                          }}
                          className="text-emerald-600 hover:text-emerald-800 p-1.5 rounded hover:bg-emerald-50"
                          title="Reactivate"
                        >
                          <Icon icon="solar:refresh-circle-bold" className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {modalOpen && (
        <PaymentLinkModal
          products={products}
          onClose={() => setModalOpen(false)}
          onCreated={async () => {
            setModalOpen(false);
            await reload();
          }}
        />
      )}

      {/* Edit modal — same component, pre-filled */}
      {editingLink && (
        <PaymentLinkModal
          products={products}
          editing={editingLink}
          onClose={() => setEditingLink(null)}
          onCreated={async () => {
            setEditingLink(null);
            await reload();
          }}
        />
      )}

      {/* Detail drawer */}
      {detailLink && (
        <DetailDrawer
          link={detailLink}
          onClose={() => setDetailLink(null)}
          onDisable={() => disableLink(detailLink.id)}
          onReactivate={() => reactivateLink(detailLink.id)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer — shows the URL, QR code, and one-click copy
// ---------------------------------------------------------------------------
function DetailDrawer({
  link,
  onClose,
  onDisable,
  onReactivate,
}: {
  link: PaymentLink;
  onClose: () => void;
  onDisable: () => void;
  onReactivate: () => void;
}) {
  // Use a public QR image proxy so we don't have to bundle qrcode.js just
  // for this admin surface. Read-only, no PII sent.
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(link.publicUrl)}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <aside
        className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{link.nickname}</h2>
              <div className="mt-1">{statusPill(link.status)}</div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
            >
              <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
            </button>
          </div>

          {/* URL block */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Public URL
            </div>
            <div className="font-mono text-sm break-all text-gray-900 mb-3">
              {link.publicUrl}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(link.publicUrl);
                  toast.success("URL copied");
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-lg"
              >
                <Icon icon="solar:copy-bold" className="w-4 h-4" />
                Copy
              </button>
              <a
                href={link.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium text-sm rounded-lg"
              >
                <Icon icon="solar:external-link-bold" className="w-4 h-4" />
                Preview
              </a>
            </div>
          </div>

          {/* QR code */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 text-center">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-3">
              QR Code
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrUrl}
              alt={`QR code for ${link.nickname}`}
              className="mx-auto rounded-lg border border-gray-200"
              style={{ width: 240, height: 240 }}
            />
            <a
              href={qrUrl}
              download={`${link.shortSlug}-qr.png`}
              className="inline-block mt-3 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Download PNG
            </a>
          </div>

          {/* Config summary */}
          <div className="space-y-3 mb-6">
            <Row label="Product">{link.product?.name || "—"}</Row>
            <Row label="Type">
              {link.mode === "subscription"
                ? `Subscription (every ${link.intervalCount === 1 ? "" : link.intervalCount + " "}${link.interval})`
                : "One-time"}
            </Row>
            <Row label="Unit price">
              {link.unitAmountCents != null
                ? formatMoney(link.unitAmountCents, link.currency)
                : "Uses product price at click time"}
            </Row>
            <Row label="Quantity">
              {link.qtyLocked
                ? `Locked at ${link.qtyDefault}`
                : `Customer picks — starts at ${link.qtyDefault} (${link.qtyMin}–${link.qtyMax ?? "∞"})`}
            </Row>
            <Row label="URL param ?qty=N">Always overrides + locks (with clamp to min/max)</Row>
            {link.partnerRef && <Row label="Partner tag">{link.partnerRef}</Row>}
            {link.partnerDisplayName && (
              <Row label="Co-branded as">{link.partnerDisplayName}</Row>
            )}
            {link.expiresAt && (
              <Row label="Expires">{new Date(link.expiresAt).toLocaleString()}</Row>
            )}
            {link.maxUses != null && (
              <Row label="Usage cap">
                {link.currentUses} / {link.maxUses}
              </Row>
            )}
            <Row label="Invoices generated">{link._count.invoices}</Row>
          </div>

          {/* Actions */}
          <div className="border-t border-gray-200 pt-4">
            {link.status === "active" ? (
              <button
                onClick={onDisable}
                className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 font-semibold rounded-xl transition-colors"
              >
                Disable link
              </button>
            ) : (
              <button
                onClick={onReactivate}
                className="w-full px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded-xl transition-colors"
              >
                Reactivate link
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-gray-900 text-right">{children}</span>
    </div>
  );
}
