// GET /api/me - Get current user info and memberships
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all memberships for this user
    const memberships = await prisma.membership.findMany({
      where: {
        userSub: session.user.id,
        status: "ACTIVE",
      },
      include: {
        tenant: {
          include: {
            locations: {
              where: { status: "ACTIVE" },
              orderBy: { isDefault: "desc" },
            },
            subscriptions: {
              where: {
                status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Filter and format memberships
    const formattedMemberships = memberships
      .filter((m) => {
        const sub = m.tenant.subscriptions[0];
        if (!sub) return false;

        // Check trial expiration
        if (sub.status === "TRIAL" && sub.trialEndsAt) {
          return new Date(sub.trialEndsAt) > new Date();
        }

        return true;
      })
      .map((m) => ({
        id: m.id,
        role: m.role,
        tenant: {
          id: m.tenant.id,
          name: m.tenant.name,
          slug: m.tenant.slug,
          status: m.tenant.status,
          currency: m.tenant.currency,
          timezone: m.tenant.timezone,
          logoUrl: m.tenant.logoUrl,
          businessType: m.tenant.businessType,
        },
        locations: m.tenant.locations.map((l) => ({
          id: l.id,
          name: l.name,
          isDefault: l.isDefault,
        })),
        subscription: m.tenant.subscriptions[0]
          ? {
              status: m.tenant.subscriptions[0].status,
              plan: m.tenant.subscriptions[0].plan,
              trialEndsAt: m.tenant.subscriptions[0].trialEndsAt,
              currentPeriodEnd: m.tenant.subscriptions[0].currentPeriodEnd,
            }
          : null,
      }));

    return NextResponse.json({
      success: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
      memberships: formattedMemberships,
      hasPosAccess: formattedMemberships.length > 0,
    });
  } catch (error: any) {
    console.error("[TAP API] /me error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
