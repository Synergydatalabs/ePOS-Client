// GET /api/pay/subscription/[token] — public read for the buyer cancel page.
//
// Returns just enough for the cancel page to show "You're cancelling
// your MegoPay Monthly subscription — $99/mo, next billing Oct 15".
// No PII beyond what the buyer already knows about themselves.
// Vendor branding pulls off the first line-item's product like the
// invoice pay page does.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const sub = await prisma.supplierSubscription.findUnique({
    where: { cancelToken: token },
    select: {
      id: true,
      status: true,
      customerName: true,
      customerEmail: true,
      currency: true,
      totalCents: true,
      interval: true,
      intervalCount: true,
      nextBillingAt: true,
      cancelledAt: true,
      lineItems: true,
      supplier: {
        select: {
          name: true,
          supplierProfile: {
            select: { displayName: true, contactEmail: true },
          },
          settings: { select: { brandName: true } },
        },
      },
    },
  });
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Resolve vendor from the first product line (same pattern as pay-invoice).
  let vendor: { name: string; brandColor: string | null } | null = null;
  try {
    const items = Array.isArray(sub.lineItems) ? (sub.lineItems as any[]) : [];
    const firstProductId = items.find((l) => l?.productId)?.productId;
    if (firstProductId) {
      const p = await prisma.supplierProduct.findUnique({
        where: { id: firstProductId },
        select: { vendorName: true, vendorBrandColor: true },
      });
      if (p?.vendorName) {
        vendor = { name: p.vendorName, brandColor: p.vendorBrandColor };
      }
    }
  } catch {
    /* vendor is best-effort */
  }

  const supplierName =
    sub.supplier.supplierProfile?.displayName ||
    sub.supplier.settings?.brandName ||
    sub.supplier.name;

  return NextResponse.json({
    success: true,
    subscription: {
      status: sub.status,
      customerName: sub.customerName,
      customerEmail: sub.customerEmail,
      currency: sub.currency,
      totalCents: sub.totalCents,
      interval: sub.interval,
      intervalCount: sub.intervalCount,
      nextBillingAt: sub.nextBillingAt,
      cancelledAt: sub.cancelledAt,
    },
    supplier: {
      displayName: supplierName,
      contactEmail: sub.supplier.supplierProfile?.contactEmail || null,
    },
    vendor,
  });
}
