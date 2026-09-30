// PATCH /api/tenants/[tenantId]/members/[memberId] - Update member role/status
// DELETE /api/tenants/[tenantId]/members/[memberId] - Remove member

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { MemberRole, MemberStatus } from "@/types";

// PATCH - Update member
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; memberId: string }> }
) {
  try {
    const { tenantId, memberId } = await params;

    // Validate request - require at least POS_ADMIN
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { role, status, specialties, commissionRate } = body;

    // Find the member
    const member = await prisma.membership.findFirst({
      where: {
        id: memberId,
        tenantId,
      },
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Cannot modify TENANT_OWNER
    if (member.role === "TENANT_OWNER") {
      return NextResponse.json(
        { error: "Cannot modify tenant owner" },
        { status: 400 }
      );
    }

    // Cannot modify yourself (except TENANT_OWNER can do anything)
    if (
      member.userSub === validation.context.userId &&
      validation.context.membership.role !== "TENANT_OWNER"
    ) {
      return NextResponse.json(
        { error: "Cannot modify your own membership" },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: any = {};

    if (role) {
      const validRoles: MemberRole[] = ["POS_ADMIN", "POS_MANAGER", "POS_STAFF"];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      updateData.role = role;
    }

    if (status) {
      const validStatuses: MemberStatus[] = ["ACTIVE", "SUSPENDED"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      updateData.status = status;

      if (status === "ACTIVE" && member.status !== "ACTIVE") {
        updateData.activatedAt = new Date();
      }
    }

    if (specialties !== undefined) {
      updateData.specialties = specialties;
    }

    if (commissionRate !== undefined) {
      updateData.commissionRate = commissionRate;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No updates provided" },
        { status: 400 }
      );
    }

    const updated = await prisma.membership.update({
      where: { id: memberId },
      data: updateData,
    });

    console.log(`[TAP API] Updated member: ${memberId} in tenant: ${tenantId}`);

    return NextResponse.json({
      success: true,
      member: {
        id: updated.id,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role,
        status: updated.status,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Update member error:", error);
    return NextResponse.json(
      { error: "Failed to update member" },
      { status: 500 }
    );
  }
}

// DELETE - Remove member
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; memberId: string }> }
) {
  try {
    const { tenantId, memberId } = await params;

    // Validate request - require at least POS_ADMIN
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    // Find the member
    const member = await prisma.membership.findFirst({
      where: {
        id: memberId,
        tenantId,
      },
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Cannot delete TENANT_OWNER
    if (member.role === "TENANT_OWNER") {
      return NextResponse.json(
        { error: "Cannot remove tenant owner" },
        { status: 400 }
      );
    }

    // Cannot delete yourself
    if (member.userSub === validation.context.userId) {
      return NextResponse.json(
        { error: "Cannot remove yourself" },
        { status: 400 }
      );
    }

    await prisma.membership.delete({
      where: { id: memberId },
    });

    console.log(`[TAP API] Removed member: ${memberId} from tenant: ${tenantId}`);

    return NextResponse.json({
      success: true,
      message: "Member removed",
    });
  } catch (error: any) {
    console.error("[TAP API] Remove member error:", error);
    return NextResponse.json(
      { error: "Failed to remove member" },
      { status: 500 }
    );
  }
}
