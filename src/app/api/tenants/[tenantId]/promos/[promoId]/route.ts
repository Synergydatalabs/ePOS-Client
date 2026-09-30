import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/promos/[promoId] — Get promo code details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; promoId: string }> }
) {
  try {
    const { tenantId, promoId } = await params;

    const promos: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM promo_codes WHERE id = $1 AND tenant_id = $2
    `, promoId, tenantId);

    if (promos.length === 0) {
      return NextResponse.json(
        { success: false, error: "Promo code not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, promo: promos[0] });
  } catch (error) {
    console.error("Error getting promo:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get promo" },
      { status: 500 }
    );
  }
}

// PUT /api/tenants/[tenantId]/promos/[promoId] — Update promo code
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; promoId: string }> }
) {
  try {
    const { tenantId, promoId } = await params;
    const body = await request.json();

    const {
      code, description, discountType, discountValue,
      maxDiscountCents, minFareCents, maxUses, maxUsesPerUser,
      validFrom, validTo, vehicleTypes, rideTypes, isActive,
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

    addField("code", code ? code.toUpperCase() : undefined);
    addField("description", description);
    addField("discount_type", discountType);
    addField("discount_value", discountValue);
    addField("max_discount_cents", maxDiscountCents);
    addField("min_fare_cents", minFareCents);
    addField("max_uses", maxUses);
    addField("max_uses_per_user", maxUsesPerUser);
    addField("valid_from", validFrom ? new Date(validFrom) : undefined);
    addField("valid_to", validTo ? new Date(validTo) : undefined);
    addField("vehicle_types", vehicleTypes ? JSON.stringify(vehicleTypes) : undefined);
    addField("ride_types", rideTypes ? JSON.stringify(rideTypes) : undefined);
    addField("is_active", isActive);

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    setClauses.push(`updated_at = NOW()`);

    // If changing code, check for duplicates
    if (code) {
      const existing: any[] = await prisma.$queryRawUnsafe(`
        SELECT id FROM promo_codes
        WHERE tenant_id = $1 AND UPPER(code) = UPPER($2) AND id != $3
      `, tenantId, code, promoId);

      if (existing.length > 0) {
        return NextResponse.json(
          { success: false, error: "A promo code with this code already exists" },
          { status: 409 }
        );
      }
    }

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE promo_codes
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING *
    `, ...values, promoId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Promo code not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, promo: updated[0] });
  } catch (error) {
    console.error("Error updating promo:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update promo" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[tenantId]/promos/[promoId] — Deactivate promo code
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; promoId: string }> }
) {
  try {
    const { tenantId, promoId } = await params;

    const updated: any[] = await prisma.$queryRawUnsafe(`
      UPDATE promo_codes
      SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `, promoId, tenantId);

    if (updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Promo code not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, promo: updated[0] });
  } catch (error) {
    console.error("Error deleting promo:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to delete promo" },
      { status: 500 }
    );
  }
}
