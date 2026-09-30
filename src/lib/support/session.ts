// Unified support-portal session — resolves the current user + tenant
// regardless of whether they signed in via Cognito (merchant) or the
// partner cookie (supplier or partner-auth merchant). Support endpoints
// call this instead of picking one auth path, so both merchant and
// supplier code paths share the same handlers.
//
// Returns null (never throws) when there is no valid session — callers
// return 401 themselves so the endpoint owns its own error shape.

import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getPartnerSession } from "@/lib/partner-auth";
import prisma from "@/lib/prisma";

export type SupportTenantRole = "MERCHANT" | "SUPPLIER";

export interface SupportSession {
  tenantId: string;
  tenantRole: SupportTenantRole;
  tenantName: string;
  userId: string; // opaque — Cognito sub OR "local-<email>" for partner
  email: string;
  displayName: string;
}

// Merchant vs supplier is decided by Tenant.businessType — anything other
// than "supplier" is treated as merchant. Same rule the supplier portal
// layout uses.
function roleFromBusinessType(bt: string): SupportTenantRole {
  return bt === "supplier" ? "SUPPLIER" : "MERCHANT";
}

export async function getSupportSession(
  request: NextRequest,
  tenantIdHint?: string
): Promise<SupportSession | null> {
  // 1) Try NextAuth (Cognito) first — same order validateRequest uses.
  const nextAuth = await getServerSession(authOptions);
  if (nextAuth?.user?.id) {
    const userSub = nextAuth.user.id;
    const userEmail = nextAuth.user.email ?? "";

    // Cognito users can belong to multiple tenants. The hint (from URL
    // path or body) tells us which tenant this request is scoped to;
    // without it we pick the most-recently active membership.
    const membership = await prisma.membership.findFirst({
      where: {
        userSub,
        status: "ACTIVE",
        ...(tenantIdHint ? { tenantId: tenantIdHint } : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: { tenant: { select: { id: true, name: true, businessType: true } } },
    });
    if (membership) {
      return {
        tenantId: membership.tenant.id,
        tenantRole: roleFromBusinessType(membership.tenant.businessType),
        tenantName: membership.tenant.name,
        userId: userSub,
        email: userEmail || membership.email,
        displayName: displayNameFrom(membership.firstName, membership.lastName, userEmail || membership.email),
      };
    }
  }

  // 2) Fall back to partner cookie — supplier portal + partner-auth merchants.
  const partner = await getPartnerSession(request);
  if (partner) {
    if (tenantIdHint && partner.tenantId !== tenantIdHint) return null;
    const tenant = await prisma.tenant.findUnique({
      where: { id: partner.tenantId },
      select: { id: true, name: true, businessType: true },
    });
    if (!tenant) return null;
    return {
      tenantId: tenant.id,
      tenantRole: roleFromBusinessType(tenant.businessType),
      tenantName: tenant.name,
      userId: `local-${partner.email}`,
      email: partner.email,
      displayName: displayNameFrom(partner.firstName, partner.lastName, partner.email),
    };
  }

  return null;
}

function displayNameFrom(
  first: string | null | undefined,
  last: string | null | undefined,
  email: string
): string {
  const joined = [first, last].filter(Boolean).join(" ");
  return joined || email.split("@")[0];
}
