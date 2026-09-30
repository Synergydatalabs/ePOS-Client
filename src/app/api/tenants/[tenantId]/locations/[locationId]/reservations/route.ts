// ============================================================================
// /api/tenants/[tenantId]/locations/[locationId]/reservations
//
//   GET  → list reservations (filterable by date range, status)
//          Query params:
//            ?from=ISO (default: today 00:00)
//            ?to=ISO (default: from + 7 days)
//            ?status=CONFIRMED,ARRIVED,SEATED... (comma-separated)
//            ?limit=100 (max 500)
//   POST → create a new reservation
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { sendSms } from "@/lib/sms/client";
import { reservationConfirmationMessage } from "@/lib/sms/templates";
import {
  resolveDurationMinutes,
  checkOverbooking,
} from "@/lib/reservation-capacity";

const createSchema = z.object({
  // Customer info (required for any reservation)
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().min(7).max(30).optional(),
  customerEmail: z.string().email().max(255).optional(),

  // The booking itself
  partySize: z.number().int().min(1).max(50),
  bookedFor: z.string().datetime(),
  // Optional — when absent, server derives from TenantSettings.
  // partySizeDurationMap (Phase E R2). Explicit override still wins so
  // a manager can extend a specific big table without touching settings.
  estimatedDurationMinutes: z.number().int().min(15).max(480).optional(),
  tableId: z.string().uuid().optional(),

  // Context (optional)
  source: z
    .enum(["WEBSITE", "GOOGLE", "PHONE", "WALK_IN", "WHATSAPP", "PARTNER", "INTERNAL"])
    .optional()
    .default("INTERNAL"),
  specialOccasion: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
  internalNotes: z.string().max(1000).optional(),
  guestProfileId: z.string().uuid().optional(),
  guestTags: z.array(z.string().max(50)).optional(),
});

