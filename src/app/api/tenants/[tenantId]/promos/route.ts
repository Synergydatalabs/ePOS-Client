import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/promos — List promo codes
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);

    const isActive = searchParams.get("isActive");
    const code = searchParams.get("code");

    let whereClause = `WHERE tenant_id = $1`;
    if (isActive !== null && isActive !== undefined && isActive !== "") {
      whereClause += ` AND is_active = ${isActive === "true"}`;
    }
    if (code) whereClause += ` AND UPPER(code) = UPPER('${code}')`;

    const promos = await prisma.$queryRawUnsafe(`
      SELECT * FROM promo_codes
      ${whereClause}
      ORDER BY created_at DESC
    `, tenantId);

    return NextResponse.json({ success: true, promos });
  } catch (error) {
    console.error("Error listing promos:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list promos" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/promos — Create promo code
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const {
      code, description, discountType, discountValue,
      maxDiscountCents, minFareCents, maxUses, maxUsesPerUser,
      validFrom, validTo, vehicleTypes, rideTypes,
    } = body;

    if (!code || !discountType || discountValue === undefined) {
      return NextResponse.json(
        { success: false, error: "code, discountType, and discountValue are required" },
        { status: 400 }
      );
    }

    if (!["PERCENTAGE", "FLAT"].includes(discountType)) {
      return NextResponse.json(
        { success: false, error: "discountType must be PERCENTAGE or FLAT" },
        { status: 400 }
      );
    }

    if (discountType === "PERCENTAGE" && (discountValue < 0 || discountValue > 100)) {
      return NextResponse.json(
        { success: false, error: "Percentage discount must be between 0 and 100" },
        { status: 400 }
      );
    }

    // Check for duplicate code
    const existing: any[] = await prisma.$queryRawUnsafe(`
      SELECT id FROM promo_codes WHERE tenant_id = $1 AND UPPER(code) = UPPER($2)
    `, tenantId, code);

    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: "A promo code with this code already exists" },
        { status: 409 }
      );
    }

    const promoId = crypto.randomUUID();

    const promo: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO promo_codes (
        id, tenant_id, code, description,
        discount_type, discount_value, max_discount_cents, min_fare_cents,
        max_uses, max_uses_per_user, current_uses,
        valid_from, valid_to,
        vehicle_types, ride_types,
        is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, 0,
        $11, $12,
        $13, $14,
        true, NOW(), NOW()
      )
      RETURNING *
    `,
      promoId, tenantId, code.toUpperCase(), description || null,
      discountType, discountValue, maxDiscountCents || null, minFareCents || null,
      maxUses || null, maxUsesPerUser || 1,
      validFrom ? new Date(validFrom) : null, validTo ? new Date(validTo) : null,
      vehicleTypes ? JSON.stringify(vehicleTypes) : null,
      rideTypes ? JSON.stringify(rideTypes) : null
    );

    return NextResponse.json({ success: true, promo: promo[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating promo:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create promo" },
      { status: 500 }
    );
  }
}
