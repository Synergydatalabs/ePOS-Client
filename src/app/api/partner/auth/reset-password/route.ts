// POST /api/partner/auth/reset-password — Phase I #4 (2026-09-12):
// verifies a 6-digit OTP + sets a new password.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createHash } from "crypto";
import { hashPassword, validatePassword } from "@/lib/password";
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, otp, newPassword, recaptchaToken } = body;

    // reCAPTCHA — same hard-fail policy as forgot-password. Blocks
    // bots from grinding 6-digit codes.
    const rc = await verifyRecaptcha({
      token: String(recaptchaToken || ""),
      ip: ipFromRequest(request),
    });
    if (!rc.ok) {
      console.warn(`[reset-password] reCAPTCHA rejected (${rc.reason})`);
      return NextResponse.json(
        { error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    if (!newPassword) {
      return NextResponse.json(
        { error: "New password is required" },
        { status: 400 }
      );
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    if (!email || !otp) {
      return NextResponse.json(
        { error: "Email and code are required" },
        { status: 400 }
      );
    }

    const emailLower = String(email).toLowerCase().trim();
    const cleanOtp = String(otp).trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      return NextResponse.json(
        { error: "Invalid or expired code. Please request a new one." },
        { status: 400 }
      );
    }
    const hashedOtp = createHash("sha256").update(cleanOtp).digest("hex");
    const membership = await prisma.membership.findFirst({
      where: {
        email: emailLower,
        userSub: { startsWith: "local-" },
        passwordResetToken: hashedOtp,
        passwordResetExpires: { gt: new Date() },
        tenant: { authProvider: "local" },
      },
    });

    if (!membership) {
      return NextResponse.json(
        { error: "Invalid or expired code. Please request a new one." },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(newPassword);

    // Update THIS membership row + clear the reset token. Note: a user
    // with the same email across multiple tenants has independent
    // Membership rows and independent password hashes — resetting one
    // does not affect the others. Users have to reset per tenant.
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
        loginAttempts: 0,
        lockedUntil: null,
        mustChangePassword: false,
        lastPasswordChange: new Date(),
      },
    });

    console.log(`[PARTNER] Password reset completed for ${membership.email}`);

    return NextResponse.json({
      success: true,
      message: "Password reset. You can now log in.",
    });
  } catch (error: any) {
    console.error("[PARTNER] Reset password error:", error);
    return NextResponse.json(
      { error: "Password reset failed. Please try again." },
      { status: 500 }
    );
  }
}
