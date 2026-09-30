// ============================================================================
// /api/.../waitlist/[entryId]
//
//   PATCH  → update party size, wait time, notes, status, seat at table
//   DELETE → cancel entry (soft — sets status CANCELLED, preserves history)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const patchSchema = z.object({
  customerName: z.string().min(1).max(200).optional(),
  customerPhone: z.string().min(7).max(30).optional(),
  partySize: z.number().int().min(1).max(50).optional(),
  preferredArea: z.string().max(50).nullable().optional(),
  preferredSectionId: z.string().uuid().nullable().optional(),
  quotedWaitMinutes: z.number().int().min(0).max(480).optional(),
  notes: z.string().max(500).nullable().optional(),
  status: z
    .enum(["WAITING", "NOTIFIED", "CONFIRMED", "SEATED", "NO_SHOW", "CANCELLED"])
    .optional(),
  seatedAtTableId: z.string().uuid().nullable().optional(),
});

async function verifyEntry(
  tenantId: string,
  locationId: string,
  entryId: string
) {
  return prisma.waitlistEntry.findFirst({
    where: {
      id: entryId,
      locationId,
      location: { tenantId },
    },
  });
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ tenantId: string; locationId: string; entryId: string }>;
  }
) {
  try {
    const { tenantId, locationId, entryId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const existing = await verifyEntry(tenantId, locationId, entryId);
    if (!existing) {
      return NextResponse.json({ error: "Waitlist entry not found" }, { status: 404 });
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

    // If seating, verify table exists in this location
    if (input.seatedAtTableId) {
      const t = await prisma.table.findFirst({
        where: { id: input.seatedAtTableId, locationId, isActive: true },
        select: { id: true },
      });
      if (!t) {
        return NextResponse.json({ error: "Table not found" }, { status: 400 });
      }
    }

    const data: any = {};
    if (input.customerName !== undefined) data.customerName = input.customerName.trim();
    if (input.customerPhone !== undefined) data.customerPhone = input.customerPhone;
    if (input.partySize !== undefined) data.partySize = input.partySize;
    if (input.preferredArea !== undefined) data.preferredArea = input.preferredArea;
    if (input.preferredSectionId !== undefined)
      data.preferredSectionId = input.preferredSectionId;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.quotedWaitMinutes !== undefined) {
      data.quotedWaitMinutes = input.quotedWaitMinutes;
      data.estimatedSeatingAt = new Date(Date.now() + input.quotedWaitMinutes * 60_000);
    }

    // Status transitions with timestamp updates
    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status;
      if (input.status === "SEATED") {
        data.seatedAt = new Date();
        if (input.seatedAtTableId !== undefined)
          data.seatedAtTableId = input.seatedAtTableId;
      }
    } else if (input.seatedAtTableId !== undefined) {
      data.seatedAtTableId = input.seatedAtTableId;
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id: entryId },
      data,
      include: {
        preferredSection: { select: { id: true, name: true, color: true } },
        guestProfile: {
          select: { id: true, firstName: true, lastName: true, visitCount: true },
        },
        seatedAtTable: { select: { id: true, tableNumber: true } },
      },
    });

    // Side effect: if SEATED, mark the table OCCUPIED (mirrors floor view flow)
    if (input.status === "SEATED" && updated.seatedAtTableId) {
      await prisma.table
        .update({
          where: { id: updated.seatedAtTableId },
          data: {
            status: "OCCUPIED",
            seatedAt: new Date(),
            guestCount: updated.partySize,
            currentServerId: auth.context.membership.id,
          },
        })
        .catch((err) => console.warn("Failed to mark table occupied:", err));
    }

    return NextResponse.json({ entry: updated });
  } catch (err: any) {
    console.error("[waitlist PATCH] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update waitlist entry" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ tenantId: string; locationId: string; entryId: string }>;
  }
) {
  try {
    const { tenantId, locationId, entryId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const existing = await verifyEntry(tenantId, locationId, entryId);
    if (!existing) {
      return NextResponse.json({ error: "Waitlist entry not found" }, { status: 404 });
    }

    await prisma.waitlistEntry.update({
      where: { id: entryId },
      data: { status: "CANCELLED" },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[waitlist DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to cancel waitlist entry" },
      { status: 500 }
    );
  }
}
