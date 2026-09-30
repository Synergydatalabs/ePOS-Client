// ============================================================================
// POST /api/.../locations/[locationId]/floor-view/tables/[tableId]/status
//
// Update a table's live status from the staff floor view.
// Body: { status: TableStatus, guestCount?: number, seatedAt?: ISO }
//
// Status transitions are validated:
//   AVAILABLE → OCCUPIED  (seating guests)
//   OCCUPIED  → CLEANING  (guests left)
//   CLEANING  → AVAILABLE (table cleaned)
//   * → BLOCKED           (manager block)
//   * → RESERVED          (held for reservation)
//
// We don't strictly enforce transition rules at the DB layer — staff
// sometimes need to override. We just record the change. The trigger
// from Phase 4 migration auto-bumps last_status_change_at.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const bodySchema = z.object({
  status: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "BLOCKED"]),
  guestCount: z.number().int().min(1).max(50).optional(),
  // For seating actions, allow staff to backdate seatedAt (e.g. forgot to mark)
  seatedAt: z.string().datetime().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; tableId: string }> }
) {
  try {
    const { tenantId, locationId, tableId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const table = await prisma.table.findFirst({
      where: { id: tableId, locationId, location: { tenantId } },
      select: { id: true, status: true },
    });
    if (!table) {
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const { status, guestCount, seatedAt } = parsed.data;

    // Build update data
    const data: any = { status };

    if (status === "OCCUPIED") {
      // Seating: capture guest count + when seated
      data.seatedAt = seatedAt ? new Date(seatedAt) : new Date();
      if (guestCount !== undefined) data.guestCount = guestCount;
      // Default server to whoever's seating them (can be reassigned later)
      data.currentServerId = auth.context.membership.id;
    } else if (status === "AVAILABLE") {
      // Trigger handles clearing seatedAt/guestCount/currentServerId via the
      // db-side trigger we added in Phase 4 migration. But pass null explicitly
      // too so the Prisma client doesn't get confused.
      data.seatedAt = null;
      data.guestCount = null;
      data.currentServerId = null;
    }

    const updated = await prisma.table.update({
      where: { id: tableId },
      data,
      select: {
        id: true,
        status: true,
        seatedAt: true,
        guestCount: true,
        currentServer: {
          select: { id: true, firstName: true, lastName: true, color: true },
        },
        lastStatusChangeAt: true,
      },
    });

    return NextResponse.json({ table: updated });
  } catch (err: any) {
    console.error("[table status POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update status" },
      { status: 500 }
    );
  }
}
