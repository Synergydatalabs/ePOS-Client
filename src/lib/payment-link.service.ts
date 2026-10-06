// ============================================================================
// Payment Link service — Phase I #1 (2026-09-08).
//
// A PaymentLink is a reusable TEMPLATE. Suppliers create it once in the
// portal; each customer click generates a fresh SupplierInvoice from the
// template and hands them off to the existing /pay/invoice/[id] flow
// (which uses the supplier's configured SupplierProcessor to actually
// take the payment).
//
// This service handles:
//   • CRUD on the link itself (create, list, get, patch, disable)
//   • Public slug resolution (used by /l/[slug] to render the checkout)
//   • The "click → invoice" transaction (createInvoiceFromLink)
// ============================================================================

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
// Phase I #5 v3 (2026-09-14): secret is partner-supplied (not
// auto-generated). No sign helper needed in the service — the render
// pipeline handles HMAC only when a secret is present.

const ALLOWED_WEBHOOK_EVENTS = new Set([
  "payment.succeeded",
  "payment.failed",
  "payment.refunded",
  "invoice.paid",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatePaymentLinkInput {
  supplierTenantId: string;
  productId?: string | null;
  nickname: string;
  mode: "one_time" | "subscription";
  interval?: "day" | "week" | "month" | "year" | null;
  intervalCount?: number | null;
  unitAmountCents?: number | null;
  currency?: string;
  qtyLocked?: boolean;
  qtyDefault?: number;
  qtyMin?: number;
  qtyMax?: number | null;
  // Phase I #12 (2026-09-22): editable amount at pay time.
  amountLocked?: boolean;
  amountMinCents?: number | null;
  amountMaxCents?: number | null;
  partnerRef?: string | null;
  partnerDisplayName?: string | null;
  partnerLogoUrl?: string | null;
  redirectUrl?: string | null;
  expiresAt?: Date | null;
  maxUses?: number | null;
  requireName?: boolean;
  requirePhone?: boolean;
  requireCompany?: boolean;
  descriptionOverride?: string | null;
  // Phase I #3: comma-separated partner notification emails.
  notifyEmails?: string | null;
  // Phase I #5 v2 (2026-09-14): per-link outbound webhook. All nullable
  // — omitting means no webhook fires for this link. `webhookSecret`
  // is auto-generated on create if `webhookUrl` is set and secret is
  // empty (see createPaymentLink below).
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  webhookTemplate?: string | null;
  webhookEvents?: string[];
  webhookContentType?: string;
  webhookEnabled?: boolean;
  createdByMembershipId?: string | null;
  // Optional user-requested slug; will be sanitized + collision-checked.
  customSlug?: string | null;
}

export interface UpdatePaymentLinkInput {
  nickname?: string;
  status?: "active" | "disabled";
  // ISO 4217 currency code (CAD/USD/EUR/GBP/INR/AED/...). Uppercased +
  // sliced to 3 chars server-side. Was missing until 2026-09-19 — edits
  // that changed the currency were silently dropped.
  currency?: string;
  unitAmountCents?: number | null;
  qtyLocked?: boolean;
  qtyDefault?: number;
  qtyMin?: number;
  qtyMax?: number | null;
  // Phase I #12 (2026-09-22): editable amount at pay time.
  amountLocked?: boolean;
  amountMinCents?: number | null;
  amountMaxCents?: number | null;
  partnerRef?: string | null;
  partnerDisplayName?: string | null;
  partnerLogoUrl?: string | null;
  redirectUrl?: string | null;
  expiresAt?: Date | null;
  maxUses?: number | null;
  requireName?: boolean;
  requirePhone?: boolean;
  requireCompany?: boolean;
  descriptionOverride?: string | null;
  // Phase I #3: comma-separated partner notification emails.
  notifyEmails?: string | null;
  // Phase I #5 v2: per-link webhook fields. Any explicit `undefined`
  // means "don't change"; explicit `null` clears (for url/secret/template).
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  webhookTemplate?: string | null;
  webhookEvents?: string[];
  webhookContentType?: string;
  webhookEnabled?: boolean;
}

export interface CheckoutCustomer {
  email: string;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
  address?: string | null;
}

export interface CheckoutRequest {
  /**
   * Phase I #12 (2026-09-22): customer-supplied amount override for
   * "editable amount" links. Ignored when link.amountLocked = true.
   * Server clamps to [amountMinCents, amountMaxCents] if bounds set.
   */
  unitAmountOverrideCents?: number | null;
  slug: string;
  quantity: number;
  customer: CheckoutCustomer;
  acceptedTermsVersion?: string | null;
  // For attribution when the URL/link doesn't already carry one, e.g.
  // downstream analytics tags forwarded by the partner's own site.
  attributionOverride?: string | null;
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/1/l/o/i confusion

function randomSlug(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SLUG_ALPHABET.charAt(Math.floor(Math.random() * SLUG_ALPHABET.length));
  }
  return out;
}

function sanitizeCustomSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function generateUniqueSlug(preferred?: string | null): Promise<string> {
  if (preferred) {
    const cleaned = sanitizeCustomSlug(preferred);
    if (cleaned.length >= 3) {
      const existing = await prisma.supplierPaymentLink.findUnique({
        where: { shortSlug: cleaned },
        select: { id: true },
      });
      if (!existing) return cleaned;
      // Fall through to random generation with the cleaned slug as prefix.
      for (let i = 0; i < 5; i++) {
        const candidate = `${cleaned}-${randomSlug(4)}`.slice(0, 48);
        const clash = await prisma.supplierPaymentLink.findUnique({
          where: { shortSlug: candidate },
          select: { id: true },
        });
        if (!clash) return candidate;
      }
    }
  }
  // Pure random with retries.
  for (let i = 0; i < 8; i++) {
    const candidate = randomSlug(8 + Math.floor(i / 2));
    const clash = await prisma.supplierPaymentLink.findUnique({
      where: { shortSlug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new Error("Could not generate a unique payment-link slug after 8 tries");
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createPaymentLink(input: CreatePaymentLinkInput) {
  // Validation
  if (input.mode === "subscription") {
    if (!input.interval || !["day", "week", "month", "year"].includes(input.interval)) {
      throw new Error("Subscription links require an interval (day/week/month/year)");
    }
  } else if (input.mode !== "one_time") {
    throw new Error(`Unknown payment link mode: ${input.mode}`);
  }

  // If productId given, verify it belongs to the same tenant. Prevents a
  // supplier from creating a link that points at another supplier's product.
  if (input.productId) {
    const product = await prisma.supplierProduct.findUnique({
      where: { id: input.productId },
      select: { supplierTenantId: true, isActive: true, name: true },
    });
    if (!product || product.supplierTenantId !== input.supplierTenantId) {
      throw new Error("Product not found for this supplier");
    }
    if (!product.isActive) {
      throw new Error(`Product "${product.name}" is inactive — reactivate it before creating a link`);
    }
  } else if (input.unitAmountCents == null) {
    throw new Error("Either a productId or an explicit unitAmountCents is required");
  }

  const qtyDefault = input.qtyDefault ?? 1;
  const qtyMin = input.qtyMin ?? 1;
  const qtyMax = input.qtyMax ?? null;
  if (qtyMin < 1) throw new Error("qtyMin must be at least 1");
  if (qtyDefault < qtyMin) throw new Error("qtyDefault must be >= qtyMin");
  if (qtyMax != null && qtyDefault > qtyMax) throw new Error("qtyDefault must be <= qtyMax");
  if (qtyMax != null && qtyMax < qtyMin) throw new Error("qtyMax must be >= qtyMin");

  // Phase I #12 (2026-09-22): editable amount bounds sanity check.
  const amountLocked   = input.amountLocked ?? true;
  const amountMinCents = input.amountMinCents ?? null;
  const amountMaxCents = input.amountMaxCents ?? null;
  if (amountMinCents != null && amountMinCents < 0) {
    throw new Error("amountMinCents must be >= 0");
  }
  if (amountMaxCents != null && amountMaxCents < 0) {
    throw new Error("amountMaxCents must be >= 0");
  }
  if (amountMinCents != null && amountMaxCents != null && amountMinCents > amountMaxCents) {
    throw new Error("amountMinCents must be <= amountMaxCents");
  }

  const shortSlug = await generateUniqueSlug(input.customSlug);

  return prisma.supplierPaymentLink.create({
    data: {
      supplierTenantId: input.supplierTenantId,
      productId: input.productId ?? null,
      nickname: input.nickname.trim().slice(0, 120),
      shortSlug,
      mode: input.mode,
      interval: input.mode === "subscription" ? input.interval! : null,
      intervalCount:
        input.mode === "subscription" ? Math.max(1, input.intervalCount ?? 1) : null,
      unitAmountCents: input.unitAmountCents ?? null,
      currency: (input.currency ?? "CAD").toUpperCase().slice(0, 3),
      qtyLocked: input.qtyLocked ?? true,
      qtyDefault,
      qtyMin,
      qtyMax,
      amountLocked,
      amountMinCents,
      amountMaxCents,
      partnerRef: input.partnerRef?.trim().slice(0, 120) || null,
      partnerDisplayName: input.partnerDisplayName?.trim().slice(0, 255) || null,
      partnerLogoUrl: input.partnerLogoUrl?.trim().slice(0, 1000) || null,
      redirectUrl: input.redirectUrl?.trim().slice(0, 1000) || null,
      expiresAt: input.expiresAt ?? null,
      maxUses: input.maxUses ?? null,
      requireName: input.requireName ?? true,
      requirePhone: input.requirePhone ?? false,
      requireCompany: input.requireCompany ?? false,
      descriptionOverride: input.descriptionOverride?.trim() || null,
      notifyEmails: sanitizeNotifyEmails(input.notifyEmails),
      // Phase I #5 v3 (2026-09-14): partner supplies their own secret
      // (we NEVER generate). If they leave it empty we skip HMAC
      // signing entirely — URL-token flows (TradingView-style) still
      // work. Persist whatever they typed, trimmed + length-capped.
      webhookUrl: input.webhookUrl?.trim().slice(0, 1000) || null,
      webhookSecret: input.webhookUrl?.trim()
        ? input.webhookSecret?.trim().slice(0, 128) || null
        : null,
      webhookTemplate: input.webhookUrl?.trim() ? input.webhookTemplate ?? null : null,
      webhookEvents: input.webhookEvents
        ? input.webhookEvents.filter((e) => ALLOWED_WEBHOOK_EVENTS.has(e))
        : [],
      webhookContentType: input.webhookContentType?.trim() || "application/json",
      webhookEnabled: input.webhookEnabled ?? true,
      createdByMembershipId: input.createdByMembershipId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Phase I #3 helpers — comma-separated partner notification emails.
// Kept close to the CRUD code so both create + update reuse the same
// normalisation (lowercase, trim, dedupe, drop malformed entries).
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeNotifyEmails(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const parts = raw
    .split(/[,;\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p && EMAIL_RE.test(p));
  if (parts.length === 0) return null;
  // Dedupe, preserving first-seen order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  const joined = out.join(", ");
  return joined.length > 1000 ? joined.slice(0, 1000) : joined;
}

/** Parse a stored notify_emails string back into an array. Public so the
 * webhook / on-success endpoints can iterate recipients. */
export function parseNotifyEmails(stored: string | null | undefined): string[] {
  if (!stored) return [];
  return stored
    .split(/[,;\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p && EMAIL_RE.test(p));
}

export async function listPaymentLinks(
  supplierTenantId: string,
  filter: { status?: string; productId?: string; partnerRef?: string } = {}
) {
  const where: Prisma.SupplierPaymentLinkWhereInput = { supplierTenantId };
  if (filter.status) where.status = filter.status;
  if (filter.productId) where.productId = filter.productId;
  if (filter.partnerRef) where.partnerRef = filter.partnerRef;

  return prisma.supplierPaymentLink.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      product: { select: { id: true, name: true, unitLabel: true } },
      _count: { select: { invoices: true } },
    },
  });
}

export async function getPaymentLink(supplierTenantId: string, id: string) {
  const link = await prisma.supplierPaymentLink.findUnique({
    where: { id },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          unitLabel: true,
          wholesalePriceCents: true,
          priceCurrency: true,
          description: true,
        },
      },
      _count: { select: { invoices: true } },
    },
  });
  if (!link || link.supplierTenantId !== supplierTenantId) return null;
  return link;
}

export async function updatePaymentLink(
  supplierTenantId: string,
  id: string,
  input: UpdatePaymentLinkInput
) {
  const existing = await prisma.supplierPaymentLink.findUnique({
    where: { id },
    select: {
      supplierTenantId: true,
      qtyMin: true, qtyMax: true, qtyDefault: true,
      amountMinCents: true, amountMaxCents: true,
    },
  });
  if (!existing || existing.supplierTenantId !== supplierTenantId) {
    throw new Error("Payment link not found");
  }

  const data: Prisma.SupplierPaymentLinkUpdateInput = {};
  if (input.nickname !== undefined) data.nickname = input.nickname.trim().slice(0, 120);
  if (input.status !== undefined) {
    if (!["active", "disabled"].includes(input.status)) {
      throw new Error(`Invalid status: ${input.status}`);
    }
    data.status = input.status;
  }
  if (input.unitAmountCents !== undefined) data.unitAmountCents = input.unitAmountCents;
  if (input.currency !== undefined) {
    const cleaned = input.currency.trim().toUpperCase().slice(0, 3);
    if (!/^[A-Z]{3}$/.test(cleaned)) {
      throw new Error("currency must be a 3-letter ISO 4217 code");
    }
    data.currency = cleaned;
  }

  // Quantity fields — validate the resulting triple stays consistent.
  const nextMin = input.qtyMin ?? existing.qtyMin;
  const nextMax = input.qtyMax !== undefined ? input.qtyMax : existing.qtyMax;
  const nextDefault = input.qtyDefault ?? existing.qtyDefault;
  if (nextMin < 1) throw new Error("qtyMin must be at least 1");
  if (nextDefault < nextMin) throw new Error("qtyDefault must be >= qtyMin");
  if (nextMax != null && nextDefault > nextMax) throw new Error("qtyDefault must be <= qtyMax");
  if (nextMax != null && nextMax < nextMin) throw new Error("qtyMax must be >= qtyMin");
  if (input.qtyLocked !== undefined) data.qtyLocked = input.qtyLocked;
  if (input.qtyDefault !== undefined) data.qtyDefault = input.qtyDefault;

  // Phase I #12 (2026-09-22): editable amount bounds — validate the
  // resulting min/max stays consistent.
  const nextAmountMin =
    input.amountMinCents !== undefined ? input.amountMinCents : existing.amountMinCents;
  const nextAmountMax =
    input.amountMaxCents !== undefined ? input.amountMaxCents : existing.amountMaxCents;
  if (nextAmountMin != null && nextAmountMin < 0) throw new Error("amountMinCents must be >= 0");
  if (nextAmountMax != null && nextAmountMax < 0) throw new Error("amountMaxCents must be >= 0");
  if (nextAmountMin != null && nextAmountMax != null && nextAmountMin > nextAmountMax) {
    throw new Error("amountMinCents must be <= amountMaxCents");
  }
  if (input.amountLocked !== undefined) data.amountLocked = input.amountLocked;
  if (input.amountMinCents !== undefined) data.amountMinCents = input.amountMinCents;
  if (input.amountMaxCents !== undefined) data.amountMaxCents = input.amountMaxCents;
  if (input.qtyMin !== undefined) data.qtyMin = input.qtyMin;
  if (input.qtyMax !== undefined) data.qtyMax = input.qtyMax;

  if (input.partnerRef !== undefined) data.partnerRef = input.partnerRef;
  if (input.partnerDisplayName !== undefined) data.partnerDisplayName = input.partnerDisplayName;
  if (input.partnerLogoUrl !== undefined) data.partnerLogoUrl = input.partnerLogoUrl;
  if (input.redirectUrl !== undefined) data.redirectUrl = input.redirectUrl;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
  if (input.maxUses !== undefined) data.maxUses = input.maxUses;
  if (input.requireName !== undefined) data.requireName = input.requireName;
  if (input.requirePhone !== undefined) data.requirePhone = input.requirePhone;
  if (input.requireCompany !== undefined) data.requireCompany = input.requireCompany;
  if (input.descriptionOverride !== undefined)
    data.descriptionOverride = input.descriptionOverride;
  if (input.notifyEmails !== undefined)
    data.notifyEmails = sanitizeNotifyEmails(input.notifyEmails);

  // Phase I #5 v2 (2026-09-14): webhook fields. Same "undefined = skip,
  // explicit value = write" pattern as everything else here. Auto-mint
  // a secret when the URL is being set for the first time on this link
  // (i.e. current value is null and caller supplied a URL without a
  // secret). Callers can rotate the secret by passing a new string.
  if (input.webhookUrl !== undefined) {
    const trimmed = input.webhookUrl?.trim() || null;
    data.webhookUrl = trimmed ? trimmed.slice(0, 1000) : null;
    // Phase I #5 v3 (2026-09-14): no auto-generation. Partner types
    // their own secret (or leaves empty). If URL is cleared entirely
    // we also clear the stored secret — no orphan values.
    if (!trimmed) data.webhookSecret = null;
  }
  if (input.webhookSecret !== undefined) {
    data.webhookSecret = input.webhookSecret?.trim().slice(0, 128) || null;
  }
  if (input.webhookTemplate !== undefined) {
    data.webhookTemplate = input.webhookTemplate ?? null;
  }
  if (input.webhookEvents !== undefined) {
    data.webhookEvents = input.webhookEvents.filter((e) =>
      ALLOWED_WEBHOOK_EVENTS.has(e)
    );
  }
  if (input.webhookContentType !== undefined) {
    data.webhookContentType =
      input.webhookContentType.trim() || "application/json";
  }
  if (input.webhookEnabled !== undefined) {
    data.webhookEnabled = input.webhookEnabled;
  }

  return prisma.supplierPaymentLink.update({
    where: { id },
    data,
  });
}

export async function disablePaymentLink(supplierTenantId: string, id: string) {
  const link = await prisma.supplierPaymentLink.findUnique({
    where: { id },
    select: { supplierTenantId: true },
  });
  if (!link || link.supplierTenantId !== supplierTenantId) {
    throw new Error("Payment link not found");
  }
  return prisma.supplierPaymentLink.update({
    where: { id },
    data: { status: "disabled" },
  });
}

// ---------------------------------------------------------------------------
// Public resolution — the /l/[slug] page + POST /checkout endpoint
// ---------------------------------------------------------------------------

/**
 * Resolve a public slug to a link plus its product snapshot. Returns null
 * if the slug doesn't exist. Callers should still check status / expiry /
 * usage — this fn returns the raw record so the caller can produce
 * accurate error messages ("expired" vs "disabled" vs "at capacity").
 */
export async function resolveLinkBySlug(slug: string) {
  if (!slug || typeof slug !== "string") return null;
  const cleaned = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48);
  if (!cleaned) return null;

  const link = await prisma.supplierPaymentLink.findUnique({
    where: { shortSlug: cleaned },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          unitLabel: true,
          description: true,
          wholesalePriceCents: true,
          priceCurrency: true,
          isActive: true,
        },
      },
      supplier: {
        select: {
          id: true,
          name: true,
          supplierProfile: {
            select: {
              displayName: true,
              legalName: true,
            },
          },
          settings: {
            select: {
              brandName: true,
              brandLogoUrl: true,
              brandFaviconUrl: true,
              // Phase I #14 (2026-09-23): honour the tenant's
              // powered_by_visible flag to hide MEGO chrome on the
              // /l/[slug] checkout page when the supplier has opted out.
              poweredByVisible: true,
              // 2026-10-06: per-tenant preferred payment method
              // (reorders the Stripe PaymentElement accordion).
              preferredPaymentMethod: true,
            },
          },
        },
      },
    },
  });
  return link;
}

export type LinkAvailability =
  | { ok: true }
  | { ok: false; reason: "disabled" | "expired" | "at_capacity" | "product_inactive" };

export function checkLinkAvailability(link: {
  status: string;
  expiresAt: Date | null;
  maxUses: number | null;
  currentUses: number;
  product: { isActive: boolean } | null;
}): LinkAvailability {
  if (link.status !== "active") return { ok: false, reason: "disabled" };
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (link.maxUses != null && link.currentUses >= link.maxUses) {
    return { ok: false, reason: "at_capacity" };
  }
  if (link.product && !link.product.isActive) {
    return { ok: false, reason: "product_inactive" };
  }
  return { ok: true };
}

/**
 * Resolve final quantity given a link's config and the URL param.
 *
 * Rule of thumb (matches the design decision from the spec discussion):
 *   • URL ?qty=N always wins — clamp to [min, max] and use it.
 *   • Otherwise use the link's qty_default.
 *   • Whether the checkout UI shows a stepper or a locked label is a
 *     separate question (link.qtyLocked + URL-param-presence), handled
 *     on the client. This fn only returns the effective NUMBER.
 */
export function resolveQuantity(
  link: {
    qtyDefault: number;
    qtyMin: number;
    qtyMax: number | null;
  },
  urlQty: number | null
): number {
  const requested = urlQty ?? link.qtyDefault;
  const min = Math.max(1, link.qtyMin);
  const max = link.qtyMax ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(requested) || requested <= 0) return min;
  return Math.max(min, Math.min(max, Math.floor(requested)));
}

/**
 * Create a SupplierInvoice from a payment-link template + customer input.
 *
 * Returns the newly-created invoice. Caller is expected to redirect the
 * customer to /pay/invoice/[invoice.id] which triggers the existing
 * processor flow.
 *
 * NOTE (Phase I #1 scope): one_time mode is fully wired. Subscription
 * mode creates the invoice with the sub metadata attached but does NOT
 * yet create the parent SupplierSubscription row — that's a Phase I #2
 * follow-up. Marked with a TODO below.
 */
export async function createInvoiceFromLink(req: CheckoutRequest) {
  const link = await resolveLinkBySlug(req.slug);
  if (!link) throw new Error("Payment link not found");

  const availability = checkLinkAvailability(link);
  if (!availability.ok) {
    throw new Error(`Link unavailable: ${availability.reason}`);
  }

  // Resolve the numeric fields — qty already sanitized by caller, but we
  // clamp again server-side as belt & braces.
  const qty = resolveQuantity(link, req.quantity);

  // Unit amount comes from the link override, else the product's price.
  const defaultUnitAmountCents =
    link.unitAmountCents ??
    (link.product ? link.product.wholesalePriceCents : null);
  if (defaultUnitAmountCents == null) {
    throw new Error("Link has no price and no product to inherit from");
  }

  // Phase I #12 (2026-09-22): honor customer override when the link
  // has amountLocked=false. Server clamps to [min,max] as belt-and-
  // braces on top of the client-side validation.
  let unitAmountCents = defaultUnitAmountCents;
  if (!link.amountLocked && req.unitAmountOverrideCents != null) {
    const raw = Math.floor(Number(req.unitAmountOverrideCents));
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new Error("Amount must be a positive integer (cents)");
    }
    const min = link.amountMinCents ?? 1;
    const max = link.amountMaxCents ?? Number.MAX_SAFE_INTEGER;
    if (raw < min) throw new Error(`Amount must be at least ${min} cents`);
    if (raw > max) throw new Error(`Amount must be at most ${max} cents`);
    unitAmountCents = raw;
  }
  const subtotalCents = unitAmountCents * qty;

  // Product snapshot for the invoice item.
  const productName =
    link.product?.name || link.nickname || "Payment link purchase";
  const productDescription =
    link.descriptionOverride || link.product?.description || null;
  const unitLabel = link.product?.unitLabel || "unit";

  // Invoice numbering follows the same scheme as portal-created invoices:
  // per-supplier sequence "INV-YYYY-NNNN". Grabs the current year's max
  // number in a transaction to avoid two concurrent clicks landing the
  // same number.
  const invoice = await prisma.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const latest = await tx.supplierInvoice.findFirst({
      where: {
        supplierTenantId: link.supplierTenantId,
        invoiceNumber: { startsWith: prefix },
      },
      orderBy: { invoiceNumber: "desc" },
      select: { invoiceNumber: true },
    });
    const nextSeq = latest
      ? Number(latest.invoiceNumber.slice(prefix.length)) + 1
      : 1;
    const invoiceNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;

    const created = await tx.supplierInvoice.create({
      data: {
        supplierTenantId: link.supplierTenantId,
        invoiceNumber,
        status: "SENT",
        customerName: (req.customer.name || req.customer.email).trim(),
        customerEmail: req.customer.email.trim().toLowerCase(),
        customerPhone: req.customer.phone?.trim() || null,
        customerCompany: req.customer.company?.trim() || null,
        customerAddress: req.customer.address?.trim() || null,
        currency: link.currency,
        subtotalCents,
        taxCents: 0, // Phase I #2 TODO: apply tenant tax settings
        totalCents: subtotalCents,
        notes: null,
        paymentStatus: "UNPAID",
        termsVersion: req.acceptedTermsVersion || null,
        paymentLinkId: link.id,
        paymentLinkPartnerRef: req.attributionOverride || link.partnerRef || null,
        items: {
          create: [
            {
              productId: link.productId,
              productName,
              productDescription,
              unitLabel,
              quantity: qty,
              unitPriceCents: unitAmountCents,
              lineTotalCents: subtotalCents,
              sortOrder: 0,
            },
          ],
        },
      },
    });

    // Bump the link's usage counter atomically.
    await tx.supplierPaymentLink.update({
      where: { id: link.id },
      data: { currentUses: { increment: 1 } },
    });

    return created;
  });

  // TODO(Phase I #2): if link.mode === "subscription", spin up a
  // SupplierSubscription row + link this invoice as the first sequence.
  // For now the invoice is a one-off; recurring billing hasn't kicked in.

  return invoice;
}
