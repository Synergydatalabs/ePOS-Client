// POST /api/me/change-password — partner-auth users change their own password.
//
// Cognito users are told to change theirs via the Cognito hosted UI (their
// password isn't in our DB). We surface that in the drawer by hiding the
// password section based on authType returned from /api/me/profile.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, verifyPassword, validatePassword } from "@/lib/password";
import { getPartnerSession } from "@/lib/partner-auth";

export async function POST(request: NextRequest) {
  try {
    const partner = await getPartnerSession(request);
    if (!partner) {
      return NextResponse.json(
        { error: "Only local/partner-auth users can change password here." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current and new passwords are required" },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from the current one" },
        { status: 400 }
      );
    }

    const strengthError = validatePassword(newPassword);
    if (strengthError) {
      return NextResponse.json({ error: strengthError }, { status: 400 });
    }

    const membership = await prisma.membership.findUnique({
      where: { id: partner.memberId },
    });

    if (!membership || !membership.passwordHash) {
      return NextResponse.json(
        { error: "Account not found or has no password set" },
        { status: 404 }
      );
    }

    const currentValid = await verifyPassword(currentPassword, membership.passwordHash);
    if (!currentValid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 }
      );
    }

    const newHash = await hashPassword(newPassword);

    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        loginAttempts: 0,
        lockedUntil: null,
      },
    });

    console.log(`[ME-PW] Password changed for member ${membership.id}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[ME-PW] Change password error:", error);
    return NextResponse.json(
      { error: "Failed to change password" },
      { status: 500 }
    );
  }
}
