import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/support-tickets/[ticketId] — Get ticket details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; ticketId: string }> }
) {
  try {
    const { tenantId, ticketId } = await params;

    const tickets: any[] = await prisma.$queryRawUnsafe(`
      SELECT st.*,
        t.trip_number, t.status AS trip_status,
        t.pickup_address, t.dropoff_address,
        t.customer_name AS trip_customer_name,
        dp.driver_name, dp.license_number AS driver_license
      FROM support_tickets st
      LEFT JOIN trips t ON st.trip_id = t.id
      LEFT JOIN driver_profiles dp ON t.driver_profile_id = dp.id
      WHERE st.id = $1 AND st.tenant_id = $2
    `, ticketId, tenantId);

    if (tickets.length === 0) {
      return NextResponse.json(
        { success: false, error: "Support ticket not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, ticket: tickets[0] });
  } catch (error) {
    console.error("Error getting support ticket:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get support ticket" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/support-tickets/[ticketId] — Update ticket (status, assign, resolve)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; ticketId: string }> }
) {
  try {
    const { tenantId, ticketId } = await params;
    const body = await request.json();

    const {
      status, priority, assignedTo, resolution, internalNotes, category,
    } = body;

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const addField = (column: string, value: any) => {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    };

    if (status) {
      const validStatuses = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
          { status: 400 }
        );
      }
      addField("status", status);

      if (status === "RESOLVED" || status === "CLOSED") {
        setClauses.push(`resolved_at = NOW()`);
      }
    }

    addField("priority", priority);
    addField("assigned_to", assignedTo);
    addField("resolution", resolution);
    addField("internal_notes", internalNotes);
    addField("category", category);

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
      WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING *
    `, ...values, ticketId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Support ticket not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, ticket: updated[0] });
  } catch (error) {
    console.error("Error updating support ticket:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update support ticket" },
      { status: 500 }
    );
  }
}
