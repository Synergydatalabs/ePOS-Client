import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/cab/support — List support tickets with optional filters
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status");
    const priority = searchParams.get("priority");

    let whereClause = `WHERE st.tenant_id = $1::uuid`;
    const values: any[] = [tenantId];
    let paramIndex = 2;

    if (status) {
      whereClause += ` AND st.status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }

    if (priority) {
      whereClause += ` AND st.priority = $${paramIndex}`;
      values.push(priority);
      paramIndex++;
    }

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        st.id, st.tenant_id, st.trip_id,
        st.reporter_type, st.reporter_name, st.reporter_phone, st.reporter_email,
        st.category, st.subject, st.description,
        st.status, st.priority, st.assigned_to,
        st.resolution, st.resolved_at,
        st.created_at, st.updated_at,
        t.trip_number
      FROM support_tickets st
      LEFT JOIN trips t ON st.trip_id = t.id
      ${whereClause}
      ORDER BY st.created_at DESC
    `, ...values);

    const tickets = rows.map((r: any) => ({
      id: r.id,
      ticketNumber: r.id.substring(0, 8).toUpperCase(),
      tenantId: r.tenant_id,
      tripId: r.trip_id,
      tripNumber: r.trip_number,
      reporterType: r.reporter_type,
      reporterName: r.reporter_name,
      reporterPhone: r.reporter_phone,
      reporterEmail: r.reporter_email,
      category: r.category,
      subject: r.subject,
      description: r.description,
      status: r.status,
      priority: r.priority,
      assignedTo: r.assigned_to,
      resolution: r.resolution,
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return NextResponse.json({ success: true, tickets });
  } catch (error: any) {
    console.error("[CAB] Error listing support tickets:", error);
    return NextResponse.json(
      { success: false, error: "Failed to list support tickets" },
      { status: 500 }
    );
  }
}
