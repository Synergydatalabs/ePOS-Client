// GET /api/tenants/[tenantId]/tax-overrides
//   Return every (location × category) rate override defined for the
//   tenant. The admin grid renders these as a matrix; empty cell = use
//   the category's default rate.
//
// PUT /api/tenants/[tenantId]/tax-overrides
//   Body: { overrides: Array<{ locationId, taxCategoryId, ratePercent | null }> }
//   Upsert (rate given) or delete (rate null) each cell in a single tx.
//   Whole-grid save keeps the admin UI simple — one save button, no
//   per-cell inflight state.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    // Constrain to this tenant by joining through location.tenant.
    const overrides = await prisma.locationTaxRate.findMany({
      where: { location: { tenantId } },
      include: {
        location: { select: { id: true, name: true } },
        taxCategory: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ success: true, overrides });
  } catch (error: any) {
    console.error("[tax-overrides GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { overrides } = body as {
      overrides?: Array<{
        locationId: string;
        taxCategoryId: string;
        ratePercent: number | null;
      }>;
    };

    if (!Array.isArray(overrides)) {
      return NextResponse.json(
        { error: "overrides array is required" },
        { status: 400 }
      );
    }

    // Guard: confirm every referenced location + category belongs to this
    // tenant. Prevents a malicious client from mutating another tenant's
    // rates by sending a foreign locationId.
    const locationIds = [...new Set(overrides.map((o) => o.locationId))];
    const categoryIds = [...new Set(overrides.map((o) => o.taxCategoryId))];
    const [locCount, catCount] = await Promise.all([
      prisma.location.count({ where: { tenantId, id: { in: locationIds } } }),
      prisma.taxCategory.count({
        where: { tenantId, id: { in: categoryIds } },
      }),
    ]);
    if (locCount !== locationIds.length || catCount !== categoryIds.length) {
      return NextResponse.json(
        { error: "One or more locations/categories do not belong to this tenant" },
        { status: 400 }
      );
    }

    await prisma.$transaction(
      overrides.map((o) =>
        o.ratePercent === null
          ? prisma.locationTaxRate.deleteMany({
              where: {
                locationId: o.locationId,
                taxCategoryId: o.taxCategoryId,
              },
            })
          : prisma.locationTaxRate.upsert({
              where: {
                locationId_taxCategoryId: {
                  locationId: o.locationId,
                  taxCategoryId: o.taxCategoryId,
                },
              },
              create: {
                locationId: o.locationId,
                taxCategoryId: o.taxCategoryId,
                ratePercent: o.ratePercent,
              },
              update: { ratePercent: o.ratePercent },
            })
      )
    );

    return NextResponse.json({ success: true, count: overrides.length });
  } catch (error: any) {
    console.error("[tax-overrides PUT] error:", error);
    return NextResponse.json(
      { error: error?.message || "Save failed" },
      { status: 500 }
    );
  }
}
