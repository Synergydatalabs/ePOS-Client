// GET /api/tenants/[tenantId]/tax-categories
//   List all tax categories for the tenant. Any authenticated staff
//   member can read them since the POS needs them to compute display tax.
//
// POST /api/tenants/[tenantId]/tax-categories
//   Create a new category. Admin only.
//   Body: { name, ratePercent, description?, isDefault?, isActive? }
//   If isDefault=true, any existing default is unset first.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const categories = await prisma.taxCategory.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { products: true, locationOverrides: true } },
      },
    });

    return NextResponse.json({ success: true, categories });
  } catch (error: any) {
    console.error("[tax-categories GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const {
      name,
      ratePercent,
      description,
      isDefault = false,
      isActive = true,
    } = body as {
      name?: string;
      ratePercent?: number;
      description?: string;
      isDefault?: boolean;
      isActive?: boolean;
    };

    if (!name || typeof ratePercent !== "number") {
      return NextResponse.json(
        { error: "name and ratePercent are required" },
        { status: 400 }
      );
    }
    if (ratePercent < 0 || ratePercent > 100) {
      return NextResponse.json(
        { error: "ratePercent must be between 0 and 100" },
        { status: 400 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      // Only one default per tenant — clear the existing one before
      // setting a new default. Guarded by a partial unique index in the
      // DB so this stays consistent even under concurrency.
      if (isDefault) {
        await tx.taxCategory.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.taxCategory.create({
        data: {
          tenantId,
          name,
          ratePercent,
          description: description || null,
          isDefault,
          isActive,
        },
      });
    });

    return NextResponse.json({ success: true, category: created });
  } catch (error: any) {
    console.error("[tax-categories POST] error:", error);
    // Prisma unique constraint on (tenantId, name)
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "A category with this name already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error?.message || "Create failed" },
      { status: 500 }
    );
  }
}
