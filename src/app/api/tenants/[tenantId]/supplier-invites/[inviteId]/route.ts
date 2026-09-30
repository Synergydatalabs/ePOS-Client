// DELETE /api/tenants/[tenantId]/supplier-invites/[inviteId] — cancel a pending invite
//
// Only cancels invites that are still PENDING. If already accepted, the
// merchant should manage the resulting relationship via the Suppliers page
// (pause/terminate the relationship) rather than deleting the invite record.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; inviteId: string }> }
) {
  try {
    const { tenantId, inviteId } = await params;

    const auth = await validateRequest(request, tenantId, "TENANT_ADMIN");
    if (!auth.success) return auth.response;

    const invite = await prisma.supplierInvite.findFirst({
      where: { id: inviteId, fromTenantId: tenantId },
      select: { id: true, status: true },
    });

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    if (invite.status !== "PENDING") {
      return NextResponse.json(
        { error: `Cannot cancel an invite that is ${invite.status}` },
        { status: 400 }
      );
    }

    await prisma.supplierInvite.update({
      where: { id: inviteId },
      data: { status: "CANCELLED" },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[SUPPLIER-INVITES] Cancel error:", error);
    return NextResponse.json({ error: "Failed to cancel invite" }, { status: 500 });
  }
}
