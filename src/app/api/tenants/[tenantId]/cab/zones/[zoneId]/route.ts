import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; zoneId: string }> }
) {
  try {
    const { tenantId, zoneId } = await params;
    const body = await request.json();

    // Toggle active status
    if ("isActive" in body && Object.keys(body).length === 1) {
      const updated: any[] = await prisma.$queryRawUnsafe(
        `UPDATE zones
         SET is_active = $1, updated_at = NOW()
         WHERE id = $2::uuid AND tenant_id = $3::uuid
         RETURNING id, name, zone_type, description, surcharge_type, surcharge_amount,
                   surcharge_label, is_active, boundary, sort_order`,
        body.isActive,
        zoneId,
        tenantId
      );

      if (updated.length === 0) {
        return NextResponse.json(
          { error: "Zone not found" },
          { status: 404 }
        );
      }

      const z = updated[0];
      return NextResponse.json({
        id: z.id,
        name: z.name,
        type: z.zone_type,
        description: z.description,
        surchargeType: z.surcharge_type,
        surchargeAmount: z.surcharge_amount,
        surchargeLabel: z.surcharge_label,
        isActive: z.is_active,
        boundary: z.boundary,
        sortOrder: z.sort_order,
      });
    }

    // General update
    const { name, type, surchargeType, surchargeAmount, description } = body;

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (type !== undefined) {
      setClauses.push(`zone_type = $${paramIndex++}`);
      values.push(type);
    }
    if (surchargeType !== undefined) {
      setClauses.push(`surcharge_type = $${paramIndex++}`);
      values.push(surchargeType);
    }
    if (surchargeAmount !== undefined) {
      setClauses.push(`surcharge_amount = $${paramIndex++}`);
      values.push(surchargeAmount);
    }
    if (description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(description);
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = NOW()`);

    const zoneIdParam = `$${paramIndex++}`;
    const tenantIdParam = `$${paramIndex++}`;
    values.push(zoneId, tenantId);

    const updated: any[] = await prisma.$queryRawUnsafe(
      `UPDATE zones
       SET ${setClauses.join(", ")}
       WHERE id = ${zoneIdParam}::uuid AND tenant_id = ${tenantIdParam}::uuid
       RETURNING id, name, zone_type, description, surcharge_type, surcharge_amount,
                 surcharge_label, is_active, boundary, sort_order`,
      ...values
    );

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "Zone not found" },
        { status: 404 }
      );
    }

    const z = updated[0];
    return NextResponse.json({
      id: z.id,
      name: z.name,
      type: z.zone_type,
      description: z.description,
      surchargeType: z.surcharge_type,
      surchargeAmount: z.surcharge_amount,
      surchargeLabel: z.surcharge_label,
      isActive: z.is_active,
      boundary: z.boundary,
      sortOrder: z.sort_order,
    });
  } catch (error: any) {
    console.error("[CAB] Update zone error:", error);
    return NextResponse.json(
      { error: "Failed to update zone" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; zoneId: string }> }
) {
  try {
    const { tenantId, zoneId } = await params;

    const deleted: any[] = await prisma.$queryRawUnsafe(
      `DELETE FROM zones
       WHERE id = $1::uuid AND tenant_id = $2::uuid
       RETURNING id`,
      zoneId,
      tenantId
    );

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "Zone not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[CAB] Delete zone error:", error);
    return NextResponse.json(
      { error: "Failed to delete zone" },
      { status: 500 }
    );
  }
}
