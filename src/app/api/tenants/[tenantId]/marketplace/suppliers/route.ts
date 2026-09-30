// GET /api/tenants/[tenantId]/marketplace/suppliers
// Lists suppliers the current merchant tenant is connected to
// (SupplierMerchantRelationship rows where merchantTenantId = current tenant).
//
// Includes the supplier's public profile info + a product count so the
// merchant's marketplace index page can render richly without N+1 fetches.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    // Filter to ACTIVE relationships only — PAUSED / TERMINATED suppliers
    // shouldn't clutter the merchant's marketplace index.
    const relationships = await prisma.supplierMerchantRelationship.findMany({
      where: { merchantTenantId: tenantId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      include: {
        supplierTenant: {
          select: {
            id: true,
            name: true,
            currency: true,
            supplierProfile: {
              select: {
                displayName: true,
                aboutText: true,
                categories: true,
                minOrderCents: true,
                defaultLeadDays: true,
                isPublic: true,
                onboardingStatus: true,
              },
            },
            // We don't select all products (would be enormous). Just count
            // the active ones so the card can show "42 products available".
            _count: {
              select: {
                supplierProducts: { where: { isActive: true } },
              },
            },
          },
        },
      },
    });

    const suppliers = relationships.map((r) => ({
      relationshipId: r.id,
      supplierTenantId: r.supplierTenant.id,
      name: r.supplierTenant.supplierProfile?.displayName || r.supplierTenant.name,
      legalName: r.supplierTenant.name,
      currency: r.supplierTenant.currency,
      aboutText: r.supplierTenant.supplierProfile?.aboutText || null,
      categories: r.supplierTenant.supplierProfile?.categories || [],
      minOrderCents: r.supplierTenant.supplierProfile?.minOrderCents || 0,
      defaultLeadDays: r.supplierTenant.supplierProfile?.defaultLeadDays ?? null,
      productCount: r.supplierTenant._count.supplierProducts,
      source: r.source,
      connectedAt: r.createdAt,
      totalOrders: r.totalOrders,
    }));

    return NextResponse.json({ success: true, suppliers });
  } catch (error: any) {
    console.error("[MARKETPLACE-SUPPLIERS] GET error:", error);
    return NextResponse.json({ error: "Failed to load suppliers" }, { status: 500 });
  }
}
