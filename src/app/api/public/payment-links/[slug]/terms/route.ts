// GET /api/public/payment-links/[slug]/terms
//
// Phase I #2c (2026-09-08) — public T&C read for payment-link checkout.
// Mirrors /api/pay/invoice/[invoiceId]/terms/route.ts but resolves the
// applicable T&C via the payment LINK (product → supplier fallback)
// instead of an existing invoice. The link's product carries the
// per-product T&C when set (per-vendor terms on a reseller marketplace),
// otherwise the supplier tenant's default active T&C applies.
//
// Returns { terms: {...} | null }. Null = supplier hasn't published any
// T&C — the checkout falls back to the single-box confirmation.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolveLinkBySlug } from "@/lib/payment-link.service";
import { getActiveTerms } from "@/lib/supplier-terms";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const link = await resolveLinkBySlug(slug);
    if (!link) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    }

    // Product-level T&C first — same precedence as the invoice pay page.
    if (link.productId) {
      const product = await prisma.supplierProduct.findUnique({
        where: { id: link.productId },
        select: {
          productTermsVersion: {
            select: {
              id: true,
              version: true,
              bodyMarkdown: true,
              effectiveFrom: true,
            },
          },
        },
      });
      const productTerms = product?.productTermsVersion;
      if (productTerms) {
        return NextResponse.json({ success: true, terms: productTerms });
      }
    }

    // Fallback: supplier's active tenant-level T&C.
    const terms = await getActiveTerms(link.supplierTenantId);
    if (!terms) {
      return NextResponse.json({ success: true, terms: null });
    }
    return NextResponse.json({
      success: true,
      terms: {
        id: terms.id,
        version: terms.version,
        bodyMarkdown: terms.bodyMarkdown,
        effectiveFrom: terms.effectiveFrom,
      },
    });
  } catch (err: any) {
    console.error("[PAYMENT-LINK-TERMS] read error:", err);
    return NextResponse.json({ error: "Failed to load terms" }, { status: 500 });
  }
}
