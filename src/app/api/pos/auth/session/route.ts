// GET /api/pos/auth/session - Check current POS session
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

export async function GET(request: NextRequest) {
  try {
    // Get token from cookie
    const token = request.cookies.get("pos_token")?.value;

    if (!token) {
      return NextResponse.json(
        { authenticated: false },
        { status: 200 }
      );
    }

    // Verify token
    let payload;
    try {
      const verified = await jwtVerify(token, JWT_SECRET);
      payload = verified.payload as any;
    } catch {
      return NextResponse.json(
        { authenticated: false, error: "Session expired" },
        { status: 200 }
      );
    }

    // Get fresh membership data
    const membership = await prisma.membership.findUnique({
      where: { id: payload.memberId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            currency: true,
            businessType: true,
            status: true,
          },
        },
      },
    });

    if (!membership) {
      return NextResponse.json(
        { authenticated: false, error: "Account not found" },
        { status: 200 }
      );
    }

    // Check if account is still active
    if (membership.status !== "ACTIVE") {
      return NextResponse.json(
        { authenticated: false, error: "Account suspended" },
        { status: 200 }
      );
    }

    // Check if tenant is still active
    if (membership.tenant.status !== "ACTIVE") {
      return NextResponse.json(
        { authenticated: false, error: "Business account inactive" },
        { status: 200 }
      );
    }

    // Update last active time (don't await to avoid slowing down response)
    prisma.membership.update({
      where: { id: membership.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => {}); // Ignore errors

    return NextResponse.json({
      authenticated: true,
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
        businessType: membership.tenant.businessType,
      },
    });
  } catch (error: any) {
    console.error("[TAP POS] Session check error:", error);
    return NextResponse.json(
      { authenticated: false, error: "Session check failed" },
      { status: 200 }
    );
  }
}
