// POST /api/pos/auth/change-password - Change password (required on first login)
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  verifyPassword,
  hashPassword,
  validatePassword,
} from "@/lib/password";
import { jwtVerify, SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

export async function POST(request: NextRequest) {
  try {
    // Get token from cookie
    const token = request.cookies.get("pos_token")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Verify token
    let payload;
    try {
      const verified = await jwtVerify(token, JWT_SECRET);
      payload = verified.payload as any;
    } catch {
      return NextResponse.json(
        { error: "Invalid or expired session" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required" },
        { status: 400 }
      );
    }

    // Validate new password strength
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Find membership
    const membership = await prisma.membership.findUnique({
      where: { id: payload.memberId },
    });

    if (!membership || !membership.passwordHash) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    // Verify current password
    const currentValid = await verifyPassword(currentPassword, membership.passwordHash);
    if (!currentValid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 }
      );
    }

    // Check if new password is same as current
    const sameAsOld = await verifyPassword(newPassword, membership.passwordHash);
    if (sameAsOld) {
      return NextResponse.json(
        { error: "New password must be different from current password" },
        { status: 400 }
      );
    }

    // Hash and update password
    const newHash = await hashPassword(newPassword);

    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        lastPasswordChange: new Date(),
      },
    });

    console.log(`[TAP POS] Password changed for: ${membership.email}`);

    // Generate new token (to update any stale data)
    const newToken = await new SignJWT({
      memberId: membership.id,
      tenantId: membership.tenantId,
      email: membership.email,
      role: membership.role,
      firstName: membership.firstName,
      lastName: membership.lastName,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(JWT_SECRET);

    const response = NextResponse.json({
      success: true,
      message: "Password changed successfully",
    });

    // Update cookie with new token
    response.cookies.set("pos_token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("[TAP POS] Change password error:", error);
    return NextResponse.json(
      { error: "Failed to change password" },
      { status: 500 }
    );
  }
}
