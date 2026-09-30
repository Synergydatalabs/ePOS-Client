// =============================================================================
// Phase F #2 (2026-08-27) — Supplier-issued invoice service layer.
//
// Everything a supplier-issued invoice does at the model layer lives here
// so the HTTP endpoints stay skinny:
//   • generateInvoiceNumber  — INV-YYYY-NNNN, sequential per supplier
//   • computeTotals          — subtotal/tax/total from line items in cents
//   • createSupplierInvoice  — full create in a transaction (invoice + items
//                              + payment link URL stub)
//   • listSupplierInvoices   — supplier's own invoices, newest first
//   • getSupplierInvoice     — one invoice + items (supplier-scoped)
//   • getPublicInvoice       — read shape for the customer pay page (safe
//                              subset: no membership audit fields, includes
//                              supplier brand for skinning the page)
//   • cancelSupplierInvoice  — soft-cancel (status=CANCELLED)
//
// The payment link is a placeholder until Phase 4 (Stripe wiring). The
// service returns a "mock" pay URL that opens our own /pay/invoice/[id]
// page — that page renders the invoice + a mock "Pay now" button in Phase
// 2, and swaps to Stripe Checkout Session redirect in Phase 4.
// =============================================================================

import prisma from "@/lib/prisma";

// --- Types -------------------------------------------------------------------

