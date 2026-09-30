// POST /api/partner/auth/change-password - Change password (authenticated)
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { verifyPassword, hashPassword, validatePassword } from "@/lib/password";

export async function POST(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required" },
        { status: 400 }
      );
    }

    // Validate new password
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Get membership
    const membership = await prisma.membership.findUnique({
      where: { id: session.memberId },
    });

    if (!membership || !membership.passwordHash) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Verify current password
    const valid = await verifyPassword(currentPassword, membership.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 }
      );
    }

    // Hash and save new password
    const newHash = await hashPassword(newPassword);

    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        lastPasswordChange: new Date(),
      },
    });

    console.log(`[PARTNER] Password changed for ${membership.email}`);

    return NextResponse.json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error: any) {
    console.error("[PARTNER] Change password error:", error);
    return NextResponse.json(
      { error: "Password change failed. Please try again." },
      { status: 500 }
    );
  }
}
