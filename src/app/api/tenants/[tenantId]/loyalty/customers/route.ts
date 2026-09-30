// GET /api/tenants/[tenantId]/loyalty/customers
//   Paginated list of customers enrolled in the tenant's loyalty program.
//   Query params:
//     search  — partial match on email OR phone
//     sort    — one of "points" | "lifetime" | "visits" | "lastVisit" | "created"
//     order   — "asc" | "desc" (default desc)
//     page    — 1-indexed page number (default 1)
//     limit   — page size, capped at 100 (default 25)

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

const SORT_MAP: Record<string, string> = {
  points: "totalPoints",
  lifetime: "lifetimePoints",
  visits: "visitCount",
  lastVisit: "lastVisit",
  created: "createdAt",
};

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const search = (searchParams.get("search") || "").trim();
    const sort = SORT_MAP[searchParams.get("sort") || "lastVisit"] || "lastVisit";
    const order = (searchParams.get("order") || "desc") === "asc" ? "asc" : "desc";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "25", 10) || 25)
    );

    // Get the program for this tenant (may not exist yet — return empty list)
    const program = await prisma.loyaltyProgram.findUnique({
      where: { tenantId },
      select: { id: true },
    });

    if (!program) {
      return NextResponse.json({
        success: true,
        customers: [],
        total: 0,
        page,
        limit,
        program: null,
      });
    }

    const where: any = { programId: program.id };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ];
    }

    const [total, customers] = await Promise.all([
      prisma.customerLoyalty.count({ where }),
      prisma.customerLoyalty.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          phone: true,
          totalPoints: true,
          lifetimePoints: true,
          visitCount: true,
          totalSpent: true,
          lastVisit: true,
          currentStreak: true,
          longestStreak: true,
          createdAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      customers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    console.error("[loyalty customers] GET error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to load customers",
        code: error?.code || null,
      },
      { status: 500 }
    );
  }
}
