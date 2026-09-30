// POST /api/tenants - Create new tenant (start trial)
// GET /api/tenants - List user's tenants

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/prisma";
import { addDays } from "date-fns";

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || "14");

// Generate unique slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

// POST - Create new tenant
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, currency = "CAD", timezone = "America/Toronto" } = body;

    if (!name || name.trim().length < 2) {
      return NextResponse.json(
        { error: "Business name is required (min 2 characters)" },
        { status: 400 }
      );
    }

    // Generate unique slug
    let slug = generateSlug(name);
    let slugExists = await prisma.tenant.findUnique({ where: { slug } });
    let attempts = 0;

    while (slugExists && attempts < 10) {
      slug = `${generateSlug(name)}-${Math.random().toString(36).substring(2, 6)}`;
      slugExists = await prisma.tenant.findUnique({ where: { slug } });
      attempts++;
    }

    if (slugExists) {
      return NextResponse.json(
        { error: "Could not generate unique slug. Please try a different name." },
        { status: 400 }
      );
    }

    // Create tenant with all related records in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: name.trim(),
          slug,
          currency,
          timezone,
          status: "ACTIVE",
        },
      });

      // 2. Create default location
      const location = await tx.location.create({
        data: {
          tenantId: tenant.id,
          name: "Main Location",
          isDefault: true,
          status: "ACTIVE",
          country: "CA",
        },
      });

      // 3. Create membership for current user as TENANT_OWNER
      const membership = await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userSub: session.user.id,
          email: session.user.email.toLowerCase(),
          firstName: session.user.name?.split(" ")[0] || null,
          lastName: session.user.name?.split(" ").slice(1).join(" ") || null,
          role: "TENANT_OWNER",
          status: "ACTIVE",
          activatedAt: new Date(),
        },
      });

      // 4. Create trial subscription
      const subscription = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          plan: "trial",
          status: "TRIAL",
          monthlyPrice: 0,
          trialEndsAt: addDays(new Date(), TRIAL_DAYS),
        },
      });

      // 5. Create default settings
      const settings = await tx.tenantSettings.create({
        data: {
          tenantId: tenant.id,
          taxEnabled: true,
          taxRate: 13.0, // Ontario HST default
          taxLabel: "HST",
          tipEnabled: true,
          tipPresets: [15, 18, 20],
          tipCustomEnabled: true,
          customerDisplayEnabled: true,
          showOrderDetails: true,
        },
      });

      return { tenant, location, membership, subscription, settings };
    });

    console.log(`[TAP API] Created tenant: ${result.tenant.id} for user: ${session.user.email}`);

    return NextResponse.json({
      success: true,
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        slug: result.tenant.slug,
        currency: result.tenant.currency,
        timezone: result.tenant.timezone,
      },
      location: {
        id: result.location.id,
        name: result.location.name,
      },
      subscription: {
        status: result.subscription.status,
        trialEndsAt: result.subscription.trialEndsAt,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Create tenant error:", error);
    return NextResponse.json(
      { error: "Failed to create tenant" },
      { status: 500 }
    );
  }
}

// GET - List user's tenants
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const memberships = await prisma.membership.findMany({
      where: {
        userSub: session.user.id,
      },
      include: {
        tenant: {
          include: {
            subscriptions: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            _count: {
              select: {
                locations: { where: { status: "ACTIVE" } },
                memberships: { where: { status: "ACTIVE" } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const tenants = memberships.map((m) => ({
      id: m.tenant.id,
      name: m.tenant.name,
      slug: m.tenant.slug,
      status: m.tenant.status,
      currency: m.tenant.currency,
      role: m.role,
      membershipStatus: m.status,
      subscription: m.tenant.subscriptions[0]
        ? {
            status: m.tenant.subscriptions[0].status,
            plan: m.tenant.subscriptions[0].plan,
            trialEndsAt: m.tenant.subscriptions[0].trialEndsAt,
            currentPeriodEnd: m.tenant.subscriptions[0].currentPeriodEnd,
          }
        : null,
      locationCount: m.tenant._count.locations,
      memberCount: m.tenant._count.memberships,
      createdAt: m.tenant.createdAt,
    }));

    return NextResponse.json({
      success: true,
      tenants,
    });
  } catch (error: any) {
    console.error("[TAP API] List tenants error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
