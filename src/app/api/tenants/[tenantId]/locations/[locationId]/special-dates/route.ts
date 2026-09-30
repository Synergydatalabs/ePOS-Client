// ============================================================================
// /api/.../special-dates
//
//   GET  → list special dates (filterable by date range)
//   POST → create new special date (block reservations / walk-ins / online)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const createSchema = z.object({
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")),
  label: z.string().min(1).max(100),
  blockReservations: z.boolean().optional().default(false),
  blockWalkins: z.boolean().optional().default(false),
  blockOnline: z.boolean().optional().default(false),
  customOpenTime: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM").optional(),
  customCloseTime: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM").optional(),
  publicMessage: z.string().max(500).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const loc = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    if (!loc) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const now = new Date();
    const from = fromParam
      ? new Date(fromParam)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = toParam
      ? new Date(toParam)
      : new Date(from.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days

    const dates = await prisma.specialDate.findMany({
      where: { locationId, date: { gte: from, lt: to } },
      orderBy: { date: "asc" },
    });

    return NextResponse.json({ dates });
  } catch (err: any) {
    console.error("[special-dates GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load special dates" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const loc = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    if (!loc) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // Normalize date to start-of-day UTC
    let dateValue: Date;
    if (input.date.length === 10) {
      // YYYY-MM-DD → midnight UTC
      dateValue = new Date(input.date + "T00:00:00Z");
    } else {
      const d = new Date(input.date);
      dateValue = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    // Upsert (one special date per location per day)
    const created = await prisma.specialDate.upsert({
      where: {
        locationId_date: { locationId, date: dateValue },
      },
      update: {
        label: input.label.trim(),
        blockReservations: input.blockReservations,
        blockWalkins: input.blockWalkins,
        blockOnline: input.blockOnline,
        customOpenTime: input.customOpenTime ?? null,
        customCloseTime: input.customCloseTime ?? null,
        publicMessage: input.publicMessage ?? null,
      },
      create: {
        locationId,
        date: dateValue,
        label: input.label.trim(),
        blockReservations: input.blockReservations,
        blockWalkins: input.blockWalkins,
        blockOnline: input.blockOnline,
        customOpenTime: input.customOpenTime ?? null,
        customCloseTime: input.customCloseTime ?? null,
        publicMessage: input.publicMessage ?? null,
      },
    });

    return NextResponse.json({ specialDate: created }, { status: 201 });
  } catch (err: any) {
    console.error("[special-dates POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create special date" },
      { status: 500 }
    );
  }
}
