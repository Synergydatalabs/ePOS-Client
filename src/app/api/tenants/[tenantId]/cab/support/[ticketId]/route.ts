import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// PUT /api/tenants/[tenantId]/cab/support/[ticketId] — Update a support ticket
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; ticketId: string }> }
) {
  try {
    const { tenantId, ticketId } = await params;
    const body = await request.json();

    const { status, resolution } = body;

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;

      // Auto-set resolved_at when status becomes resolved
      if (status === "resolved") {
        setClauses.push(`resolved_at = NOW()`);
      }
    }

    if (resolution !== undefined) {
      setClauses.push(`resolution = $${paramIndex}`);
      values.push(resolution);
      paramIndex++;
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = NOW()`);

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE support_tickets
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex}::uuid AND tenant_id = $${paramIndex + 1}::uuid
      RETURNING *
    `, ...values, ticketId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Ticket not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, ticket: updated[0] });
  } catch (error: any) {
    console.error("[CAB] Error updating support ticket:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update support ticket" },
      { status: 500 }
    );
  }
}
