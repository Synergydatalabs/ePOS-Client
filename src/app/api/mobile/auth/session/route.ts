// GET /api/mobile/auth/session
//
// Called by the mobile app on cold start (or on any 401 recovery attempt).
// Verifies the Bearer token, returns current user + tenant info.
// 401 → app kicks to login. 200 → app renders the dashboard.
//
// Kept intentionally cheap (single membership + tenant lookup). Do NOT
// add heavyweight aggregations here — this fires on every app resume.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

export async function GET(request: NextRequest) {
  const session = await getPartnerSession(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Verify the membership is still active (not deactivated after JWT issue).
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
          businessType: true,
        },
      },
    },
  });

  if (!membership || membership.status !== "ACTIVE" || membership.tenant.status !== "ACTIVE") {
    return NextResponse.json(
      { authenticated: false, reason: "Membership no longer active" },
      { status: 401 }
    );
  }

  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId: membership.tenant.id },
    select: {
      brandName: true,
      brandLogoUrl: true,
      brandPrimaryColor: true,
      brandAccentColor: true,
    },
  });

  return NextResponse.json({
    authenticated: true,
    user: {
      memberId: membership.id,
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
    branding: settings
      ? {
          name: settings.brandName,
          logoUrl: settings.brandLogoUrl,
          primaryColor: settings.brandPrimaryColor,
          accentColor: settings.brandAccentColor,
        }
      : null,
  });
}
