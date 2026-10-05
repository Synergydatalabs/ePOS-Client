// GET /api/pay/po/[poId]?ref=XXXX
// Public — no auth. Returns minimal info to render the checkout page:
//   PO number, supplier display name, amount, currency, payment status,
//   whether the link has expired.
//
// Access is gated on the caller providing the correct `?ref=` — the
// payment_link_reference stored when the link was generated. Without a
// valid ref, we 404. Prevents brute-forcing PO ids to see amounts.
//
// Never returns line items, shipping address, notes, or merchant/supplier
// contact info — the payer doesn't need any of that to complete payment.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ poId: string }> }
) {
  try {
    const { poId } = await params;
    const { searchParams } = new URL(request.url);
    const ref = searchParams.get("ref")?.trim();

    if (!ref) {
      return NextResponse.json({ error: "Invalid payment link" }, { status: 404 });
    }

    const po = await prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        paymentLinkReference: ref, // Bind — id AND ref must match
      },
      select: {
        id: true,
        poNumber: true,
        currency: true,
        totalCents: true,
        paymentStatus: true,
        paymentLinkExpiresAt: true,
        supplierTenant: {
          select: {
            name: true,
            supplierProfile: { select: { displayName: true } },
            settings: {
              select: {
                brandLogoUrl: true,
                brandPrimaryColor: true,
                brandAccentColor: true,
              },
            },
          },
        },
      },
    });

    if (!po) {
      return NextResponse.json({ error: "Invalid payment link" }, { status: 404 });
    }

    const expired =
      po.paymentLinkExpiresAt != null && po.paymentLinkExpiresAt < new Date();

    return NextResponse.json({
      success: true,
      po: {
        id: po.id,
        poNumber: po.poNumber,
        currency: po.currency,
        amountCents: po.totalCents,
        paymentStatus: po.paymentStatus,
        expired,
        supplierName:
          po.supplierTenant.supplierProfile?.displayName || po.supplierTenant.name,
        // 2026-10-04: brand surface for a nicer checkout header. Nullable
        // fields fall back to tasteful defaults in the UI (initials-in-circle
        // for missing logo, slate-900 for missing primary colour).
        brand: {
          logoUrl: po.supplierTenant.settings?.brandLogoUrl ?? null,
          primaryColor: po.supplierTenant.settings?.brandPrimaryColor ?? null,
          accentColor: po.supplierTenant.settings?.brandAccentColor ?? null,
        },
      },
    });
  } catch (error: any) {
    console.error("[PUBLIC-PAY] GET error:", error);
    return NextResponse.json({ error: "Failed to load payment page" }, { status: 500 });
  }
}
