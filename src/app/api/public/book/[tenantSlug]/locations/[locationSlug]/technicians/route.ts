// GET /api/public/book/[tenantSlug]/locations/[locationSlug]/technicians
//
// Returns technicians available for public booking. A technician = any
// active POS_STAFF (or above, minus KITCHEN_STAFF) at the tenant.
// Public-safe: only returns first name + last initial to avoid leaking
// full staff PII. The full name is stored on the appointment order
// server-side via the picked technicianId.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const BOOKABLE_ROLES = [
  "TENANT_OWNER",
  "POS_ADMIN",
  "POS_MANAGER",
  "POS_STAFF",
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; locationSlug: string }> }
) {
  const { tenantSlug, locationSlug } = await params;

  const location = await prisma.location.findFirst({
    where: {
      publicBookingSlug: locationSlug,
      status: "ACTIVE",
      publicBookingEnabled: true,
      tenant: { slug: tenantSlug, publicBookingEnabled: true },
    },
    include: { tenant: { select: { id: true } } },
  }).catch(() => null);
  if (!location) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const rows = await prisma.membership.findMany({
    where: {
      tenantId: location.tenant.id,
      status: "ACTIVE",
      role: { in: BOOKABLE_ROLES as unknown as string[] as any },
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  return NextResponse.json(
    {
      success: true,
      technicians: rows.map((r) => ({
        id: r.id,
        // Public display: first name + last initial. Full names stay
        // server-side. When both are missing we surface "Team member N"
        // rather than an empty label so the picker doesn't look broken.
        displayName:
          [r.firstName, r.lastName ? r.lastName[0].toUpperCase() + "." : null]
            .filter(Boolean)
            .join(" ")
            .trim() || "Team member",
      })),
    },
    { headers: { "Cache-Control": "public, s-maxage=300" } }
  );
}
