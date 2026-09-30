// POST /api/partner/auth/forgot-password — Phase I #4 (2026-09-12):
// OTP-based reset (replaces the link flow). Generates a 6-digit code,
// stores its SHA-256 hash in Membership.passwordResetToken (reusing the
// existing column — no schema change), sends the code via SES, and
// returns success unconditionally to prevent email enumeration.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createHash, randomInt } from "crypto";
import { sendPasswordResetOtpEmail } from "@/lib/email";
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

const OTP_EXPIRY_MINUTES = 15;

function generateOtp(): string {
  // 000000..999999, zero-padded. randomInt is cryptographically strong
  // and unbiased across the range.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, recaptchaToken } = body;

    // reCAPTCHA hard-fail — a wide-open forgot-password endpoint is a
    // free "does this email exist" oracle when combined with SES
    // timing. Same policy as login / register.
    const rc = await verifyRecaptcha({
      token: String(recaptchaToken || ""),
      ip: ipFromRequest(request),
    });
    if (!rc.ok) {
      console.warn(`[forgot-password] reCAPTCHA rejected (${rc.reason})`);
      return NextResponse.json(
        { error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const emailLower = String(email).toLowerCase().trim();

    // Always return the same shape to prevent email enumeration — the
    // client shows "check your inbox" regardless of whether we actually
    // sent anything. The real error surfaces only in ops logs.
    const successResponse = NextResponse.json({
      success: true,
      message:
        "If an account exists with this email, a 6-digit code has been sent.",
    });

    // Find any local-auth membership for this email. We DON'T filter by
    // tenant.status here — a user whose tenant is PENDING_APPROVAL can
    // still reset their password, they just can't log in until approved.
    const membership = await prisma.membership.findFirst({
      where: {
        email: emailLower,
        userSub: { startsWith: "local-" },
        tenant: { authProvider: "local" },
      },
      include: {
        tenant: { select: { name: true } },
      },
    });

    if (!membership) {
      return successResponse;
    }

    const otp = generateOtp();
    const hashedOtp = createHash("sha256").update(otp).digest("hex");
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        passwordResetToken: hashedOtp,
        passwordResetExpires: expiresAt,
      },
    });

    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: membership.tenantId },
      select: { brandName: true },
    });

    try {
      await sendPasswordResetOtpEmail({
        to: emailLower,
        otp,
        businessName: membership.tenant.name,
        brandName: settings?.brandName || undefined,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      });
      console.log(`[PARTNER] Password reset OTP sent to ${emailLower}`);
    } catch (emailError) {
      // Log loudly — an SES misconfiguration here is exactly the bug
      // Ahmad hit yesterday ("no email received"). We still return
      // success to the client (enumeration guard), but ops needs to
      // see the failure to fix it.
      console.error(
        `[PARTNER] SES send failed for password reset (${emailLower}):`,
        emailError
      );
    }

    return successResponse;
  } catch (error: any) {
    console.error("[PARTNER] forgot-password error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
