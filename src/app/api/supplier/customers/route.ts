// GET /api/supplier/customers — merchants connected to the current supplier.
// One row per SupplierMerchantRelationship — includes lightweight merchant
// info + the denormalized order stats we keep on the relationship row.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { businessType: true },
    });
    if (tenant?.businessType !== "supplier") {
      return NextResponse.json({ error: "Not a supplier tenant" }, { status: 403 });
    }

    const relationships = await prisma.supplierMerchantRelationship.findMany({
      where: { supplierTenantId: session.tenantId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        merchantTenant: {
          select: { id: true, name: true, slug: true, businessType: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      customers: relationships.map((r) => ({
        id: r.id,
        merchant: r.merchantTenant,
        status: r.status,
        source: r.source,
        firstOrderAt: r.firstOrderAt,
        lastOrderAt: r.lastOrderAt,
        totalOrders: r.totalOrders,
        totalSpentCents: r.totalSpentCents,
        connectedAt: r.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("[SUPPLIER-CUSTOMERS] GET error:", error);
    return NextResponse.json({ error: "Failed to load customers" }, { status: 500 });
  }
}
