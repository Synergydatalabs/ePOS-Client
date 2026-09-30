// PATCH /api/tenants/[tenantId]/promotions/[promotionId]
//   Update editable fields on a promotion. POS_ADMIN only.
//
// DELETE /api/tenants/[tenantId]/promotions/[promotionId]
//   Hard-delete a promotion. POS_ADMIN only. Historical orders keep their
//   own discountAmount because it's stored on the order row, so deletion
//   is safe — but code must be free for a new promotion to reuse.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; promotionId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, promotionId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();

    // Whitelist editable fields — never let the client bump usageCount
    // or reassign tenantId.
    const {
      name,
      code,
      isActive,
      discountType,
      discountValue,
      maxDiscount,
      minCartValue,
      startDate,
      endDate,
      activeStartTime,
      activeEndTime,
      activeDays,
      usageLimit,
    } = body;

    // Uniqueness check if the code is changing
    if (code !== undefined) {
      const clash = await prisma.promotion.findFirst({
        where: {
          tenantId,
          code,
          NOT: { id: promotionId },
        },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: "Another promotion already uses this code" },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.promotion.update({
      where: { id: promotionId },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code: code || null }),
        ...(isActive !== undefined && { isActive }),
        ...(discountType !== undefined && { discountType }),
        ...(discountValue !== undefined && { discountValue }),
        ...(maxDiscount !== undefined && { maxDiscount: maxDiscount || null }),
        ...(minCartValue !== undefined && {
          minCartValue: minCartValue || null,
        }),
        ...(startDate !== undefined && {
          startDate: startDate ? new Date(startDate) : null,
        }),
        ...(endDate !== undefined && {
          endDate: endDate ? new Date(endDate) : null,
        }),
        ...(activeStartTime !== undefined && {
          activeStartTime: activeStartTime || null,
        }),
        ...(activeEndTime !== undefined && {
          activeEndTime: activeEndTime || null,
        }),
        ...(activeDays !== undefined && { activeDays: activeDays || [] }),
        ...(usageLimit !== undefined && {
          usageLimit: usageLimit || null,
        }),
      },
    });

    return NextResponse.json({ success: true, promotion: updated });
  } catch (error: any) {
    console.error("[promotions PATCH] error:", error);
    return NextResponse.json(
      { error: error?.message || "Update failed", code: error?.code },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, promotionId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    await prisma.promotion.delete({
      where: { id: promotionId },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[promotions DELETE] error:", error);
    return NextResponse.json(
      { error: error?.message || "Delete failed" },
      { status: 500 }
    );
  }
}
