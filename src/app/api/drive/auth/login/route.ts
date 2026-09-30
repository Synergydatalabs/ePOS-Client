// POST /api/drive/auth/login - Driver login
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  verifyPassword,
  isAccountLocked,
  getLockoutTime,
  MAX_LOGIN_ATTEMPTS,
} from "@/lib/password";
import { SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

const TOKEN_EXPIRY = "12h"; // Driver session lasts 12 hours (full shift)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Find the membership with local auth and DRIVER role
    const membership = await prisma.membership.findFirst({
      where: {
        email: email.toLowerCase(),
        userSub: { startsWith: "local-" },
        role: "DRIVER",
      },
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
        { status: 423 }
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
      const newAttempts = membership.loginAttempts + 1;
      const updateData: any = { loginAttempts: newAttempts };

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

    console.log(`[TAP DRIVE] Driver login successful: ${email} at ${membership.tenant.name}`);

    const response = NextResponse.json({
      success: true,
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

    // Set HTTP-only cookie (separate from POS token)
    response.cookies.set("drive_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 12 * 60 * 60, // 12 hours
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("[TAP DRIVE] Login error:", error);
    return NextResponse.json(
      { error: "Login failed. Please try again." },
      { status: 500 }
    );
  }
}
