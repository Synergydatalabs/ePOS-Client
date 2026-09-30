// Server-side tax resolver.
//
// Given an order's items + location + settings fallback, computes the
// tax owed on each line item and the aggregate. The rate for each item
// is resolved in strict priority order:
//
//   1. LocationTaxRate for (locationId, product.taxCategoryId)
//      — used when a US-multi-store tenant charges different rates per
//        state for the same category.
//   2. TaxCategory.ratePercent (the category's default)
//   3. TenantSettings.taxRate — legacy single-rate fallback for products
//      that predate categories.
//
// Discount handling: the caller passes `discountAmount` and the resolver
// spreads it proportionally across taxable line items before applying
// rates, so tax is charged on the discounted portion only. This matches
// how POS pages compute the display total.
//
// All amounts are in cents. Percentages are stored as Decimal in the DB
// but arrive here as strings — parseFloat is safe for the 0..100 range.

import prisma from "./prisma";

interface LineItemInput {
  productId: string;
  quantity: number;
  /** unitPrice + modifiersTotal for this line, in cents. */
  lineSubtotal: number;
}

interface ResolveInput {
  tenantId: string;
  locationId: string;
  items: LineItemInput[];
  /** Total cart discount to apply proportionally. */
  discountAmount?: number;
  /** Legacy default (Tenant settings). */
  fallbackRatePercent?: number;
}

export interface ResolvedLineTax {
  productId: string;
  taxableAmount: number; // cents (post-discount)
  ratePercent: number;
  taxAmount: number; // cents
}

export interface ResolvedTax {
  totalTax: number;
  lines: ResolvedLineTax[];
}

export async function resolveTax({
  tenantId,
  locationId,
  items,
  discountAmount = 0,
  fallbackRatePercent = 0,
}: ResolveInput): Promise<ResolvedTax> {
  if (items.length === 0) {
    return { totalTax: 0, lines: [] };
  }

  // Load categories for all involved products in one round-trip, plus
  // location overrides for those categories at this location.
  const productIds = items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, taxCategoryId: true, taxCategory: { select: { ratePercent: true } } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const categoryIds = Array.from(
    new Set(
      products
        .map((p) => p.taxCategoryId)
        .filter((v): v is string => Boolean(v))
    )
  );

  const overrides =
    categoryIds.length > 0
      ? await prisma.locationTaxRate.findMany({
          where: {
            locationId,
            taxCategoryId: { in: categoryIds },
          },
          select: { taxCategoryId: true, ratePercent: true },
        })
      : [];
  const overrideByCategory = new Map(
    overrides.map((o) => [o.taxCategoryId, Number(o.ratePercent)])
  );

  // Sum of line subtotals so we can spread the cart discount proportionally.
  const cartSubtotal = items.reduce((s, i) => s + i.lineSubtotal, 0);

  const lines: ResolvedLineTax[] = items.map((item) => {
    // Proportional discount on this line — spread by revenue share.
    const share =
      cartSubtotal > 0 ? item.lineSubtotal / cartSubtotal : 0;
    const lineDiscount = Math.round(discountAmount * share);
    const taxable = Math.max(0, item.lineSubtotal - lineDiscount);

    const p = productById.get(item.productId);
    let rate = fallbackRatePercent;
    if (p?.taxCategoryId) {
      if (overrideByCategory.has(p.taxCategoryId)) {
        rate = overrideByCategory.get(p.taxCategoryId)!;
      } else if (p.taxCategory) {
        rate = Number(p.taxCategory.ratePercent);
      }
    }

    // Rounded per-line so the sum matches what the POS shows on the receipt.
    const taxAmount = Math.round((taxable * rate) / 100);

    return {
      productId: item.productId,
      taxableAmount: taxable,
      ratePercent: rate,
      taxAmount,
    };
  });

  const totalTax = lines.reduce((s, l) => s + l.taxAmount, 0);
  return { totalTax, lines };
}
