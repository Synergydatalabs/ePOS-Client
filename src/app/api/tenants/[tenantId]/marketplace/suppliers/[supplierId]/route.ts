// GET /api/tenants/[tenantId]/marketplace/suppliers/[supplierId]
// Public-facing supplier profile from the MERCHANT's perspective.
//
// Guarded: the merchant must have an ACTIVE relationship with this supplier.
// Prevents a merchant on the platform from poking at another supplier's
// profile via a leaked ID.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; supplierId: string }> }
) {
  try {
    const { tenantId, supplierId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    // Guard: relationship must exist and be ACTIVE. This is the ONE check
    // that protects a supplier's data from an unconnected merchant — every
    // marketplace-side read against a supplier goes through this pattern.
    const relationship = await prisma.supplierMerchantRelationship.findFirst({
      where: {
        merchantTenantId: tenantId,
        supplierTenantId: supplierId,
        status: "ACTIVE",
      },
    });
    if (!relationship) {
      return NextResponse.json(
        { error: "You're not connected to this supplier" },
        { status: 404 }
      );
    }

    const supplier = await prisma.tenant.findFirst({
      where: { id: supplierId, businessType: "supplier" },
      select: {
        id: true,
        name: true,
        currency: true,
        supplierProfile: {
          select: {
            legalName: true,
            displayName: true,
            websiteUrl: true,
            contactEmail: true,
            contactPhone: true,
            aboutText: true,
            warehouseAddress: true,
            categories: true,
            minOrderCents: true,
            defaultLeadDays: true,
          },
        },
      },
    });

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Category list — used to render the filter chips on the storefront page
    // without a second round-trip.
    const productCategories = await prisma.supplierProductCategory.findMany({
      where: { supplierTenantId: supplierId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        _count: { select: { products: { where: { isActive: true } } } },
      },
    });

    return NextResponse.json({
      success: true,
      supplier: {
        id: supplier.id,
        legalName: supplier.name,
        displayName: supplier.supplierProfile?.displayName || supplier.name,
        currency: supplier.currency,
        websiteUrl: supplier.supplierProfile?.websiteUrl || null,
        contactEmail: supplier.supplierProfile?.contactEmail || null,
        contactPhone: supplier.supplierProfile?.contactPhone || null,
        aboutText: supplier.supplierProfile?.aboutText || null,
        warehouseAddress: supplier.supplierProfile?.warehouseAddress || null,
        categories: supplier.supplierProfile?.categories || [],
        minOrderCents: supplier.supplierProfile?.minOrderCents || 0,
        defaultLeadDays: supplier.supplierProfile?.defaultLeadDays ?? null,
      },
      relationship: {
        id: relationship.id,
        status: relationship.status,
        connectedAt: relationship.createdAt,
        totalOrders: relationship.totalOrders,
        totalSpentCents: relationship.totalSpentCents,
      },
      productCategories: productCategories.map((c) => ({
        id: c.id,
        name: c.name,
        productCount: c._count.products,
      })),
    });
  } catch (error: any) {
    console.error("[MARKETPLACE-SUPPLIER] GET error:", error);
    return NextResponse.json({ error: "Failed to load supplier" }, { status: 500 });
  }
}
