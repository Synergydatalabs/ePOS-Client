// GET /api/drive/auth/session - Check current driver session
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("drive_token")?.value;

    if (!token) {
      return NextResponse.json(
        { authenticated: false },
        { status: 200 }
      );
    }

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

    // Verify role is DRIVER
    if (payload.role !== "DRIVER") {
      return NextResponse.json(
        { authenticated: false, error: "Not a driver account" },
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

    if (membership.status !== "ACTIVE") {
      return NextResponse.json(
        { authenticated: false, error: "Account suspended" },
        { status: 200 }
      );
    }

    if (membership.tenant.status !== "ACTIVE") {
      return NextResponse.json(
        { authenticated: false, error: "Business account inactive" },
        { status: 200 }
      );
    }

    // Update last active time
    prisma.membership.update({
      where: { id: membership.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => {});

    return NextResponse.json({
      authenticated: true,
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
  } catch (error: any) {
    console.error("[TAP DRIVE] Session check error:", error);
    return NextResponse.json(
      { authenticated: false, error: "Session check failed" },
      { status: 200 }
    );
  }
}
