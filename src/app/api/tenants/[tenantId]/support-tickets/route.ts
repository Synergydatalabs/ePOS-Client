import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/support-tickets — List tickets with filters
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const category = searchParams.get("category");
    const tripId = searchParams.get("tripId");
    const assignedTo = searchParams.get("assignedTo");
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let whereClause = `WHERE st.tenant_id = $1`;
    if (status) whereClause += ` AND st.status = '${status}'`;
    if (priority) whereClause += ` AND st.priority = '${priority}'`;
    if (category) whereClause += ` AND st.category = '${category}'`;
    if (tripId) whereClause += ` AND st.trip_id = '${tripId}'`;
    if (assignedTo) whereClause += ` AND st.assigned_to = '${assignedTo}'`;

    const tickets = await prisma.$queryRawUnsafe(`
      SELECT st.*,
        t.trip_number, t.status AS trip_status
      FROM support_tickets st
      LEFT JOIN trips t ON st.trip_id = t.id
      ${whereClause}
      ORDER BY
        CASE st.priority
          WHEN 'URGENT' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'LOW' THEN 4
        END,
        st.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, tenantId);

    const countResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total FROM support_tickets st ${whereClause}
    `, tenantId);

    return NextResponse.json({
      success: true,
      tickets,
      pagination: {
        total: countResult[0]?.total || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error listing support tickets:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list support tickets" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/support-tickets — Create ticket
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const {
      tripId, reporterType, reporterId, reporterName, reporterContact,
      category, subject, description, priority,
    } = body;

    if (!subject || !description || !category) {
      return NextResponse.json(
        { success: false, error: "subject, description, and category are required" },
        { status: 400 }
      );
    }

    const validCategories = [
      "PAYMENT", "DRIVER_BEHAVIOR", "SAFETY", "LOST_ITEM",
      "ROUTE_ISSUE", "FARE_DISPUTE", "APP_BUG", "OTHER",
    ];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { success: false, error: `Invalid category. Must be one of: ${validCategories.join(", ")}` },
        { status: 400 }
      );
    }

    // If tripId provided, verify it belongs to tenant
    if (tripId) {
      const trips: any[] = await prisma.$queryRawUnsafe(`
        SELECT id FROM trips WHERE id = $1 AND tenant_id = $2
      `, tripId, tenantId);

      if (trips.length === 0) {
        return NextResponse.json(
          { success: false, error: "Trip not found" },
          { status: 404 }
        );
      }
    }

    const ticketId = crypto.randomUUID();
    const ticketNumber = `TKT-${Date.now().toString(36).toUpperCase()}`;

    const ticket: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO support_tickets (
        id, tenant_id, ticket_number, trip_id,
        reporter_type, reporter_id, reporter_name, reporter_contact,
        category, subject, description, priority,
        status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        'OPEN', NOW(), NOW()
      )
      RETURNING *
    `,
      ticketId, tenantId, ticketNumber, tripId || null,
      reporterType || "CUSTOMER", reporterId || null, reporterName || null, reporterContact || null,
      category, subject, description, priority || "MEDIUM"
    );

    return NextResponse.json({ success: true, ticket: ticket[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating support ticket:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create support ticket" },
      { status: 500 }
    );
  }
}
