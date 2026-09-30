// ============================================================================
// /api/.../guest-profiles
//
//   GET  → search by phone/email/name (used as autocomplete in 3-tap booking)
//          Query params: ?q=text (matches phone, email, name)
//                       ?limit=10
//   POST → create new guest profile (typically done as side effect of
//          reservation create; this endpoint for explicit creation only)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const createSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  phone: z.string().min(7).max(30).optional(),
  email: z.string().email().max(255).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).optional(),
  dietaryRestrictions: z.array(z.string().max(255)).optional(),
  allergies: z.array(z.string().max(255)).optional(),
  alcoholPreferences: z.array(z.string().max(255)).optional(),
  specialOccasions: z.any().optional(),
  vipTier: z.number().int().min(0).max(3).optional(),
  optInMarketing: z.boolean().optional(),
  optInSms: z.boolean().optional(),
  optInWhatsapp: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10), 50);

    if (q.length < 2) {
      return NextResponse.json({ profiles: [] });
    }

    // Search: substring match on phone OR email OR name (first + last concat)
    const profiles = await prisma.guestProfile.findMany({
      where: {
        tenantId,
        OR: [
          { phone: { contains: q } },
          { email: { contains: q.toLowerCase(), mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        visitCount: true,
        lastVisitAt: true,
        vipTier: true,
        tags: true,
        allergies: true,
        dietaryRestrictions: true,
      },
      orderBy: [
        { vipTier: "desc" },
        { visitCount: "desc" },
        { lastVisitAt: { sort: "desc", nulls: "last" } },
      ],
      take: limit,
    });

    return NextResponse.json({ profiles });
  } catch (err: any) {
    console.error("[guest-profiles GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to search guests" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // Must have phone OR email
    if (!input.phone && !input.email) {
      return NextResponse.json(
        { error: "Either phone or email is required" },
        { status: 400 }
      );
    }

    // Check for existing match
    const existing = await prisma.guestProfile.findFirst({
      where: {
        tenantId,
        OR: [
          ...(input.phone ? [{ phone: input.phone }] : []),
          ...(input.email ? [{ email: input.email.toLowerCase() }] : []),
        ],
      },
    });

    if (existing) {
      return NextResponse.json(
        { profile: existing, alreadyExists: true },
        { status: 200 }
      );
    }

    const profile = await prisma.guestProfile.create({
      data: {
        tenantId,
        firstName: input.firstName.trim(),
        lastName: input.lastName?.trim() ?? null,
        phone: input.phone ?? null,
        email: input.email?.toLowerCase() ?? null,
        notes: input.notes ?? null,
        tags: input.tags ?? [],
        dietaryRestrictions: input.dietaryRestrictions ?? [],
        allergies: input.allergies ?? [],
        alcoholPreferences: input.alcoholPreferences ?? [],
        specialOccasions: input.specialOccasions ?? null,
        vipTier: input.vipTier ?? 0,
        optInMarketing: input.optInMarketing ?? false,
        optInSms: input.optInSms ?? false,
        optInWhatsapp: input.optInWhatsapp ?? false,
      },
    });

    return NextResponse.json({ profile }, { status: 201 });
  } catch (err: any) {
    console.error("[guest-profiles POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create guest profile" },
      { status: 500 }
    );
  }
}