async function verifyLocation(tenantId: string, locationId: string) {
  return prisma.location.findFirst({
    where: { id: locationId, tenantId },
    select: { id: true },
  });
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
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const statusParam = searchParams.get("status");
    const limitParam = parseInt(searchParams.get("limit") || "100", 10);

    // Default range: today 00:00 → +7 days
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0
    );
    const from = fromParam ? new Date(fromParam) : todayStart;
    const to = toParam
      ? new Date(toParam)
      : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

    const statuses = statusParam
      ? (statusParam
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) =>
            [
              "PENDING_DEPOSIT",
              "CONFIRMED",
              "ARRIVED",
              "SEATED",
              "COMPLETED",
              "NO_SHOW",
              "CANCELLED",
            ].includes(s)
          ) as Array<
            | "PENDING_DEPOSIT"
            | "CONFIRMED"
            | "ARRIVED"
            | "SEATED"
            | "COMPLETED"
            | "NO_SHOW"
            | "CANCELLED"
          >)
      : undefined;

    const reservations = await prisma.reservation.findMany({
      where: {
        locationId,
        bookedFor: { gte: from, lt: to },
        ...(statuses && { status: { in: statuses } }),
      },
      include: {
        table: {
          select: {
            id: true,
            tableNumber: true,
            displayLabel: true,
            capacity: true,
            section: { select: { id: true, name: true } },
          },
        },
        guestProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            visitCount: true,
            vipTier: true,
            tags: true,
            allergies: true,
            dietaryRestrictions: true,
            preferredSectionId: true,
          },
        },
      },
      orderBy: { bookedFor: "asc" },
      take: Math.min(limitParam, 500),
    });

    return NextResponse.json({
      reservations,
      range: { from: from.toISOString(), to: to.toISOString() },
    });
  } catch (err: any) {
    console.error("[reservations GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load reservations" },
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

    // Special dates: check if reservations blocked for this date
    const bookedForDate = new Date(input.bookedFor);
    const dayStart = new Date(
      bookedForDate.getFullYear(),
      bookedForDate.getMonth(),
      bookedForDate.getDate()
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const specialDate = await prisma.specialDate.findFirst({
      where: {
        locationId,
        date: { gte: dayStart, lt: dayEnd },
      },
    });
    if (specialDate?.blockReservations) {
      return NextResponse.json(
        {
          error: `Reservations blocked for this date: ${specialDate.label}`,
          publicMessage: specialDate.publicMessage,
        },
        { status: 409 }
      );
    }

    // Verify tableId belongs to this location if provided
    if (input.tableId) {
      const table = await prisma.table.findFirst({
        where: { id: input.tableId, locationId, isActive: true, isBookable: true },
        select: { id: true },
      });
      if (!table) {
        return NextResponse.json(
          { error: "Table not found or not bookable" },
          { status: 400 }
        );
      }
    }

    // Verify guestProfileId if provided
    if (input.guestProfileId) {
      const profile = await prisma.guestProfile.findFirst({
        where: { id: input.guestProfileId, tenantId },
        select: { id: true },
      });
      if (!profile) {
        return NextResponse.json(
          { error: "Guest profile not found" },
          { status: 400 }
        );
      }
    }

    // Auto-link to existing guest profile if phone or email matches
    // (and no explicit guestProfileId provided)
    let guestProfileId = input.guestProfileId;
    if (!guestProfileId && (input.customerPhone || input.customerEmail)) {
      const existing = await prisma.guestProfile.findFirst({
        where: {
          tenantId,
          OR: [
            ...(input.customerPhone ? [{ phone: input.customerPhone }] : []),
            ...(input.customerEmail
              ? [{ email: input.customerEmail.toLowerCase() }]
              : []),
          ],
        },
        select: { id: true },
      });
      if (existing) guestProfileId = existing.id;
    }

    // Phase E R2: resolve duration from tenant matrix (unless client sent
    // an explicit override) + reject overbookings before we write.
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        partySizeDurationMap: true,
        reservationTurnBufferMinutes: true,
      },
    });
    const effectiveDuration =
      input.estimatedDurationMinutes ??
      resolveDurationMinutes(input.partySize, settings?.partySizeDurationMap);
    const turnBuffer = settings?.reservationTurnBufferMinutes ?? 15;

    const capacity = await checkOverbooking({
      locationId,
      bookedFor: bookedForDate,
      durationMinutes: effectiveDuration,
      partySize: input.partySize,
      turnBufferMinutes: turnBuffer,
    });
    if (!capacity.ok) {
      // 409 = conflict. Front-end can surface the friendly reason directly.
      return NextResponse.json(
        {
          error: capacity.reason,
          totalCapacity: capacity.totalCapacity,
          bookedDuringWindow: capacity.bookedDuringWindow,
          wouldExceedBy: capacity.wouldExceedBy,
        },
        { status: 409 }
      );
    }

    const reservation = await prisma.reservation.create({
      data: {
        locationId,
        tableId: input.tableId ?? null,
        guestProfileId: guestProfileId ?? null,
        customerName: input.customerName.trim(),
        customerPhone: input.customerPhone ?? null,
        customerEmail: input.customerEmail?.toLowerCase() ?? null,
        partySize: input.partySize,
        bookedFor: bookedForDate,
        estimatedDurationMinutes: effectiveDuration,
        source: input.source,
        status: "CONFIRMED",
        specialOccasion: input.specialOccasion ?? null,
        notes: input.notes ?? null,
        internalNotes: input.internalNotes ?? null,
        guestTags: input.guestTags ?? [],
        createdById: auth.context.membership.id,
      },
      include: {
        table: {
          select: { id: true, tableNumber: true, displayLabel: true, capacity: true },
        },
        guestProfile: {
          select: { id: true, firstName: true, lastName: true, phone: true, email: true },
        },
      },
    });

    // Fire-and-forget SMS confirmation (don't block the API response on this)
    if (reservation.customerPhone) {
      // Load tenant name for the message — we have locationId in scope already
      const locWithTenant = await prisma.location.findUnique({
        where: { id: locationId },
        select: { tenant: { select: { name: true } } },
      });
      const restaurantName = locWithTenant?.tenant?.name || "Restaurant";

      // Async — don't await (already returning response)
      sendSms({
        tenantId,
        to: reservation.customerPhone,
        body: reservationConfirmationMessage({
          restaurantName,
          customerName: reservation.customerName,
          partySize: reservation.partySize,
          bookedFor: reservation.bookedFor,
        }),
        category: "reservation_confirm",
      })
        .then(async (result) => {
          if (result.ok) {
            await prisma.reservation.update({
              where: { id: reservation.id },
              data: { confirmationSentAt: new Date() },
            }).catch(() => {});
          }
        })
        .catch((e) => console.warn("[reservations] SMS send failed:", e));
    }

    return NextResponse.json({ reservation }, { status: 201 });
  } catch (err: any) {
    console.error("[reservations POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create reservation" },
      { status: 500 }
    );
  }
}
