// GET /api/partner/auth/session - Check current partner session
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);

    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }

    // Get fresh membership data
    const membership = await prisma.membership.findUnique({
      where: { id: session.memberId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            currency: true,
            status: true,
            authProvider: true,
            businessType: true,
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
      // Phase I #4 (2026-09-12): distinguish "still verifying" from
      // "actually inactive" so layouts can route pending users to the
      // verification wizard instead of dumping them to /login. The
      // session cookie is still valid — the verify page uses it to read
      // status via /api/partner/auth/verify.
      if (membership.tenant.status === "PENDING_APPROVAL") {
        return NextResponse.json(
          {
            authenticated: false,
            verificationPending: true,
            redirect: "/partner/verify",
            error: "Verification not complete",
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        {
          authenticated: false,
          error:
            membership.tenant.status === "REJECTED"
              ? "Account application was not approved"
              : membership.tenant.status === "SUSPENDED"
                ? "Account suspended"
                : "Business account inactive",
        },
        { status: 200 }
      );
    }

    // Get branding
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: membership.tenant.id },
      select: {
        brandName: true,
        brandLogoUrl: true,
        brandFaviconUrl: true,
        brandPrimaryColor: true,
        brandAccentColor: true,
        brandBackgroundColor: true,
        poweredByVisible: true,
      },
    });

    // Fire-and-forget last active update
    prisma.membership
      .update({
        where: { id: membership.id },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => {});

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
      branding: settings,
    });
  } catch (error: any) {
    console.error("[PARTNER] Session check error:", error);
    return NextResponse.json(
      { authenticated: false, error: "Session check failed" },
      { status: 200 }
    );
  }
}
