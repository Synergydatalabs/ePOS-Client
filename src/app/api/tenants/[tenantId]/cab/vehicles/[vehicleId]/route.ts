import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// PUT /api/tenants/[tenantId]/cab/vehicles/[vehicleId] — Update vehicle
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; vehicleId: string }> }
) {
  try {
    const { tenantId, vehicleId } = await params;
    const body = await request.json();

    const { plate, make, model, year, color, capacity, type } = body;

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

    addField("plate_number", plate);
    addField("make", make);
    addField("model", model);
    addField("year", year);
    addField("color", color);
    addField("capacity", capacity);
    addField("vehicle_type", type);

    if (setClauses.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push("updated_at = NOW()");

    // If changing plate, check for duplicates within tenant
    if (plate) {
      const existing: any[] = await prisma.$queryRawUnsafe(`
        SELECT id FROM vehicles WHERE tenant_id = $1::uuid AND plate_number = $2 AND id != $3::uuid
      `, tenantId, plate, vehicleId);

      if (existing.length > 0) {
        return NextResponse.json(
          { error: "A vehicle with this plate number already exists for this tenant" },
          { status: 409 }
        );
      }
    }

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE vehicles
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex}::uuid AND tenant_id = $${paramIndex + 1}::uuid
      RETURNING *
    `, ...values, vehicleId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "Vehicle not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, vehicle: updated[0] });
  } catch (error: any) {
    console.error("[CAB] Update vehicle error:", error);
    return NextResponse.json({ error: "Failed to update vehicle" }, { status: 500 });
  }
}

// DELETE /api/tenants/[tenantId]/cab/vehicles/[vehicleId] — Delete vehicle (hard delete, or 409 if trip history)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; vehicleId: string }> }
) {
  try {
    const { tenantId, vehicleId } = await params;

    // Attempt hard delete
    try {
      const deleted: any[] = await prisma.$queryRawUnsafe(`
        DELETE FROM vehicles
        WHERE id = $1::uuid AND tenant_id = $2::uuid
        RETURNING *
      `, vehicleId, tenantId);

      if (deleted.length === 0) {
        return NextResponse.json(
          { error: "Vehicle not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, vehicle: deleted[0] });
    } catch (deleteError: any) {
      // FK constraint violation — vehicle has trip history
      if (
        deleteError?.code === "P2003" ||
        deleteError?.message?.includes("foreign key") ||
        deleteError?.message?.includes("violates foreign key") ||
        deleteError?.code === "23503"
      ) {
        return NextResponse.json(
          { error: "Vehicle has trip history, cannot delete" },
          { status: 409 }
        );
      }
      throw deleteError;
    }
  } catch (error: any) {
    console.error("[CAB] Delete vehicle error:", error);
    return NextResponse.json({ error: "Failed to delete vehicle" }, { status: 500 });
  }
}
