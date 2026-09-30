import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/vehicles/[vehicleId] — Get vehicle details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; vehicleId: string }> }
) {
  try {
    const { tenantId, vehicleId } = await params;

    const vehicles: any[] = await prisma.$queryRawUnsafe(`
      SELECT v.*,
        dp.id AS assigned_driver_id, dp.driver_name AS assigned_driver_name,
        dp.duty_status AS driver_duty_status, dp.license_number AS driver_license,
        dp.avg_rating AS driver_rating
      FROM vehicles v
      LEFT JOIN driver_profiles dp ON dp.vehicle_id = v.id AND dp.is_active = true
      WHERE v.id = $1 AND v.tenant_id = $2
    `, vehicleId, tenantId);

    if (vehicles.length === 0) {
      return NextResponse.json(
        { success: false, error: "Vehicle not found" },
        { status: 404 }
      );
    }

    // Get trip count for this vehicle
    const tripStats: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total_trips
      FROM trips t
      JOIN driver_profiles dp ON t.driver_profile_id = dp.id
      WHERE dp.vehicle_id = $1
    `, vehicleId);

    return NextResponse.json({
      success: true,
      vehicle: vehicles[0],
      tripCount: tripStats[0]?.total_trips || 0,
    });
  } catch (error) {
    console.error("Error getting vehicle:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get vehicle" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/vehicles/[vehicleId] — Update vehicle
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; vehicleId: string }> }
) {
  try {
    const { tenantId, vehicleId } = await params;
    const body = await request.json();

    const {
      plateNumber, make, model, year, color,
      capacity, vehicleType, insuranceExpiry,
      registrationExpiry, notes, isActive,
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

    addField("plate_number", plateNumber);
    addField("make", make);
    addField("model", model);
    addField("year", year);
    addField("color", color);
    addField("capacity", capacity);
    addField("vehicle_type", vehicleType);
    addField("insurance_expiry", insuranceExpiry ? new Date(insuranceExpiry) : undefined);
    addField("registration_expiry", registrationExpiry ? new Date(registrationExpiry) : undefined);
    addField("notes", notes);
    addField("is_active", isActive);

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = NOW()`);

    // If changing plate number, check for duplicates
    if (plateNumber) {
      const existing: any[] = await prisma.$queryRawUnsafe(`
        SELECT id FROM vehicles WHERE tenant_id = $1 AND plate_number = $2 AND id != $3
      `, tenantId, plateNumber, vehicleId);

      if (existing.length > 0) {
        return NextResponse.json(
          { success: false, error: "A vehicle with this plate number already exists" },
          { status: 409 }
        );
      }
    }

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE vehicles
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING *
    `, ...values, vehicleId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Vehicle not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, vehicle: updated[0] });
  } catch (error) {
    console.error("Error updating vehicle:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update vehicle" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/vehicles/[vehicleId] — Deactivate vehicle
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; vehicleId: string }> }
) {
  try {
    const { tenantId, vehicleId } = await params;

    // Check if vehicle is assigned to an active driver with active trips
    const activeDrivers: any[] = await prisma.$queryRawUnsafe(`
      SELECT dp.id, dp.driver_name FROM driver_profiles dp
      WHERE dp.vehicle_id = $1 AND dp.is_active = true AND dp.duty_status != 'offline'
    `, vehicleId);

    if (activeDrivers.length > 0) {
      return NextResponse.json(
        { success: false, error: `Vehicle is assigned to active driver(s): ${activeDrivers.map((d: any) => d.driver_name).join(", ")}. Reassign them first.` },
        { status: 400 }
      );
    }

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE vehicles
      SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `, vehicleId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Vehicle not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, vehicle: updated[0] });
  } catch (error) {
    console.error("Error deactivating vehicle:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to deactivate vehicle" },
      { status: 500 }
    );
  }
}
