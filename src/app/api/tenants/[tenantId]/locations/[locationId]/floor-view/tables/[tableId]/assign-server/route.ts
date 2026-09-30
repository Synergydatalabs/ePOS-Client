// ============================================================================
// POST /api/.../floor-view/tables/[tableId]/assign-server
//
// Assign or unassign a server to/from a table.
// Body: { serverId: string | null }
//
// Setting to null clears the server assignment (table goes back to gray).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const bodySchema = z.object({
  serverId: z.string().uuid().nullable(),
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
      select: { id: true },
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

    // Verify server belongs to this tenant if provided
    if (parsed.data.serverId) {
      const server = await prisma.membership.findFirst({
        where: { id: parsed.data.serverId, tenantId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!server) {
        return NextResponse.json(
          { error: "Server not found or not active" },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.table.update({
      where: { id: tableId },
      data: { currentServerId: parsed.data.serverId },
      select: {
        id: true,
        currentServer: {
          select: { id: true, firstName: true, lastName: true, color: true },
        },
      },
    });

    return NextResponse.json({ table: updated });
  } catch (err: any) {
    console.error("[assign-server] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to assign server" },
      { status: 500 }
    );
  }
}
