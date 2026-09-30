// Server-side totals recomputation for mobile orders.
//
// Any endpoint that mutates an order's items (add / update qty / remove)
// or applies a discount / tip / surcharge must call recomputeOrderTotals()
// so the client sees consistent numbers.
//
// The math mirrors what the web POS does at order-create time in
// C:\Mod App\tap-app\src\app\api\tenants\[tenantId]\orders\route.ts:
//
//   subtotal      = sum of (unitPrice * qty + modifiersTotal) per line
//   taxAmount     = resolveTax() — per-line, category + location aware
//   tax2Amount    = flat percent of (subtotal - discount) if enabled
//   total         = subtotal - discount + taxAmount + tax2Amount
//                 + tipAmount + surchargeAmount
//
// Discount / tip / surcharge come from the current order row — this helper
// only recomputes the derived fields. Mutating discount/tip is a separate
// PATCH on the order itself.
//
// All amounts are cents (Int).

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { resolveTax } from "@/lib/tax-resolver";

type PrismaClientOrTx = Prisma.TransactionClient | typeof prisma;

export interface RecomputedTotals {
  subtotal: number;
  taxAmount: number;
  tax2Amount: number;
  total: number;
}

/**
 * Fetch the order's items + settings, compute the four derived amounts,
 * and (unless `dryRun`) write them back to the order row.
 *
 * Returns the fresh totals so the caller can include them in its response
 * without a second round-trip.
 */
export async function recomputeOrderTotals(
  orderId: string,
  db: PrismaClientOrTx = prisma,
  opts: { dryRun?: boolean } = {}
): Promise<RecomputedTotals> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      discountAmount: true,
      tipAmount: true,
      surchargeAmount: true,
      locationId: true,
      location: { select: { tenantId: true } },
      items: {
        select: {
          productId: true,
          quantity: true,
          unitPrice: true,
          modifiersTotal: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const settings = await db.tenantSettings.findUnique({
    where: { tenantId: order.location.tenantId },
    select: {
      taxEnabled: true,
      taxRate: true,
      tax2Enabled: true,
      tax2Rate: true,
    },
  });

  const subtotal = order.items.reduce(
    (s, it) => s + it.unitPrice * it.quantity + (it.modifiersTotal || 0),
    0
  );

  const fallbackTaxRate = settings?.taxEnabled ? Number(settings.taxRate) : 0;
  const tax2Rate = settings?.tax2Enabled ? Number(settings.tax2Rate) : 0;
  const discount = order.discountAmount || 0;
  const tip = order.tipAmount || 0;
  const surcharge = order.surchargeAmount || 0;

  const taxResult = settings?.taxEnabled
    ? await resolveTax({
        tenantId: order.location.tenantId,
        locationId: order.locationId,
        items: order.items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          lineSubtotal: it.unitPrice * it.quantity + (it.modifiersTotal || 0),
        })),
        discountAmount: discount,
        fallbackRatePercent: fallbackTaxRate,
      })
    : { totalTax: 0, lines: [] };

  const taxableAfterDiscount = Math.max(0, subtotal - discount);
  const tax2Amount = Math.round((taxableAfterDiscount * tax2Rate) / 100);

  const total =
    subtotal - discount + taxResult.totalTax + tax2Amount + tip + surcharge;

  const totals: RecomputedTotals = {
    subtotal,
    taxAmount: taxResult.totalTax,
    tax2Amount,
    total,
  };

  if (!opts.dryRun) {
    await db.order.update({
      where: { id: orderId },
      data: totals,
    });
  }

  return totals;
}
