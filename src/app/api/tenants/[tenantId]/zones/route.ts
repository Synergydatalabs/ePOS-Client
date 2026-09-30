import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/zones — List zones
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const zoneType = searchParams.get("zoneType");
    const isActive = searchParams.get("isActive");

    let whereClause = `WHERE tenant_id = $1`;
    if (zoneType) whereClause += ` AND zone_type = '${zoneType}'`;
    if (isActive !== null && isActive !== undefined && isActive !== "") {
      whereClause += ` AND is_active = ${isActive === "true"}`;
    }

    const zones = await prisma.$queryRawUnsafe(`
      SELECT * FROM zones
      ${whereClause}
      ORDER BY name ASC
    `, tenantId);

    return NextResponse.json({ success: true, zones });
  } catch (error) {
    console.error("Error listing zones:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list zones" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/zones — Create zone
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const { name, zoneType, boundary, surgeCents, surchargeMultiplier, description } = body;

    if (!name || !zoneType) {
      return NextResponse.json(
        { success: false, error: "name and zoneType are required" },
        { status: 400 }
      );
    }

    const validTypes = ["SURCHARGE", "GEOFENCE", "SERVICE_AREA", "AIRPORT", "RESTRICTED"];
    if (!validTypes.includes(zoneType)) {
      return NextResponse.json(
        { success: false, error: `Invalid zoneType. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const zoneId = crypto.randomUUID();

    const zone: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO zones (
        id, tenant_id, name, zone_type, boundary, surcharge_cents,
        surcharge_multiplier, description, is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW()
      )
      RETURNING *
    `,
      zoneId, tenantId, name, zoneType,
      boundary ? JSON.stringify(boundary) : null,
      surgeCents || 0,
      surchargeMultiplier || 1.0,
      description || null
    );

    return NextResponse.json({ success: true, zone: zone[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating zone:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create zone" },
      { status: 500 }
    );
  }
}
