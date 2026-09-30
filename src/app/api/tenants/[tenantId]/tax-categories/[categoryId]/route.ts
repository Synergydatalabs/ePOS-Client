// PATCH /api/tenants/[tenantId]/tax-categories/[categoryId]
//   Update fields. Setting isDefault=true clears any prior default.
//
// DELETE /api/tenants/[tenantId]/tax-categories/[categoryId]
//   Removes the category. Products keep operating (taxCategoryId is
//   nullable and cascades to null via the FK).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; categoryId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, categoryId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { name, ratePercent, description, isDefault, isActive } = body as {
      name?: string;
      ratePercent?: number;
      description?: string;
      isDefault?: boolean;
      isActive?: boolean;
    };

    if (
      ratePercent !== undefined &&
      (typeof ratePercent !== "number" || ratePercent < 0 || ratePercent > 100)
    ) {
      return NextResponse.json(
        { error: "ratePercent must be between 0 and 100" },
        { status: 400 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.taxCategory.updateMany({
          where: { tenantId, isDefault: true, NOT: { id: categoryId } },
          data: { isDefault: false },
        });
      }
      return tx.taxCategory.update({
        where: { id: categoryId },
        data: {
          ...(name !== undefined && { name }),
          ...(ratePercent !== undefined && { ratePercent }),
          ...(description !== undefined && { description: description || null }),
          ...(isDefault !== undefined && { isDefault }),
          ...(isActive !== undefined && { isActive }),
        },
      });
    });

    return NextResponse.json({ success: true, category: updated });
  } catch (error: any) {
    console.error("[tax-categories PATCH] error:", error);
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "A category with this name already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error?.message || "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, categoryId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    await prisma.taxCategory.delete({ where: { id: categoryId } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[tax-categories DELETE] error:", error);
    return NextResponse.json(
      { error: error?.message || "Delete failed" },
      { status: 500 }
    );
  }
}
