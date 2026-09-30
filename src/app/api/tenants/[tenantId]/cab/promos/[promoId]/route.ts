import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// PUT /api/tenants/[tenantId]/cab/promos/[promoId] — Update a promo code
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; promoId: string }> }
) {
  try {
    const { tenantId, promoId } = await params;
    const body = await request.json();

    const {
      code,
      type,
      value,
      maxDiscountCap,
      minFare,
      validFrom,
      validTo,
      maxUses,
      firstRideOnly,
      isActive,
    } = body;

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const addField = (column: string, val: any) => {
      if (val !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(val);
        paramIndex++;
      }
    };

    addField("code", code ? code.toUpperCase() : undefined);
    addField("discount_type", type);
    addField("discount_value", value);
    addField("max_discount", maxDiscountCap);
    addField("min_fare", minFare);
    addField("max_uses", maxUses);
    addField("first_ride_only", firstRideOnly);
    addField("is_active", isActive);

    if (validFrom !== undefined) {
      setClauses.push(`valid_from = $${paramIndex}`);
      values.push(validFrom ? new Date(validFrom) : null);
      paramIndex++;
    }

    if (validTo !== undefined) {
      setClauses.push(`valid_until = $${paramIndex}`);
      values.push(validTo ? new Date(validTo) : null);
      paramIndex++;
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = NOW()`);

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE promo_codes
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex}::uuid AND tenant_id = $${paramIndex + 1}::uuid
      RETURNING *
    `, ...values, promoId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Promo not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, promo: updated[0] });
  } catch (error: any) {
    console.error("[CAB] Error updating promo:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update promo" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/cab/promos/[promoId] — Delete a promo code
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; promoId: string }> }
) {
  try {
    const { tenantId, promoId } = await params;

    const deleted: any[] = await prisma.$queryRawUnsafe(`
      DELETE FROM promo_codes
      WHERE id = $1::uuid AND tenant_id = $2::uuid
      RETURNING id
    `, promoId, tenantId);

    if (deleted.length === 0) {
      return NextResponse.json(
        { success: false, error: "Promo not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: "Promo deleted" });
  } catch (error: any) {
    console.error("[CAB] Error deleting promo:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete promo" },
      { status: 500 }
    );
  }
}
