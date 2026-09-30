// POST /api/pos/auth/login - Staff login for POS
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  verifyPassword,
  isAccountLocked,
  getLockoutTime,
  MAX_LOGIN_ATTEMPTS,
} from "@/lib/password";
import { SignJWT } from "jose";
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

const TOKEN_EXPIRY = "8h"; // POS session lasts 8 hours (typical shift)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, tenantId, recaptchaToken } = body;

    // reCAPTCHA runs for signal only — password + per-account lockout
    // are the primary gate. Blocking on a mis-registered site key would
    // lock the whole POS out of a shift. Soft-fail: log and continue.
    // Set RECAPTCHA_ENFORCE_AUTH=1 to make this a hard 403.
    const rc = await verifyRecaptcha({
      token: recaptchaToken || "",
      ip: ipFromRequest(request),
      expectedAction: "pos_login",
    });
    if (!rc.ok) {
      // Phase I #4 (2026-09-11): HARD-FAIL — no bypass.
      console.warn(`[pos login] reCAPTCHA rejected (${rc.reason})`);
      return NextResponse.json(
        { error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Find the membership with local auth
    const whereClause: any = {
      email: email.toLowerCase(),
      userSub: { startsWith: "local-" }, // Only local auth users
    };

    // If tenantId provided, scope to that tenant
    if (tenantId) {
      whereClause.tenantId = tenantId;
    }

    const membership = await prisma.membership.findFirst({
      where: whereClause,
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            currency: true,
            status: true,
          },
        },
      },
    });

    if (!membership) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Check if account is locked
    const lockStatus = isAccountLocked(
      membership.loginAttempts,
      membership.lockedUntil
    );
    if (lockStatus.locked) {
      return NextResponse.json(
        { error: lockStatus.message },
        { status: 423 } // 423 Locked
      );
    }

    // Check if tenant is active
    if (membership.tenant.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "This business account is not active" },
        { status: 403 }
      );
    }

    // Check membership status
    if (membership.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Your account is not active. Please contact your manager." },
        { status: 403 }
      );
    }

    // Verify password
    if (!membership.passwordHash) {
      return NextResponse.json(
        { error: "Password not set. Please contact your manager." },
        { status: 401 }
      );
    }

    const passwordValid = await verifyPassword(password, membership.passwordHash);

    if (!passwordValid) {
      // Increment login attempts
      const newAttempts = membership.loginAttempts + 1;
      const updateData: any = { loginAttempts: newAttempts };

      // Lock account if max attempts reached
      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = getLockoutTime();
      }

      await prisma.membership.update({
        where: { id: membership.id },
        data: updateData,
      });

      const attemptsLeft = MAX_LOGIN_ATTEMPTS - newAttempts;
      return NextResponse.json(
        {
          error:
            attemptsLeft > 0
              ? `Invalid password. ${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} remaining.`
              : "Account locked due to too many failed attempts.",
        },
        { status: 401 }
      );
    }

    // Successful login - reset attempts and update last active
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
        lastActiveAt: new Date(),
      },
    });

    // Generate JWT token
    const token = await new SignJWT({
      memberId: membership.id,
      tenantId: membership.tenantId,
      email: membership.email,
      role: membership.role,
      firstName: membership.firstName,
      lastName: membership.lastName,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(TOKEN_EXPIRY)
      .sign(JWT_SECRET);

    console.log(`[TAP POS] Login successful: ${email} at ${membership.tenant.name}`);

    // Create response with token in cookie
    const response = NextResponse.json({
      success: true,
      mustChangePassword: membership.mustChangePassword,
      user: {
        id: membership.id,
        email: membership.email,
        firstName: membership.firstName,
        lastName: membership.lastName,
        role: membership.role,
      },
      tenant: {
        id: membership.tenant.id,
        name: membership.tenant.name,
        slug: membership.tenant.slug,
        currency: membership.tenant.currency,
      },
    });

    // Set HTTP-only cookie
    response.cookies.set("pos_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60, // 8 hours in seconds
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("[TAP POS] Login error:", error);
    return NextResponse.json(
      { error: "Login failed. Please try again." },
      { status: 500 }
    );
  }
}
