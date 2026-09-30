// GET  /api/me/profile — current user's profile (from the active tenant)
// PUT  /api/me/profile — update the user's name/phone.
//
// Dual auth: works for BOTH the Cognito session (staff) and partner JWT
// (tenant owners + local-auth). We resolve the current membership by looking
// at the active_tenant cookie / partner token's tenantId + the user's sub.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/authOptions";
import { getPartnerSession } from "@/lib/partner-auth";

async function resolveMembership(request: NextRequest) {
  // Try Cognito first — matches the pattern used by validateRequest().
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    // Cognito session doesn't tell us WHICH tenant is active — read it from
    // the header (client passes it) or fall back to first membership.
    const activeTenantId =
      request.headers.get("x-active-tenant") ||
      request.cookies.get("tap_active_tenant")?.value ||
      null;

    const where: any = {
      userSub: session.user.id,
      status: "ACTIVE",
    };
    if (activeTenantId) where.tenantId = activeTenantId;

    const membership = activeTenantId
      ? await prisma.membership.findFirst({ where })
      : await prisma.membership.findFirst({
          where: { userSub: session.user.id, status: "ACTIVE" },
          orderBy: { createdAt: "asc" },
        });

    if (!membership) return null;
    return { membership, authType: "cognito" as const };
  }

  // Partner JWT — tenantId + memberId are baked into the token.
  const partner = await getPartnerSession(request);
  if (partner) {
    const membership = await prisma.membership.findUnique({
      where: { id: partner.memberId },
    });
    if (!membership || membership.status !== "ACTIVE") return null;
    return { membership, authType: "partner" as const };
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveMembership(request);
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { membership, authType } = resolved;

    // Also fetch the tenant name — useful for the drawer header ("You're in
    // Andy's Pizza").
    const tenant = await prisma.tenant.findUnique({
      where: { id: membership.tenantId },
      select: { id: true, name: true, businessType: true },
    });

    return NextResponse.json({
      success: true,
      profile: {
        id: membership.id,
        email: membership.email,
        firstName: membership.firstName,
        lastName: membership.lastName,
        role: membership.role,
        authType, // 'cognito' or 'partner' — the UI hides the change-password
                  // section for cognito users (they change it via Cognito).
        lastActiveAt: membership.lastActiveAt,
      },
      tenant,
    });
  } catch (error: any) {
    console.error("[ME-PROFILE] GET error:", error);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const resolved = await resolveMembership(request);
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Whitelist: first/last name only for now. Email + role must go through
    // a different flow (email needs re-verification; role is admin-set).
    const data: Record<string, unknown> = {};
    if (typeof body.firstName === "string") {
      const trimmed = body.firstName.trim();
      if (!trimmed) {
        return NextResponse.json(
          { error: "First name cannot be empty" },
          { status: 400 }
        );
      }
      data.firstName = trimmed;
    }
    if (typeof body.lastName === "string") {
      data.lastName = body.lastName.trim() || null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }

    const updated = await prisma.membership.update({
      where: { id: resolved.membership.id },
      data,
    });

    return NextResponse.json({
      success: true,
      profile: {
        id: updated.id,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        role: updated.role,
      },
    });
  } catch (error: any) {
    console.error("[ME-PROFILE] PUT error:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
