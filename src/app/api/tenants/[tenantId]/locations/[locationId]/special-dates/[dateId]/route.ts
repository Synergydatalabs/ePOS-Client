// ============================================================================
// DELETE /api/.../special-dates/[dateId]
//
// Removes a special date — restaurant returns to normal hours/booking.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ tenantId: string; locationId: string; dateId: string }>;
  }
) {
  try {
    const { tenantId, locationId, dateId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const sd = await prisma.specialDate.findFirst({
      where: { id: dateId, locationId, location: { tenantId } },
    });
    if (!sd) {
      return NextResponse.json({ error: "Special date not found" }, { status: 404 });
    }

    await prisma.specialDate.delete({ where: { id: dateId } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[special-date DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to delete special date" },
      { status: 500 }
    );
  }
}
