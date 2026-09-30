// ============================================================================
// /api/.../reservations/[reservationId]
//
//   GET    → full reservation detail
//   PATCH  → update (edit details, change status, assign/unassign table)
//   DELETE → cancel reservation (sets status=CANCELLED, doesn't hard-delete)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const patchSchema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  customerPhone: z.string().min(7).max(30).nullable().optional(),
  customerEmail: z.string().email().max(255).nullable().optional(),
  partySize: z.number().int().min(1).max(50).optional(),
  bookedFor: z.string().datetime().optional(),
  estimatedDurationMinutes: z.number().int().min(15).max(480).optional(),
  tableId: z.string().uuid().nullable().optional(),
  status: z
    .enum([
      "PENDING_DEPOSIT",
      "CONFIRMED",
      "ARRIVED",
      "SEATED",
      "COMPLETED",
      "NO_SHOW",
      "CANCELLED",
    ])
    .optional(),
  specialOccasion: z.string().max(50).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  internalNotes: z.string().max(1000).nullable().optional(),
  guestTags: z.array(z.string().max(50)).optional(),
});

async function verifyReservation(
  tenantId: string,
  locationId: string,
  reservationId: string
) {
  return prisma.reservation.findFirst({
    where: {
      id: reservationId,
      locationId,
      location: { tenantId },
    },
  });
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ tenantId: string; locationId: string; reservationId: string }>;
  }
) {
  try {
    const { tenantId, locationId, reservationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const r = await prisma.reservation.findFirst({
      where: { id: reservationId, locationId, location: { tenantId } },
      include: {
        table: {
          select: {
            id: true,
            tableNumber: true,
            displayLabel: true,
            capacity: true,
            section: { select: { id: true, name: true, color: true } },
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
            lifetimeSpend: true,
            vipTier: true,
            tags: true,
            allergies: true,
            dietaryRestrictions: true,
            notes: true,
            lastVisitAt: true,
          },
        },
        createdBy: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    if (!r) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    return NextResponse.json({ reservation: r });
  } catch (err: any) {
    console.error("[reservation GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load reservation" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ tenantId: string; locationId: string; reservationId: string }>;
  }
) {
  try {
    const { tenantId, locationId, reservationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const existing = await verifyReservation(tenantId, locationId, reservationId);
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // Verify table if changing it
    if (input.tableId) {
      const table = await prisma.table.findFirst({
        where: { id: input.tableId, locationId, isActive: true },
        select: { id: true },
      });
      if (!table) {
        return NextResponse.json({ error: "Table not found" }, { status: 400 });
      }
    }

    // Build data — also bump state-transition timestamps
    const data: any = {};

    if (input.customerName !== undefined) data.customerName = input.customerName.trim();
    if (input.customerPhone !== undefined) data.customerPhone = input.customerPhone;
    if (input.customerEmail !== undefined)
      data.customerEmail = input.customerEmail?.toLowerCase() ?? null;
    if (input.partySize !== undefined) data.partySize = input.partySize;
    if (input.bookedFor !== undefined) data.bookedFor = new Date(input.bookedFor);
    if (input.estimatedDurationMinutes !== undefined)
      data.estimatedDurationMinutes = input.estimatedDurationMinutes;
    if (input.tableId !== undefined) data.tableId = input.tableId;
    if (input.specialOccasion !== undefined) data.specialOccasion = input.specialOccasion;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.internalNotes !== undefined) data.internalNotes = input.internalNotes;
    if (input.guestTags !== undefined) data.guestTags = input.guestTags;

    // Status transitions with timestamp bumps
    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status;
      const now = new Date();
      if (input.status === "ARRIVED") data.arrivedAt = now;
      else if (input.status === "SEATED") data.seatedAt = now;
      else if (input.status === "COMPLETED") data.completedAt = now;
      else if (input.status === "CANCELLED") data.cancelledAt = now;
    }

    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data,
      include: {
        table: { select: { id: true, tableNumber: true, displayLabel: true, capacity: true } },
        guestProfile: {
          select: { id: true, firstName: true, lastName: true, phone: true, email: true },
        },
      },
    });

    return NextResponse.json({ reservation: updated });
  } catch (err: any) {
    console.error("[reservation PATCH] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update reservation" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ tenantId: string; locationId: string; reservationId: string }>;
  }
) {
  try {
    const { tenantId, locationId, reservationId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const existing = await verifyReservation(tenantId, locationId, reservationId);
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const reason = searchParams.get("reason") || "Cancelled by staff";

    // Soft cancel — preserves history for reporting + no-show counting
    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledReason: reason,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[reservation DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to cancel reservation" },
      { status: 500 }
    );
  }
}
