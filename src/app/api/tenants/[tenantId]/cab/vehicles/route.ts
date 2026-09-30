import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/cab/vehicles — List all vehicles for tenant with assigned driver
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const vehicles: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        v.id,
        v.plate_number,
        v.make,
        v.model,
        v.year,
        v.color,
        v.capacity,
        v.vehicle_type,
        v.status,
        v.created_at,
        dp.id AS assigned_driver_id,
        CONCAT_WS(' ', m.first_name, m.last_name) AS assigned_driver_name
      FROM vehicles v
      LEFT JOIN driver_profiles dp ON dp.vehicle_id = v.id
      LEFT JOIN memberships m ON dp.membership_id = m.id
      WHERE v.tenant_id = $1::uuid
      ORDER BY v.created_at DESC
    `, tenantId);

    const formatted = vehicles.map((v: any) => ({
      id: v.id,
      plate: v.plate_number,
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      capacity: v.capacity,
      type: v.vehicle_type,
      status: v.status,
      assignedDriver: v.assigned_driver_id
        ? { id: v.assigned_driver_id, name: v.assigned_driver_name || "Unknown" }
        : null,
      assignedDriverId: v.assigned_driver_id || null,
      assignedDriverName: v.assigned_driver_name || null,
      createdAt: v.created_at,
    }));

    return NextResponse.json({ success: true, vehicles: formatted });
  } catch (error: any) {
    console.error("[CAB] Vehicles error:", error);
    return NextResponse.json({ error: "Failed to load vehicles" }, { status: 500 });
  }
}

// POST /api/tenants/[tenantId]/cab/vehicles — Create a new vehicle
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const { plate, make, model, year, color, capacity, type } = body;

    if (!plate || !make || !model) {
      return NextResponse.json(
        { error: "plate, make, and model are required" },
        { status: 400 }
      );
    }

    // Check for duplicate plate number within tenant
    const existing: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM vehicles WHERE tenant_id = $1::uuid AND plate_number = $2
    `, tenantId, plate);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "A vehicle with this plate number already exists for this tenant" },
        { status: 409 }
      );
    }

    const vehicleId = crypto.randomUUID();

    const created: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO vehicles (
        id, tenant_id, plate_number, make, model, year, color,
        capacity, vehicle_type, status, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7,
        $8, $9, 'active', NOW(), NOW()
      )
      RETURNING *
    `,
      vehicleId, tenantId, plate, make, model,
      year || null, color || null,
      capacity || 4, type || 'sedan'
    );

    return NextResponse.json({ success: true, vehicle: created[0] }, { status: 201 });
  } catch (error: any) {
    console.error("[CAB] Create vehicle error:", error);
    return NextResponse.json({ error: "Failed to create vehicle" }, { status: 500 });
  }
}
