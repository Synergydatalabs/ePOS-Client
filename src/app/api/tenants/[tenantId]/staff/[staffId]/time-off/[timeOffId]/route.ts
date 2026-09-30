// DELETE /api/tenants/[tenantId]/staff/[staffId]/time-off/[timeOffId]
//
// Removes a scheduled time-off range. Hard delete — the row is small
// and there's no downstream reference to worry about.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ tenantId: string; staffId: string; timeOffId: string }>;
  }
) {
  try {
    const { tenantId, staffId, timeOffId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    // Belt-and-braces ownership check: the row must belong to a
    // membership on this tenant. Prevents cross-tenant deletion by
    // guessing UUIDs.
    const row = await prisma.staffTimeOff.findFirst({
      where: {
        id: timeOffId,
        membershipId: staffId,
        membership: { tenantId },
      },
      select: { id: true },
    });
    if (!row) {
      return NextResponse.json({ error: "Time off not found" }, { status: 404 });
    }

    await prisma.staffTimeOff.delete({ where: { id: timeOffId } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[STAFF-TIMEOFF] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to remove time off" },
      { status: 500 }
    );
  }
}
