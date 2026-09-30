// GET /api/tenants/[tenantId]/reports/sales-tax
//   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&locationId=<uuid>&groupBy=month|day
//
// Two-level aggregation to serve both filing patterns:
//   - LOCATION rows — one per (location) — for US state sales-tax
//     returns that file per store, and for CA GST/HST returns that
//     file per business number.
//   - CATEGORY rows — one per (location × tax_category) — for CA VAT-
//     style returns that split zero-rated food from standard-rated.
//     Recomputed from OrderItems using the same rate resolution as
//     order-create (LocationTaxRate override → TaxCategory default →
//     tenant fallback) so numbers match the receipts exactly.
//
// Refunds: we prorate refund.amount over its parent order.total to
// estimate the tax portion refunded. Not perfect for split-tender
// refunds where only some payments were refunded, but matches the
// tolerance most tax filings need.
//
// Excluded from taxable sales (deliberately): tips, card surcharges,
// gift-card issuance (in-store gift-card *sales* are non-taxable in
// most jurisdictions — tax hits when the card is redeemed).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

const UNCATEGORIZED_KEY = "__uncategorized__";
const UNCATEGORIZED_LABEL = "Uncategorized (settings default)";

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get("startDate");
    const endParam = searchParams.get("endDate");
    const locationId = searchParams.get("locationId") || undefined;

    // Default window = current calendar month
    const now = new Date();
    const defaultStart = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), 1)
    );
    const defaultEnd = new Date(
      Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)
    );
    const startDate = startParam ? new Date(startParam) : defaultStart;
    const endDateRaw = endParam ? new Date(endParam) : defaultEnd;
    // Make the endDate exclusive one full day forward so 2026-07-31 covers
    // the whole 31st (accountants type inclusive dates).
    const endDate = endParam
      ? new Date(endDateRaw.getTime() + 24 * 60 * 60 * 1000)
      : endDateRaw;

    if (
      isNaN(startDate.getTime()) ||
      isNaN(endDate.getTime()) ||
      endDate <= startDate
    ) {
      return NextResponse.json(
        { error: "Invalid date range" },
        { status: 400 }
      );
    }

    // Base order filter — completed, non-cancelled orders in the window
    const orderWhere: any = {
      location: { tenantId },
      createdAt: { gte: startDate, lt: endDate },
      status: { not: "CANCELLED" },
      paymentStatus: { in: ["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"] },
      ...(locationId ? { locationId } : {}),
    };

    // Pull orders + items + payment refunds in one round-trip. We need
    // the item-level view for the category breakdown and the order-level
    // totals for the location summary.
    const orders = await prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        locationId: true,
        subtotal: true,
        taxAmount: true,
        tax2Amount: true,
        discountAmount: true,
        tipAmount: true,
        surchargeAmount: true,
        total: true,
        currency: true,
        location: { select: { id: true, name: true } },
        items: {
          select: {
            productId: true,
            itemTotal: true,
            product: {
              select: {
                taxCategoryId: true,
                taxCategory: {
                  select: { id: true, name: true, ratePercent: true },
                },
              },
            },
          },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            refunds: {
              where: { status: { notIn: ["FAILED", "CANCELLED"] } },
              select: { amount: true },
            },
          },
        },
      },
    });

    // Preload location-level tax overrides for the whole tenant so we
    // don't fetch per-order. Map keyed by "locationId|categoryId".
    const overrides = await prisma.locationTaxRate.findMany({
      where: { location: { tenantId } },
      select: { locationId: true, taxCategoryId: true, ratePercent: true },
    });
    const overrideByKey = new Map(
      overrides.map((o) => [
        `${o.locationId}|${o.taxCategoryId}`,
        Number(o.ratePercent),
      ])
    );

    // Tenant fallback rate for uncategorised products
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { taxRate: true, taxLabel: true, tax2Label: true },
    });
    const fallbackRate = settings ? Number(settings.taxRate) : 0;

    // ── Per-location summary ────────────────────────────────────────
    type LocSummary = {
      locationId: string;
      locationName: string;
      grossReceipts: number; // subtotal - discount (taxable base pre-tax)
      taxableSales: number; // same as gross unless we later add tax-exempt items
      taxCollected: number; // sum of Order.taxAmount
      tax2Collected: number; // sum of Order.tax2Amount
      tips: number;
      surcharges: number;
      total: number;
      refunded: number; // refund amount cents
      refundedTax: number; // prorated portion of refund attributable to tax
      orderCount: number;
    };
    const locMap = new Map<string, LocSummary>();

    // ── Per-category breakdown per location ─────────────────────────
    type CatKey = string; // `${locationId}|${categoryId}`
    type CatRow = {
      locationId: string;
      locationName: string;
      categoryId: string; // may be UNCATEGORIZED_KEY
      categoryName: string;
      ratePercent: number;
      taxableAmount: number;
      taxCollected: number;
    };
    const catMap = new Map<CatKey, CatRow>();

    for (const o of orders) {
      const locSum = locMap.get(o.locationId) || {
        locationId: o.locationId,
        locationName: o.location.name,
        grossReceipts: 0,
        taxableSales: 0,
        taxCollected: 0,
        tax2Collected: 0,
        tips: 0,
        surcharges: 0,
        total: 0,
        refunded: 0,
        refundedTax: 0,
        orderCount: 0,
      };
      locSum.orderCount += 1;
      const netSubtotal = Math.max(0, o.subtotal - o.discountAmount);
      locSum.grossReceipts += netSubtotal;
      locSum.taxableSales += netSubtotal;
      locSum.taxCollected += o.taxAmount;
      locSum.tax2Collected += o.tax2Amount;
      locSum.tips += o.tipAmount;
      locSum.surcharges += o.surchargeAmount || 0;
      locSum.total += o.total;

      // Refund proration — split refund across the order's tax portion
      const refundAmount = o.payments.reduce(
        (s, p) => s + p.refunds.reduce((rs, r) => rs + r.amount, 0),
        0
      );
      if (refundAmount > 0) {
        locSum.refunded += refundAmount;
        // If the order was 100% refunded, all the tax was too.
        const refundShare =
          o.total > 0 ? Math.min(1, refundAmount / o.total) : 0;
        locSum.refundedTax += Math.round(o.taxAmount * refundShare);
      }
      locMap.set(o.locationId, locSum);

      // Line-level category breakdown. Discount is spread proportionally
      // across items (matching how resolveTax works at order-create).
      const cartSubtotal = o.items.reduce((s, i) => s + i.itemTotal, 0);
      for (const item of o.items) {
        const share = cartSubtotal > 0 ? item.itemTotal / cartSubtotal : 0;
        const lineDiscount = Math.round(o.discountAmount * share);
        const taxable = Math.max(0, item.itemTotal - lineDiscount);

        // Resolve rate: override → category → fallback (uncategorised)
        let rate = fallbackRate;
        let categoryId: string = UNCATEGORIZED_KEY;
        let categoryName: string = UNCATEGORIZED_LABEL;
        if (item.product.taxCategoryId && item.product.taxCategory) {
          categoryId = item.product.taxCategoryId;
          categoryName = item.product.taxCategory.name;
          const overrideKey = `${o.locationId}|${categoryId}`;
          rate = overrideByKey.has(overrideKey)
            ? overrideByKey.get(overrideKey)!
            : Number(item.product.taxCategory.ratePercent);
        }

        const key: CatKey = `${o.locationId}|${categoryId}`;
        const row = catMap.get(key) || {
          locationId: o.locationId,
          locationName: o.location.name,
          categoryId,
          categoryName,
          ratePercent: rate,
          taxableAmount: 0,
          taxCollected: 0,
        };
        row.taxableAmount += taxable;
        row.taxCollected += Math.round((taxable * rate) / 100);
        catMap.set(key, row);
      }
    }

    // Grand totals across locations
    const totals = {
      grossReceipts: 0,
      taxableSales: 0,
      taxCollected: 0,
      tax2Collected: 0,
      tips: 0,
      surcharges: 0,
      total: 0,
      refunded: 0,
      refundedTax: 0,
      orderCount: 0,
      netTax: 0,
    };
    for (const l of locMap.values()) {
      totals.grossReceipts += l.grossReceipts;
      totals.taxableSales += l.taxableSales;
      totals.taxCollected += l.taxCollected;
      totals.tax2Collected += l.tax2Collected;
      totals.tips += l.tips;
      totals.surcharges += l.surcharges;
      totals.total += l.total;
      totals.refunded += l.refunded;
      totals.refundedTax += l.refundedTax;
      totals.orderCount += l.orderCount;
    }
    totals.netTax = totals.taxCollected - totals.refundedTax;

    return NextResponse.json({
      success: true,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      taxLabel: settings?.taxLabel || "Tax",
      tax2Label: settings?.tax2Label || "Tax 2",
      locations: Array.from(locMap.values()).sort((a, b) =>
        a.locationName.localeCompare(b.locationName)
      ),
      categories: Array.from(catMap.values()).sort(
        (a, b) =>
          a.locationName.localeCompare(b.locationName) ||
          a.categoryName.localeCompare(b.categoryName)
      ),
      totals,
    });
  } catch (error: any) {
    console.error("[sales-tax] error:", error);
    return NextResponse.json(
      { error: error?.message || "Report failed" },
      { status: 500 }
    );
  }
}
