// GET /api/tenants/[tenantId]/guest-profiles/search?q=<phone|email|name>
//   Fast lookup for the POS "add customer" typeahead. Matches on phone
//   (contains, whitespace-stripped), email (contains, case-insensitive)
//   and first/last name (contains, case-insensitive). Returns at most 15
//   results ordered by most-recently-visited so the operator sees the
//   likely match first.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

// Strip formatting so "(555) 123-4567" matches a profile stored as
// "5551234567". Kept liberal — Postgres LIKE handles the wildcards.
function normalizePhone(q: string) {
  return q.replace(/[^0-9+]/g, "");
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const q = (new URL(request.url).searchParams.get("q") || "").trim();
    if (!q || q.length < 2) {
      return NextResponse.json({ success: true, guests: [] });
    }

    const phoneQuery = normalizePhone(q);
    const isPhoneish = phoneQuery.length >= 3;

    const guests = await prisma.guestProfile.findMany({
      where: {
        tenantId,
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          ...(isPhoneish ? [{ phone: { contains: phoneQuery } }] : []),
        ],
      },
      orderBy: [{ lastVisitAt: "desc" }, { updatedAt: "desc" }],
      take: 15,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        visitCount: true,
        lifetimeSpend: true,
        lastVisitAt: true,
        tags: true,
        vipTier: true,
      },
    });

    return NextResponse.json({ success: true, guests });
  } catch (error: any) {
    console.error("[guest-profiles/search] error:", error);
    return NextResponse.json(
      { error: error?.message || "Search failed" },
      { status: 500 }
    );
  }
}
