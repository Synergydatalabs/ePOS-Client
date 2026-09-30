// Shared helper for /api/mobile/orders/* routes.
//
// Every order endpoint needs three things:
//   - the caller's session (memberId, tenantId, role)
//   - the tenant's active location (orders are locationId-scoped, not tenantId)
//   - a permission check for the mobile POS surface
//
// Rather than repeat that plumbing per-route (and risk drift), all routes
// call getMobileOrderContext(request) and get back a normalized shape or an
// early-return NextResponse.
//
// Multi-location note: for A3 we auto-pick the tenant's first active
// location. Multi-location tenants will get a switcher in a later phase
// (probably surfaced via /api/mobile/session or a dedicated /locations
// endpoint) — until then, a location-scoped payload in the mobile session
// would be the extension point.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession, type PartnerSession } from "@/lib/partner-auth";

// Roles allowed to open/edit orders from the mobile POS. Keep this
// permissive on purpose — anyone the merchant hires to work the tap-app
// mobile POS gets in. Reporting/admin roles that never touch POS stay out.
const POS_ROLES = new Set([
  "TENANT_OWNER",
  "TENANT_ADMIN",
  "MANAGER",
  "POS_MANAGER",
  "POS_STAFF",
  "SERVER",
  "KITCHEN_STAFF",
  "CASHIER",
]);

export interface MobileOrderContext {
  session: PartnerSession;
  tenantId: string;
  locationId: string;
}

export type MobileOrderContextResult =
  | { ok: true; ctx: MobileOrderContext }
  | { ok: false; response: NextResponse };

export async function getMobileOrderContext(
  request: NextRequest
): Promise<MobileOrderContextResult> {
  const session = await getPartnerSession(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { authenticated: false, error: "Not signed in" },
        { status: 401 }
      ),
    };
  }

  if (!POS_ROLES.has(session.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your role does not have POS access" },
        { status: 403 }
      ),
    };
  }

  // Prefer the merchant's designated default location, then any active
  // location by creation date. Multi-location tenants will get a switcher
  // in a later phase (via /api/mobile/session or a locations endpoint).
  const location = await prisma.location.findFirst({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (!location) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This tenant has no active location — set one up in the admin portal." },
        { status: 400 }
      ),
    };
  }

  return {
    ok: true,
    ctx: {
      session,
      tenantId: session.tenantId,
      locationId: location.id,
    },
  };
}
