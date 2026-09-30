// POST /api/tenants/[tenantId]/guest-profiles
//   Create a new guest profile from the POS "walk-in" quick-add form.
//   Body: { firstName, lastName?, email?, phone?, notes?, optInMarketing?, optInSms? }
//   Dedupes on phone / email within the tenant so double-tapping "Create"
//   doesn't spawn two rows.
//
// GET /api/tenants/[tenantId]/guest-profiles?limit=25
//   Simple recent-guests listing (unused by POS today, but a natural
//   companion for the search endpoint).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const {
      firstName,
      lastName,
      email,
      phone,
      notes,
      optInMarketing,
      optInSms,
    } = body as {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      notes?: string;
      optInMarketing?: boolean;
      optInSms?: boolean;
    };

    if (!firstName || !firstName.trim()) {
      return NextResponse.json(
        { error: "First name is required" },
        { status: 400 }
      );
    }
    const cleanEmail = email?.trim() || null;
    const cleanPhone = phone?.trim() || null;

    // Dedupe by phone OR email inside the tenant. If we find a match,
    // return it as-is so the POS treats POST like an idempotent lookup.
    if (cleanPhone || cleanEmail) {
      const existing = await prisma.guestProfile.findFirst({
        where: {
          tenantId,
          OR: [
            ...(cleanPhone ? [{ phone: cleanPhone }] : []),
            ...(cleanEmail
              ? [{ email: { equals: cleanEmail, mode: "insensitive" as const } }]
              : []),
          ],
        },
      });
      if (existing) {
        return NextResponse.json({ success: true, guest: existing, existed: true });
      }
    }

    const guest = await prisma.guestProfile.create({
      data: {
        tenantId,
        firstName: firstName.trim(),
        lastName: lastName?.trim() || null,
        email: cleanEmail,
        phone: cleanPhone,
        notes: notes || null,
        optInMarketing: optInMarketing ?? false,
        optInSms: optInSms ?? false,
      },
    });

    return NextResponse.json({ success: true, guest });
  } catch (error: any) {
    console.error("[guest-profiles POST] error:", error);
    return NextResponse.json(
      { error: error?.message || "Create failed", code: error?.code },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const limitParam = parseInt(
      new URL(request.url).searchParams.get("limit") || "25",
      10
    );
    const limit = Math.min(100, Math.max(1, isNaN(limitParam) ? 25 : limitParam));

    const guests = await prisma.guestProfile.findMany({
      where: { tenantId },
      orderBy: { lastVisitAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ success: true, guests });
  } catch (error: any) {
    console.error("[guest-profiles GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load" },
      { status: 500 }
    );
  }
}
