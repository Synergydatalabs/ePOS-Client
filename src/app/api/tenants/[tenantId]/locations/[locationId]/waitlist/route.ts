// ============================================================================
// /api/.../locations/[locationId]/waitlist
//
//   GET  → list waitlist entries (default: today's active queue)
//   POST → add a new walk-in to the queue
//
// Quote algorithm (v1 — simple "manual multiplier"):
//   quote_minutes = (avg_turn_minutes / bookable_tables_fitting_party) + buffer
//
// v2 (later) can switch to Toast-style "Smart Algorithm" that uses
// historical seating data to predict more accurately.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const createSchema = z.object({
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().min(7).max(30),
  partySize: z.number().int().min(1).max(50),
  preferredArea: z.string().max(50).optional(),
  preferredSectionId: z.string().uuid().optional(),
  quotedWaitMinutes: z.number().int().min(0).max(480).optional(),
  notes: z.string().max(500).optional(),
});

async function verifyLocation(tenantId: string, locationId: string) {
  return prisma.location.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true },
  });
}

/**
 * Simple "manual multiplier" wait time estimator.
 * (Phase 5b v1 — Phase 5c will add Smart Algorithm option.)
 */
async function estimateWaitMinutes(
  locationId: string,
  partySize: number
): Promise<number> {
  // Count active waitlist ahead in queue
  const queueAhead = await prisma.waitlistEntry.count({
    where: {
      locationId,
      status: { in: ["WAITING", "NOTIFIED", "CONFIRMED"] },
    },
  });

  // Count tables that fit this party size and are currently OCCUPIED
  const occupiedTables = await prisma.table.count({
    where: {
      locationId,
      isActive: true,
      isBookable: true,
      status: "OCCUPIED",
      OR: [
        { maxPartySize: { gte: partySize } },
        { capacity: { gte: partySize } },
      ],
    },
  });

  // Heuristics: avg turn = 75 min, divide by occupied seats, add buffer per party ahead
  const avgTurnMinutes = 75;
  const baseWait = occupiedTables > 0 ? Math.round(avgTurnMinutes / occupiedTables) : 5;
  const perPartyBuffer = 10;
  return Math.min(180, baseWait + queueAhead * perPartyBuffer);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const loc = await verifyLocation(tenantId, locationId);
    if (!loc) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const showCompletedParam = searchParams.get("showCompleted");
    const showCompleted = showCompletedParam === "true";

    const entries = await prisma.waitlistEntry.findMany({
      where: {
        locationId,
        ...(!showCompleted && {
          status: { in: ["WAITING", "NOTIFIED", "CONFIRMED"] },
        }),
        // Last 24 hours
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      include: {
        preferredSection: { select: { id: true, name: true, color: true } },
        guestProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            visitCount: true,
            vipTier: true,
          },
        },
        seatedAtTable: { select: { id: true, tableNumber: true } },
      },
      orderBy: [
        // active entries first (created order), then completed
        { status: "asc" },
        { createdAt: "asc" },
      ],
      take: 200,
    });

    return NextResponse.json({ entries });
  } catch (err: any) {
    console.error("[waitlist GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load waitlist" },
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
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const loc = await verifyLocation(tenantId, locationId);
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

    // Verify section if provided
    if (input.preferredSectionId) {
      const section = await prisma.section.findFirst({
        where: {
          id: input.preferredSectionId,
          floorPlan: { locationId },
        },
        select: { id: true },
      });
      if (!section) {
        return NextResponse.json(
          { error: "Preferred section not found in this location" },
          { status: 400 }
        );
      }
    }

    // Auto-link to guest profile by phone
    const existingProfile = await prisma.guestProfile.findFirst({
      where: { tenantId, phone: input.customerPhone },
      select: { id: true },
    });

    // Estimate wait time if not provided
    const quotedWaitMinutes =
      input.quotedWaitMinutes ?? (await estimateWaitMinutes(locationId, input.partySize));

    const estimatedSeatingAt = new Date(Date.now() + quotedWaitMinutes * 60_000);

    const entry = await prisma.waitlistEntry.create({
      data: {
        locationId,
        guestProfileId: existingProfile?.id ?? null,
        customerName: input.customerName.trim(),
        customerPhone: input.customerPhone,
        partySize: input.partySize,
        preferredArea: input.preferredArea ?? null,
        preferredSectionId: input.preferredSectionId ?? null,
        quotedWaitMinutes,
        estimatedSeatingAt,
        notes: input.notes ?? null,
        status: "WAITING",
      },
      include: {
        preferredSection: { select: { id: true, name: true, color: true } },
        guestProfile: {
          select: { id: true, firstName: true, lastName: true, visitCount: true },
        },
      },
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err: any) {
    console.error("[waitlist POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to add to waitlist" },
      { status: 500 }
    );
  }
}
