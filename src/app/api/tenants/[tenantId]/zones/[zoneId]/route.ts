import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/zones/[zoneId] — Get zone details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; zoneId: string }> }
) {
  try {
    const { tenantId, zoneId } = await params;

    const zones: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM zones WHERE id = $1 AND tenant_id = $2
    `, zoneId, tenantId);

    if (zones.length === 0) {
      return NextResponse.json(
        { success: false, error: "Zone not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, zone: zones[0] });
  } catch (error) {
    console.error("Error getting zone:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get zone" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/zones/[zoneId] — Update zone
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; zoneId: string }> }
) {
  try {
    const { tenantId, zoneId } = await params;
    const body = await request.json();

    const { name, zoneType, boundary, surgeCents, surchargeMultiplier, description, isActive } = body;

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

    addField("name", name);
    addField("zone_type", zoneType);
    addField("boundary", boundary ? JSON.stringify(boundary) : undefined);
    addField("surcharge_cents", surgeCents);
    addField("surcharge_multiplier", surchargeMultiplier);
    addField("description", description);
    addField("is_active", isActive);

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = NOW()`);

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE zones
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING *
    `, ...values, zoneId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Zone not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, zone: updated[0] });
  } catch (error) {
    console.error("Error updating zone:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update zone" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/zones/[zoneId] — Delete zone (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; zoneId: string }> }
) {
  try {
    const { tenantId, zoneId } = await params;

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE zones
      SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `, zoneId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Zone not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, zone: updated[0] });
  } catch (error) {
    console.error("Error deleting zone:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to delete zone" },
      { status: 500 }
    );
  }
}
