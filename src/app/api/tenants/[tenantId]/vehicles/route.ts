import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/vehicles — List vehicles with assigned driver
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const vehicleType = searchParams.get("vehicleType");
    const isActive = searchParams.get("isActive");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let whereClause = `WHERE v.tenant_id = $1`;
    if (vehicleType) whereClause += ` AND v.vehicle_type = '${vehicleType}'`;
    if (isActive !== null && isActive !== undefined && isActive !== "") {
      whereClause += ` AND v.is_active = ${isActive === "true"}`;
    }

    const vehicles = await prisma.$queryRawUnsafe(`
      SELECT v.*,
        dp.id AS assigned_driver_id, dp.driver_name AS assigned_driver_name,
        dp.duty_status AS driver_duty_status, dp.license_number AS driver_license
      FROM vehicles v
      LEFT JOIN driver_profiles dp ON dp.vehicle_id = v.id AND dp.is_active = true
      ${whereClause}
      ORDER BY v.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, tenantId);

    const countResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total FROM vehicles v ${whereClause}
    `, tenantId);

    return NextResponse.json({
      success: true,
      vehicles,
      pagination: {
        total: countResult[0]?.total || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("Error listing vehicles:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list vehicles" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/vehicles — Add vehicle
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const {
      plateNumber, make, model, year, color,
      capacity, vehicleType, insuranceExpiry,
      registrationExpiry, notes,
    } = body;

    if (!plateNumber || !make || !model) {
      return NextResponse.json(
        { success: false, error: "plateNumber, make, and model are required" },
        { status: 400 }
      );
    }

    // Check for duplicate plate number within tenant
    const existing: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM vehicles WHERE tenant_id = $1 AND plate_number = $2
    `, tenantId, plateNumber);

    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: "A vehicle with this plate number already exists" },
        { status: 409 }
      );
    }

    const vehicleId = crypto.randomUUID();

    const vehicle: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO vehicles (
        id, tenant_id, plate_number, make, model, year, color,
        capacity, vehicle_type, insurance_expiry, registration_expiry,
        notes, is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, true, NOW(), NOW()
      )
      RETURNING *
    `,
      vehicleId, tenantId, plateNumber, make, model,
      year || null, color || null,
      capacity || 4, vehicleType || "SEDAN",
      insuranceExpiry ? new Date(insuranceExpiry) : null,
      registrationExpiry ? new Date(registrationExpiry) : null,
      notes || null
    );

    return NextResponse.json({ success: true, vehicle: vehicle[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating vehicle:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create vehicle" },
      { status: 500 }
    );
  }
}