export interface InvoiceLineInput {
  /** Optional — snapshot FK; null if the supplier types a free-form line. */
  productId?: string | null;
  productName: string;
  productDescription?: string | null;
  unitLabel?: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CreateInvoiceInput {
  supplierTenantId: string;
  createdByMembershipId?: string | null;

  customerName: string;
  customerEmail: string;
  // Phase F #6k (2026-08-28): optional additional recipients on the invoice
  // notification email. Stored on the invoice row so the supplier can rerun
  // Resend with the same CC set (or override per resend).
  customerCcEmails?: string[];
  customerPhone?: string | null;
  customerCompany?: string | null;
  customerAddress?: string | null;

  currency: string;
  taxCents?: number;
  notes?: string | null;

  lines: InvoiceLineInput[];
}

// --- Invoice numbering -------------------------------------------------------

/**
 * INV-YYYY-NNNN, sequential per supplier. Simple year-scoped counter
 * — supplier's first invoice of 2026 is INV-2026-0001. Race safety is
 * covered by the compound UNIQUE (supplier_tenant_id, invoice_number) —
 * a duplicate throws P2002 which the caller retries.
 */
export async function generateInvoiceNumber(supplierTenantId: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `INV-${year}-`;

  const latest = await prisma.supplierInvoice.findFirst({
    where: {
      supplierTenantId,
      invoiceNumber: { startsWith: prefix },
    },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });

  const nextSeq = latest
    ? (parseInt(latest.invoiceNumber.slice(prefix.length), 10) || 0) + 1
    : 1;

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

// --- Money -------------------------------------------------------------------

export function computeTotals(
  lines: InvoiceLineInput[],
  taxCents: number = 0
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = lines.reduce(
    (sum, l) => sum + Math.max(0, Math.round(l.quantity)) * Math.max(0, Math.round(l.unitPriceCents)),
    0
  );
  const clampedTax = Math.max(0, Math.round(taxCents));
  return {
    subtotalCents,
    taxCents: clampedTax,
    totalCents: subtotalCents + clampedTax,
  };
}

// --- Payment link stub -------------------------------------------------------

/**
 * Returns the payment link URL for this invoice.
 *
 * Phase 2: always points at our own public pay page. That page renders the
 * invoice + a mock "Pay now" button that flips paymentStatus to PAID.
 *
 * Phase 4 (when Stripe is wired up): if the supplier has an active Stripe
 * processor row, we mint a Stripe Checkout Session and return its URL
 * instead — the pay page becomes a router that either redirects to Stripe
 * or renders the mock button depending on config.
 *
 * `origin` is derived from the incoming request in the endpoint. Kept as a
 * parameter here so the same service works locally and in prod.
 */
export function buildPaymentLinkUrl(origin: string, invoiceId: string): string {
  return `${origin.replace(/\/+$/, "")}/pay/invoice/${invoiceId}`;
}

// --- Create ------------------------------------------------------------------

export async function createSupplierInvoice(
  input: CreateInvoiceInput,
  origin: string
) {
  if (!input.lines.length) {
    throw new Error("An invoice needs at least one line item");
  }
  const { subtotalCents, taxCents, totalCents } = computeTotals(
    input.lines,
    input.taxCents ?? 0
  );
  if (totalCents <= 0) {
    throw new Error("Invoice total must be greater than zero");
  }

  // Retry once on invoice-number race — extremely rare (two supplier
  // sessions creating an invoice in the same tick) but harmless to guard.
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const invoiceNumber = await generateInvoiceNumber(input.supplierTenantId);
    try {
      return await prisma.$transaction(async (tx) => {
        const invoice = await tx.supplierInvoice.create({
          data: {
            supplierTenantId: input.supplierTenantId,
            invoiceNumber,
            status: "SENT",
            customerName: input.customerName.trim(),
            customerEmail: input.customerEmail.trim().toLowerCase(),
            customerCcEmails: (input.customerCcEmails || [])
              .map((e) => e.trim().toLowerCase())
              .filter((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
              .filter((e, i, arr) => arr.indexOf(e) === i), // dedup
            customerPhone: input.customerPhone?.trim() || null,
            customerCompany: input.customerCompany?.trim() || null,
            customerAddress: input.customerAddress?.trim() || null,
            currency: input.currency.toUpperCase(),
            subtotalCents,
            taxCents,
            totalCents,
            notes: input.notes?.trim() || null,
            createdByMembershipId: input.createdByMembershipId ?? null,
            items: {
              create: input.lines.map((l, i) => ({
                productId: l.productId ?? null,
                productName: l.productName.trim(),
                productDescription: l.productDescription?.trim() || null,
                unitLabel: (l.unitLabel?.trim() || "unit").slice(0, 50),
                quantity: Math.max(1, Math.round(l.quantity)),
                unitPriceCents: Math.max(0, Math.round(l.unitPriceCents)),
                lineTotalCents:
                  Math.max(1, Math.round(l.quantity)) *
                  Math.max(0, Math.round(l.unitPriceCents)),
                sortOrder: i,
              })),
            },
          },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });

        // Now that we have the invoice id, fill in the payment link URL.
        // Update instead of doing this in the initial create because the
        // URL depends on the freshly-generated id.
        const paymentLinkUrl = buildPaymentLinkUrl(origin, invoice.id);
        const withLink = await tx.supplierInvoice.update({
          where: { id: invoice.id },
          data: { paymentLinkUrl },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
        return withLink;
      });
    } catch (err: any) {
      // P2002 = unique constraint (invoice_number race). Retry with a
      // fresh number.
      if (err?.code === "P2002" && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }
  throw new Error("Failed to allocate a unique invoice number after retries");
}

// --- Reads -------------------------------------------------------------------

export async function listSupplierInvoices(
  supplierTenantId: string,
  opts: { status?: string; limit?: number; cursor?: string } = {}
) {
  const where: {
    supplierTenantId: string;
    status?: string;
  } = { supplierTenantId };
  if (opts.status) where.status = opts.status;

  return prisma.supplierInvoice.findMany({
    where,
    orderBy: { sentAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      paymentStatus: true,
      currency: true,
      totalCents: true,
      customerName: true,
      customerEmail: true,
      sentAt: true,
      paidAt: true,
      emailSentAt: true,
    },
  });
}

/**
 * #6u: extract the invoice's vendor info from any line-item shape that
 * carries `product` vendor fields (via getSupplierInvoice or getPublicInvoice's
 * include). Returns null when no line item has a vendor attached — callers
 * pass that null through and the email/pay page falls back to hub-branded.
 */
export function resolveInvoiceVendor(
  items: Array<{
    product?: {
      vendorName: string | null;
      vendorLogoUrl?: string | null;
      vendorBrandColor?: string | null;
      vendorLegalName?: string | null;
      vendorLicenseText?: string | null;
      vendorStatementDescriptor?: string | null;
      vendorSupportEmail?: string | null;
    } | null;
  }>
): {
  name: string;
  logoUrl: string | null;
  brandColor: string;
  legalName: string | null;
  licenseText: string | null;
  statementDescriptor: string | null;
  supportEmail: string | null;
} | null {
  const p = items.map((it) => it.product).find((x) => x && x.vendorName);
  if (!p || !p.vendorName) return null;
  return {
    name: p.vendorName,
    logoUrl: p.vendorLogoUrl ?? null,
    brandColor: p.vendorBrandColor || "#006AFE",
    legalName: p.vendorLegalName ?? null,
    licenseText: p.vendorLicenseText ?? null,
    statementDescriptor: p.vendorStatementDescriptor ?? null,
    supportEmail: p.vendorSupportEmail ?? null,
  };
}

export async function getSupplierInvoice(
  supplierTenantId: string,
  invoiceId: string
) {
  return prisma.supplierInvoice.findFirst({
    where: { id: invoiceId, supplierTenantId },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        // #6u: pull vendor fields off each line's product so the invoice
        // email can render the vendor's brand (MegoPay = Deep Navy hero,
        // Electric Blue CTA, parent endorsement) when set.
        include: {
          product: {
            select: {
              vendorName: true,
              vendorLogoUrl: true,
              vendorBrandColor: true,
              vendorLegalName: true,
              vendorLicenseText: true,
              vendorStatementDescriptor: true,
              vendorSupportEmail: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Public read used by the customer pay page. No auth — pay-link URL is
 * the capability. Returns supplier branding so the page can skin itself.
 */
export async function getPublicInvoice(invoiceId: string) {
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      // Phase F #6r (2026-08-29): include the linked product's vendor
      // fields on each line item so the pay page can render a vendor
      // branding strip ("MegoPay by hub") when set.
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          product: {
            select: {
              vendorName: true,
              vendorLogoUrl: true,
              vendorWebsiteUrl: true,
              vendorSupportEmail: true,
              vendorBrandColor: true,
              vendorLegalName: true,
              vendorLicenseText: true,
              vendorStatementDescriptor: true,
            },
          },
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
              contactEmail: true,
              contactPhone: true,
              websiteUrl: true,
            },
          },
          settings: {
            select: {
              brandName: true,
              brandLogoUrl: true,
              brandPrimaryColor: true,
              brandAccentColor: true,
              brandBackgroundColor: true,
              // Phase I #14 (2026-09-23): drives the "hide MEGO chrome"
              // toggle on the pay page (footer wordmark + "What is hub?"
              // link + trust chips row).
              poweredByVisible: true,
              // Phase I #15 (2026-09-26): drives whether /pay/embed/[id]
              // is allowed to render for this tenant's invoices.
              iframeEnabled: true,
            },
          },
        },
      },
    },
  });
  return invoice;
}

// --- Cancel ------------------------------------------------------------------

export async function cancelSupplierInvoice(
  supplierTenantId: string,
  invoiceId: string,
  cancelledByMembershipId: string | null,
  reason?: string | null
) {
  const invoice = await prisma.supplierInvoice.findFirst({
    where: { id: invoiceId, supplierTenantId },
    select: { id: true, status: true, paymentStatus: true },
  });
  if (!invoice) return null;
  if (invoice.paymentStatus === "PAID") {
    throw new Error("Cannot cancel a paid invoice — issue a refund instead");
  }
  if (invoice.status === "CANCELLED") {
    return invoice;
  }
  return prisma.supplierInvoice.update({
    where: { id: invoiceId },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByMembershipId,
      cancellationReason: reason?.trim() || null,
    },
  });
}
