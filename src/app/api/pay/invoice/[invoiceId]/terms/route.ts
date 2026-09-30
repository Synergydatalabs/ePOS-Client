// GET /api/pay/invoice/[invoiceId]/terms — public read of the T&C the
// customer needs to accept before paying. Returns the currently-active
// version for this invoice's supplier, or a friendly "no terms configured"
// signal so the pay page can degrade gracefully (proceed to Pay without
// the T&C step — same behaviour as Phase 2 before this shipped).
//
// Auth: none — the invoice UUID in the URL is the capability, exactly
// like GET /api/pay/invoice/[invoiceId].

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getActiveTerms } from "@/lib/supplier-terms";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const { invoiceId } = await params;
  try {
    // Phase F #6q (2026-08-29): prefer product-level T&C over supplier
    // default. If any line item on the invoice references a product whose
    // termsVersionId is set, THAT T&C is what the buyer sees and accepts —
    // enables per-vendor terms on a reseller marketplace (buying MegoPay
    // shows MegoPay's terms, buying ABC shows ABC's terms). Falls back to
    // the supplier tenant's active T&C when no product-level T&C is set.
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        supplierTenantId: true,
        items: {
          where: { productId: { not: null } },
          orderBy: { sortOrder: "asc" },
          select: {
            product: {
              select: {
                termsVersionId: true,
                productTermsVersion: {
                  select: {
                    id: true,
                    version: true,
                    bodyMarkdown: true,
                    effectiveFrom: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Look for the first line item whose product has a per-product T&C.
    const productTerms = invoice.items
      .map((it) => it.product?.productTermsVersion)
      .find((t) => t != null);

    if (productTerms) {
      return NextResponse.json({
        success: true,
        terms: {
          id: productTerms.id,
          version: productTerms.version,
          bodyMarkdown: productTerms.bodyMarkdown,
          effectiveFrom: productTerms.effectiveFrom,
        },
      });
    }

    // Fallback: supplier's active T&C (existing behaviour).
    const terms = await getActiveTerms(invoice.supplierTenantId);
    if (!terms) {
      // Supplier hasn't published any T&C — the pay page should skip the
      // acceptance step and just accept payment. Signal that with a null.
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
    console.error("[PAY-INVOICE-TERMS] read error:", err);
    return NextResponse.json({ error: "Failed to load terms" }, { status: 500 });
  }
}
